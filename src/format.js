function formatPrice(value) {
  if (value === null || value === undefined || value === "") return "unknown";
  if (typeof value === "string") return value.replace(/\s+/g, " ").replace(/₹\s+/g, "₹").trim();

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "unknown";

  const rupees = numeric >= 100 && Number.isInteger(numeric) ? numeric / 100 : numeric;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

function formatQuantity(value) {
  if (value === null || value === undefined || value === "") return "not exposed";
  return String(value);
}

function formatAvailability(value) {
  if (value === true) return "In stock";
  if (value === false) return "Out of stock";
  return "Unknown";
}

function formatSnapshot(snapshot, heading = "Zepto stock status") {
  const lines = [
    heading,
    `Product: ${snapshot.productName || "unknown"}`,
    `Pincode: ${snapshot.pincode}`,
    `Status: ${formatAvailability(snapshot.available)}`,
    `Available qty: ${formatQuantity(snapshot.availableQuantity)}`,
    `Max allowed/order: ${formatQuantity(snapshot.maxAllowedQuantity)}`,
    `Price: ${formatPrice(snapshot.price)}`,
    `MRP: ${formatPrice(snapshot.mrp)}`,
    `Checked: ${new Date(snapshot.checkedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    `Confidence: ${snapshot.confidence || "unknown"}`,
    `Source: ${snapshot.source || "unknown"}`,
    snapshot.productUrl
  ];

  return lines.filter(Boolean).join("\n");
}

function changeSummary(previous, current) {
  if (!previous) return ["First check completed."];

  const changes = [];
  const fields = [
    ["available", "Status", formatAvailability],
    ["availableQuantity", "Available qty", formatQuantity],
    ["maxAllowedQuantity", "Max allowed/order", formatQuantity],
    ["price", "Price", formatPrice],
    ["mrp", "MRP", formatPrice]
  ];

  for (const [key, label, formatter] of fields) {
    if ((previous[key] ?? null) !== (current[key] ?? null)) {
      changes.push(`${label}: ${formatter(previous[key])} -> ${formatter(current[key])}`);
    }
  }

  return changes;
}

function shouldNotify(previous, current, config) {
  if (!previous) return true;
  if (config.notifyOnEveryCheck) return true;
  return changeSummary(previous, current).length > 0;
}

function formatAlert(previous, current, config) {
  const changes = changeSummary(previous, current);
  const heading = previous ? "Zepto stock changed" : "Zepto tracker started";
  const lowStock =
    Number.isFinite(current.availableQuantity) &&
    current.availableQuantity > 0 &&
    config.lowStockThreshold > 0 &&
    current.availableQuantity <= config.lowStockThreshold;

  const parts = [formatSnapshot(current, heading)];
  if (changes.length) {
    parts.push(["Changes:", ...changes.map((change) => `- ${change}`)].join("\n"));
  }
  if (lowStock) {
    parts.push(`Low stock alert: only ${current.availableQuantity} left.`);
  }

  return parts.join("\n\n");
}

module.exports = {
  formatAlert,
  formatSnapshot,
  shouldNotify
};
