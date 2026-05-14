const fs = require("node:fs/promises");
const path = require("node:path");
const puppeteer = require("puppeteer");

const STOCK_KEYS = [
  "availableQuantity",
  "available_qty",
  "availableQty",
  "qtyAvailable",
  "availableStock",
  "availableInventory",
  "stockQuantity",
  "inventoryQuantity",
  "inventory"
];

const PRICE_KEYS = [
  "discountedSellingPrice",
  "sellingPrice",
  "price",
  "finalPrice",
  "offerPrice",
  "discountedPrice"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractProductVariantId(productUrl) {
  const match = productUrl.match(/\/pvid\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function firstNumericFromKeys(object, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      const numeric = toNumber(object[key]);
      if (numeric !== null) return numeric;
    }
  }
  return null;
}

function firstValueFromKeys(object, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      const value = object[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return null;
}

function booleanFromStockFields(object) {
  const inStock = firstValueFromKeys(object, ["inStock", "isInStock", "available", "isAvailable"]);
  if (typeof inStock === "boolean") return inStock;

  const outOfStock = firstValueFromKeys(object, ["outOfStock", "isOutOfStock", "soldOut", "isSoldOut"]);
  if (typeof outOfStock === "boolean") return !outOfStock;

  const availability = firstValueFromKeys(object, ["stockAvailability", "availability", "status"]);
  if (typeof availability === "string") {
    if (/out\s*of\s*stock|sold\s*out|unavailable/i.test(availability)) return false;
    if (/in\s*stock|available/i.test(availability)) return true;
  }

  return null;
}

function findDeepValue(object, keys, depth = 0) {
  if (!object || typeof object !== "object" || depth > 4) return null;

  const direct = firstValueFromKeys(object, keys);
  if (direct !== null) return direct;

  for (const value of Object.values(object)) {
    if (!value || typeof value !== "object") continue;
    const found = findDeepValue(value, keys, depth + 1);
    if (found !== null) return found;
  }

  return null;
}

function walkJson(value, visitor, pathParts = [], stats = { count: 0 }) {
  if (stats.count > 50000) return;
  if (!value || typeof value !== "object") return;
  stats.count += 1;
  visitor(value, pathParts);

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, visitor, pathParts.concat(index), stats));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    walkJson(child, visitor, pathParts.concat(key), stats);
  }
}

function objectMatchesVariant(object, productVariantId) {
  if (!productVariantId || !object || typeof object !== "object") return false;

  const likelyIdKeys = [
    "id",
    "productVariantId",
    "primaryProductVariantId",
    "variantId",
    "product_variant_id",
    "retailer_product_id"
  ];

  for (const key of likelyIdKeys) {
    const value = object[key];
    if (typeof value === "string" && value.toLowerCase() === productVariantId.toLowerCase()) {
      return true;
    }
  }

  return Object.values(object).some(
    (value) => typeof value === "string" && value.toLowerCase() === productVariantId.toLowerCase()
  );
}

function hasStockSignal(object) {
  return (
    STOCK_KEYS.some((key) => Object.prototype.hasOwnProperty.call(object, key)) ||
    ["outOfStock", "isOutOfStock", "inStock", "isInStock", "isAvailable", "stockAvailability"].some((key) =>
      Object.prototype.hasOwnProperty.call(object, key)
    )
  );
}

