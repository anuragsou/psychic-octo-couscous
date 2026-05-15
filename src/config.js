const path = require("node:path");
require("dotenv").config();

function boolEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

function intEnv(name, defaultValue, minimum = 0) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) return defaultValue;
  return parsed;
}

function loadConfig() {
  const rootDir = path.resolve(__dirname, "..");

  return {
    rootDir,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
    productUrl: process.env.ZEPTO_PRODUCT_URL || "",
    pincode: process.env.ZEPTO_PINCODE || "",
    locationText: process.env.ZEPTO_LOCATION_TEXT || "",
    checkIntervalSeconds: intEnv("CHECK_INTERVAL_SECONDS", 300, 30),
    notifyOnEveryCheck: boolEnv("NOTIFY_ON_EVERY_CHECK", false),
    lowStockThreshold: intEnv("LOW_STOCK_THRESHOLD", 0, 0),
    enableCartQuantityProbe: boolEnv("ENABLE_CART_QUANTITY_PROBE", true),
    maxQuantityProbe: intEnv("MAX_QUANTITY_PROBE", 30, 1),
    runOnce: boolEnv("RUN_ONCE", false),
    headless: boolEnv("HEADLESS", true),
    browserProfileDir: path.resolve(rootDir, process.env.BROWSER_PROFILE_DIR || ".browser-profile"),
    navigationTimeoutMs: intEnv("NAVIGATION_TIMEOUT_MS", 60000, 10000),
    enableTelegramCommands: boolEnv("ENABLE_TELEGRAM_COMMANDS", true),
    debug: boolEnv("DEBUG", false),
    notifyOnBlockedError: boolEnv("NOTIFY_ON_BLOCKED_ERROR", false),
    stateFile: path.resolve(rootDir, ".state", "last-stock.json"),
    debugDir: path.resolve(rootDir, ".debug")
  };
}

function validateConfig(config) {
  const missing = [];
  if (!config.telegramBotToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.telegramChatId) missing.push("TELEGRAM_CHAT_ID");
  if (!config.productUrl) missing.push("ZEPTO_PRODUCT_URL");
  if (!config.pincode) missing.push("ZEPTO_PINCODE");

  if (missing.length) {
    throw new Error(`Missing required env values: ${missing.join(", ")}`);
  }

  if (!/^https?:\/\/(www\.)?(zepto|zeptonow)\.com\//i.test(config.productUrl)) {
    throw new Error("ZEPTO_PRODUCT_URL must be a Zepto product URL.");
  }

  if (!/^\d{6}$/.test(config.pincode)) {
    throw new Error("ZEPTO_PINCODE must be a 6 digit Indian pincode.");
  }
}

module.exports = {
  loadConfig,
  validateConfig
};