function snapshotFromCandidate(candidate, productVariantId) {
  const object = candidate.object;
  const productLike = object.productVariant || object.variant || object.product || object;
  const availableQuantity = firstNumericFromKeys(object, STOCK_KEYS);
  const quantityFallback = hasStockSignal(object) ? toNumber(object.quantity) : null;
  const maxAllowedQuantity =
    firstNumericFromKeys(object, ["maxAllowedQuantity", "max_allowed_quantity", "maxAddableQuantity"]) ??
    firstNumericFromKeys(productLike, ["maxAllowedQuantity", "max_allowed_quantity", "maxAddableQuantity"]);
  const availableFromBool = booleanFromStockFields(object);
  const finalAvailableQuantity = availableQuantity ?? quantityFallback;

  let available = availableFromBool;
  if (available === null && finalAvailableQuantity !== null) available = finalAvailableQuantity > 0;

  const productName = firstDefined(
    findDeepValue(productLike, ["name", "productName", "displayName", "title"]),
    findDeepValue(object, ["name", "productName", "displayName", "title"])
  );

  const price = firstNumericFromKeys(object, PRICE_KEYS) ?? firstNumericFromKeys(productLike, PRICE_KEYS);
  const mrp = firstNumericFromKeys(object, ["mrp", "MRP"]) ?? firstNumericFromKeys(productLike, ["mrp", "MRP"]);

  let score = 0;
  if (objectMatchesVariant(object, productVariantId)) score += 30;
  if (finalAvailableQuantity !== null) score += 40;
  if (available !== null) score += 20;
  if (maxAllowedQuantity !== null) score += 10;
  if (productName) score += 10;
  if (price !== null) score += 5;
  if (/\/api\/|inventory|product|catalog|search|pdp/i.test(candidate.source)) score += 5;

  return {
    productName: typeof productName === "string" ? productName.trim() : "",
    available,
    availableQuantity: finalAvailableQuantity,
    maxAllowedQuantity,
    price,
    mrp,
    source: candidate.source,
    confidence: finalAvailableQuantity !== null ? "high" : available !== null ? "medium" : "low",
    score,
    path: candidate.path
  };
}

function collectCandidates(jsonItems, productVariantId) {
  const candidates = [];

  for (const item of jsonItems) {
    walkJson(item.json, (object, pathParts) => {
      if (objectMatchesVariant(object, productVariantId) || (!productVariantId && hasStockSignal(object))) {
        candidates.push({
          object,
          path: pathParts.join("."),
          source: item.source
        });
      }
    });
  }

  return candidates
    .map((candidate) => snapshotFromCandidate(candidate, productVariantId))
    .sort((a, b) => b.score - a.score);
}

async function captureJsonResponses(page) {
  const jsonItems = [];

  page.on("response", async (response) => {
    const url = response.url();
    const headers = response.headers();
    const contentType = headers["content-type"] || "";
    const contentLength = Number(headers["content-length"] || 0);
    const usefulUrl = /zepto|zeptonow|api|inventory|product|catalog|search|pdp/i.test(url);

    if (!usefulUrl) return;
    if (contentLength > 4_000_000) return;
    if (!contentType.includes("json") && !/\/api\/|inventory|product|catalog|search|pdp/i.test(url)) return;

    try {
      const text = await response.text();
      const trimmed = text.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
      jsonItems.push({
        source: url,
        json: JSON.parse(trimmed)
      });
    } catch {
      // Some browser responses are streamed or opaque; those are safe to ignore.
    }
  });

  return jsonItems;
}

async function clickByText(page, patterns) {
  return page.evaluate((sourcePatterns) => {
    const regexes = sourcePatterns.map((pattern) => new RegExp(pattern, "i"));
    const candidates = Array.from(document.querySelectorAll("button, [role='button'], a, div, span"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || "").trim();
        const ownText = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || "")
          .join(" ")
          .trim();
        const clickable = ["BUTTON", "A"].includes(element.tagName) || element.getAttribute("role") === "button";
        return { element, text, ownText, clickable, area: rect.width * rect.height };
      })
      .filter((item) => item.text && item.text.length <= 120)
      .sort((a, b) => {
        const aExact = regexes.some((regex) => regex.test(a.ownText || a.text)) ? 1 : 0;
        const bExact = regexes.some((regex) => regex.test(b.ownText || b.text)) ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        if (a.clickable !== b.clickable) return Number(b.clickable) - Number(a.clickable);
        return a.area - b.area;
      });

    const match = candidates.find((item) => regexes.some((regex) => regex.test(item.text)));
    if (!match) return null;
    match.element.click();
    return match.text;
  }, patterns);
}

async function openLocationPicker(page) {
  const selectors = [
    "[data-testid*='location' i]",
    "[aria-label*='location' i]",
    "button",
    "[role='button']",
    "header div",
    "nav div"
  ];

  for (const selector of selectors) {
    const handles = await page.$$(selector);

    for (const handle of handles) {
      const meta = await handle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = (element.innerText || element.textContent || "").trim();
        return {
          text,
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        };
      });

      if (!meta.visible || meta.text.length > 80 || !/select|location|deliver|change/i.test(meta.text)) {
        continue;
      }

      await handle.click();
      await sleep(900);

      const hasInput = await page.evaluate(() =>
        Array.from(document.querySelectorAll("input, textarea")).some((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        })
      );

      if (hasInput) return meta.text;
    }
  }

  return clickByText(page, [
    "^select location$",
    "select.*location",
    "add.*address",
    "enter.*pin",
    "enter.*location",
    "delivery.*location",
    "deliver.*to",
    "^change$"
  ]);
}

async function typeIntoLocationInput(page, locationQuery) {
  const handles = await page.$$("input, textarea");

  for (const handle of handles) {
    const meta = await handle.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
        placeholder: element.getAttribute("placeholder") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        name: element.getAttribute("name") || "",
        type: element.getAttribute("type") || "",
        value: element.value || ""
      };
    });

    const haystack = `${meta.placeholder} ${meta.ariaLabel} ${meta.name} ${meta.type}`.toLowerCase();
    const looksLocationInput = /pin|pincode|address|location|delivery|search|area|locality/.test(haystack);
    if (!meta.visible || !looksLocationInput) continue;

    await handle.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.keyboard.type(locationQuery, { delay: 35 });
    return true;
  }

  return false;
}

async function selectPincodeSuggestion(page, pincode) {
  await sleep(1500);

  const clickedPincode = await clickByText(page, [pincode]);
  if (clickedPincode) return clickedPincode;

  await page.keyboard.press("ArrowDown").catch(() => {});
  await page.keyboard.press("Enter").catch(() => {});
  await sleep(1000);

  const clickedConfirm = await clickByText(page, [
    "^confirm$",
    "confirm location",
    "set location",
    "save",
    "use this",
    "select",
    "continue"
  ]);

  return clickedConfirm;
}

async function applyLocation(page, { pincode, locationText }) {
  const notes = [];
  const locationQuery = locationText || pincode;

  const currentText = await page.evaluate(() => document.body.innerText || "");
  if (currentText.includes(pincode)) {
    return { applied: true, notes: ["Pincode already visible on the page."] };
  }

  const deliveryHeader = await page.evaluate(() => {
    const headerText =
      document.querySelector("header")?.innerText ||
      document.querySelector("nav")?.innerText ||
      document.body.innerText.slice(0, 500);
    return headerText.replace(/\s+/g, " ").trim();
  });

  if (!/select\s+location/i.test(deliveryHeader) && /\b\d+\s*minutes\b|ward\s+\d+|ahmedabad|maninagar/i.test(deliveryHeader)) {
    return { applied: true, notes: [`Existing Zepto delivery location detected: ${deliveryHeader}`] };
  }

  const openLocationText = await openLocationPicker(page);

  if (openLocationText) {
    notes.push(`Opened location control: ${openLocationText}`);
    await sleep(1200);
  }

  const typed = await typeIntoLocationInput(page, locationQuery);
  if (!typed) {
    notes.push("Could not find a visible pincode/location input.");
    return { applied: false, notes };
  }

  notes.push(`Typed location query ${locationQuery}.`);
  const selected = await selectPincodeSuggestion(page, pincode);
  if (selected) notes.push(`Selected location action: ${selected}`);

  await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => {});
  await sleep(1500);

  const afterText = await page.evaluate(() => document.body.innerText || "");
  const applied = afterText.includes(pincode) || !/select.*location|enter.*pin|add.*address/i.test(afterText);
  return { applied, notes };
}

async function extractDomSnapshot(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || "";
    const title =
      document.querySelector("h1")?.innerText?.trim() ||
      document.querySelector("[data-testid*='name' i]")?.innerText?.trim() ||
      document.title?.replace(/\s*\|\s*.*/, "").trim() ||
      "";

    const outOfStock =
      /out\s*of\s*stock|sold\s*out|currently\s*unavailable|not\s*available|notify\s*me|back\s*in\s*stock/i.test(text);
    const addToCart = /\badd\s*(to\s*cart)?\b/i.test(text);
    const qtyMatch =
      text.match(/only\s+(\d+)\s+(left|remaining)/i) ||
      text.match(/(\d+)\s+(left|remaining)/i) ||
      text.match(/available\s+qty\s*:?\s*(\d+)/i);
    const priceMatch = text.match(/₹\s?[\d,]+(?:\.\d+)?/);

    return {
      productName: title,
      available: outOfStock ? false : addToCart ? true : null,
      availableQuantity: qtyMatch ? Number(qtyMatch[1]) : null,
      price: priceMatch ? priceMatch[0] : null,
      source: "page text",
      confidence: qtyMatch ? "medium" : outOfStock || addToCart ? "low" : "low"
    };
  });
}

async function clickMainProductAction(page, patterns) {
  return page.evaluate((sourcePatterns) => {
    const regexes = sourcePatterns.map((pattern) => new RegExp(pattern, "i"));
    const candidates = Array.from(document.querySelectorAll("button, [role='button'], div"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        return {
          element,
          text,
          clickable: element.tagName === "BUTTON" || element.getAttribute("role") === "button",
          rect: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          },
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
        };
      })
      .filter((item) => {
        if (!item.visible || item.text.length > 80) return false;
        if (item.rect.top < 220 || item.rect.top > 950) return false;
        if (item.rect.width < 180 || item.rect.height < 16) return false;
        return regexes.some((regex) => regex.test(item.text));
      })
      .sort((a, b) => {
        if (a.clickable !== b.clickable) return Number(b.clickable) - Number(a.clickable);
        return b.rect.width * b.rect.height - a.rect.width * a.rect.height;
      });

    const match = candidates[0];
    if (!match) return null;
    match.element.click();
    return { text: match.text, rect: match.rect };
  }, patterns);
}

function expandRect(rect) {
  return {
    left: rect.left - 80,
    top: rect.top - 80,
    right: rect.right + 80,
    bottom: rect.bottom + 120
  };
}

async function readMainCartQuantity(page, actionRect) {
  return page.evaluate((rect) => {
    const box = {
      left: rect.left - 80,
      top: rect.top - 80,
      right: rect.right + 80,
      bottom: rect.bottom + 120
    };

    function isVisible(element) {
      const elementRect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        elementRect.width > 0 &&
        elementRect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        elementRect.left >= box.left &&
        elementRect.right <= box.right &&
        elementRect.top >= box.top &&
        elementRect.bottom <= box.bottom
      );
    }

    const stepperText = Array.from(document.querySelectorAll("button, [role='button'], div"))
      .map((element) => ({ element, text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim() }))
      .filter((item) => isVisible(item.element))
      .map((item) => item.text)
      .find((text) => /[-−]\s*\d{1,3}\s*\+/.test(text) || /\+\s*\d{1,3}\s*[-−]/.test(text));

    if (stepperText) {
      const match = stepperText.match(/\d{1,3}/);
      return match ? Number(match[0]) : null;
    }

    const exactNumber = Array.from(document.querySelectorAll("button, [role='button'], div, span"))
      .map((element) => {
        const elementRect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        return {
          element,
          text,
          centerX: elementRect.left + elementRect.width / 2,
          area: elementRect.width * elementRect.height
        };
      })
      .filter((item) => {
        if (!isVisible(item.element) || !/^\d{1,3}$/.test(item.text)) return false;
        if (item.centerX < rect.left + rect.width * 0.35 || item.centerX > rect.left + rect.width * 0.65) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.area - b.area)[0];

    return exactNumber ? Number(exactNumber.text) : null;
  }, actionRect);
}

async function waitForMainCartQuantity(page, actionRect, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const quantity = await readMainCartQuantity(page, actionRect);
    if (quantity !== null) return quantity;
    await sleep(400);
  }

  return null;
}

async function clickMainCartStepper(page, actionRect, direction) {
  return page.evaluate(
    ({ rect, direction: requestedDirection }) => {
      const box = {
        left: rect.left - 80,
        top: rect.top - 80,
        right: rect.right + 80,
        bottom: rect.bottom + 120
      };

      function metaFor(element) {
        const elementRect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        const ariaLabel = element.getAttribute("aria-label") || "";
        const title = element.getAttribute("title") || "";
        return {
          element,
          text,
          label: `${text} ${ariaLabel} ${title}`.trim(),
          rect: elementRect,
          visible:
            elementRect.width > 0 &&
            elementRect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            elementRect.left >= box.left &&
            elementRect.right <= box.right &&
            elementRect.top >= box.top &&
            elementRect.bottom <= box.bottom
        };
      }

      const metas = Array.from(document.querySelectorAll("button, [role='button'], div, span"))
        .map(metaFor)
        .filter((item) => item.visible);

      const isPlus = (item) =>
        !/add\s*to\s*cart/i.test(item.text) && (/^\+$/.test(item.text) || /increase|increment|plus/i.test(item.label));
      const isMinus = (item) => /^[-−]$/.test(item.text) || /decrease|decrement|remove/i.test(item.label);
      const matchesDirection = requestedDirection === "plus" ? isPlus : isMinus;

      let candidates = metas.filter(matchesDirection);
      if (!candidates.length) {
        candidates = metas
          .filter((item) => item.rect.width <= 90 && item.rect.height <= 90 && !/^\d+$/.test(item.text))
          .sort((a, b) =>
            requestedDirection === "plus" ? b.rect.left - a.rect.left : a.rect.left - b.rect.left
          )
          .slice(0, 2);
      }

      const match = candidates.sort((a, b) =>
        requestedDirection === "plus" ? b.rect.left - a.rect.left : a.rect.left - b.rect.left
      )[0];

      if (!match) return null;
      match.element.click();
      return {
        text: match.text,
        label: match.label,
        left: match.rect.left,
        top: match.rect.top
      };
    },
    { rect: actionRect, direction }
  );
}

async function cleanupCartProbe(page, actionRect, startingQuantity) {
  let remainingClicks = Math.max(0, Number(startingQuantity) || 0);

  while (remainingClicks > 0) {
    const clicked = await clickMainCartStepper(page, actionRect, "minus");
    if (!clicked) break;
    await sleep(350);
    remainingClicks -= 1;

    const quantity = await readMainCartQuantity(page, actionRect);
    if (quantity === null || quantity <= 0) break;
  }
}

async function probeAvailableQuantityFromCart(page, config, currentSnapshot) {
  if (!config.enableCartQuantityProbe || currentSnapshot.available === false) return null;
  if (currentSnapshot.availableQuantity !== null && currentSnapshot.availableQuantity !== undefined) return null;

  const action = await clickMainProductAction(page, ["^add\\s*to\\s*cart$", "^add$"]);
  if (!action) return null;

  const notes = [`Clicked main product action: ${action.text}`];
  let lastQuantity = await waitForMainCartQuantity(page, action.rect);
  if (lastQuantity === null) {
    notes.push("Stepper quantity did not appear after adding; assuming one item was added.");
    lastQuantity = 1;
  }

  let capped = false;

  try {
    while (lastQuantity < config.maxQuantityProbe) {
      const clicked = await clickMainCartStepper(page, action.rect, "plus");
      if (!clicked) {
        notes.push("No increment control found.");
        break;
      }

      notes.push(`Clicked increment control: ${clicked.label || clicked.text || "unknown"}`);
      await sleep(900);
      const nextQuantity = await readMainCartQuantity(page, action.rect);
      const pageText = await page.evaluate(() => document.body.innerText || "");
      const limitReached =
        /maximum|quantity\s+limit|item\s+limit|only\s+\d+\s+(left|remaining)|out\s*of\s*stock|cannot\s+add|can't\s+add|you\s+can\s+add/i.test(
          pageText
        );

      if (nextQuantity !== null && nextQuantity > lastQuantity) {
        lastQuantity = nextQuantity;
        continue;
      }

      if (limitReached) notes.push("Zepto displayed an add limit message.");
      break;
    }

    capped = lastQuantity >= config.maxQuantityProbe;
    return {
      availableQuantity: capped ? `${lastQuantity}+` : lastQuantity,
      maxAllowedQuantity: capped ? `${lastQuantity}+` : lastQuantity,
      source: capped ? "cart quantity probe lower bound" : "cart quantity probe",
      confidence: capped ? "medium" : "high",
      notes
    };
  } finally {
    await cleanupCartProbe(page, action.rect, lastQuantity);
  }
}

async function extractScriptJson(page, productVariantId) {
  const scriptTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll("script"))
      .map((script) => script.textContent || "")
      .filter((text) => text.length > 0 && text.length < 3_000_000)
  );

  const jsonItems = [];
  for (const text of scriptTexts) {
    if (productVariantId && !text.includes(productVariantId)) continue;
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    try {
      jsonItems.push({ source: "script json", json: JSON.parse(trimmed) });
    } catch {
      // Most script tags are JavaScript, not JSON.
    }
  }

  return jsonItems;
}

async function writeDebugFiles(config, page, details) {
  if (!config.debug) return;

  await fs.mkdir(config.debugDir, { recursive: true });
  await fs.writeFile(path.join(config.debugDir, "last-details.json"), `${JSON.stringify(details, null, 2)}\n`, "utf8");
  await page.screenshot({ path: path.join(config.debugDir, "last-page.png"), fullPage: true }).catch(() => {});
}

function mergeSnapshots(primary, domSnapshot) {
  if (!primary) {
    return domSnapshot;
  }

  return {
    ...primary,
    productName: primary.productName || domSnapshot.productName,
    available: primary.available ?? domSnapshot.available,
    availableQuantity: primary.availableQuantity ?? domSnapshot.availableQuantity,
    price: primary.price ?? domSnapshot.price,
    confidence: primary.confidence || domSnapshot.confidence
  };
}

async function checkZeptoStock(config) {
  const productVariantId = extractProductVariantId(config.productUrl);
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: config.headless,
      userDataDir: config.browserProfileDir,
      defaultViewport: { width: 1366, height: 900 },
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(config.navigationTimeoutMs);
    page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    const jsonResponses = await captureJsonResponses(page);
    await page.goto(config.productUrl, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 20000 }).catch(() => {});

    const locationResult = await applyLocation(page, {
      pincode: config.pincode,
      locationText: config.locationText
    });
    const responseStartIndex = jsonResponses.length;
    await page.goto(config.productUrl, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 25000 }).catch(() => {});
    await sleep(2500);

    const scriptJson = await extractScriptJson(page, productVariantId);
    const domSnapshot = await extractDomSnapshot(page);
    const relevantJsonResponses = jsonResponses.slice(responseStartIndex);
    const candidates = collectCandidates(
      [...(relevantJsonResponses.length ? relevantJsonResponses : jsonResponses), ...scriptJson],
      productVariantId
    );
    const best = candidates[0] || null;
    const merged = mergeSnapshots(best, domSnapshot);
    const cartProbe = await probeAvailableQuantityFromCart(page, config, merged);
    const availableQuantity =
      cartProbe?.availableQuantity ??
      (merged.available === false && merged.availableQuantity === null ? 0 : merged.availableQuantity);
    const available = merged.available ?? (cartProbe ? true : null);

    const snapshot = {
      productUrl: config.productUrl,
      productVariantId,
      pincode: config.pincode,
      locationText: config.locationText,
      checkedAt: new Date().toISOString(),
      productName: merged.productName || "",
      available,
      availableQuantity,
      maxAllowedQuantity: cartProbe?.maxAllowedQuantity ?? merged.maxAllowedQuantity ?? null,
      price: merged.price ?? null,
      mrp: merged.mrp ?? null,
      confidence: cartProbe?.confidence || merged.confidence || "low",
      source: cartProbe?.source || merged.source || "unknown",
      locationApplied: locationResult.applied,
      locationNotes: locationResult.notes,
      cartProbeNotes: cartProbe?.notes || []
    };

    await writeDebugFiles(config, page, {
      snapshot,
      locationResult,
      candidateCount: candidates.length,
      topCandidates: candidates.slice(0, 5),
      cartProbe,
      jsonSourceCount: jsonResponses.length,
      relevantJsonSourceCount: relevantJsonResponses.length,
      scriptJsonCount: scriptJson.length
    });

    return snapshot;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {
  checkZeptoStock,
  extractProductVariantId
};
