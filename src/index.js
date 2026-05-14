const { loadConfig, validateConfig } = require("./config");
const { formatAlert, formatSnapshot, shouldNotify } = require("./format");
const { readState, writeState } = require("./stateStore");
const { TelegramClient } = require("./telegram");
const { checkZeptoStock } = require("./zeptoTracker");

const config = loadConfig();
validateConfig(config);

const telegram = new TelegramClient({
  token: config.telegramBotToken,
  defaultChatId: config.telegramChatId
});

let lastSnapshot = null;
let checking = false;
let lastTelegramUpdateId = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function runCheck({ forceNotify = false, chatId = config.telegramChatId } = {}) {
  if (checking) {
    await telegram.sendMessage("A Zepto stock check is already running.", chatId);
    return lastSnapshot;
  }

  checking = true;
  try {
    const previous = lastSnapshot || (await readState(config.stateFile));
    const current = await checkZeptoStock(config);
    lastSnapshot = current;
    await writeState(config.stateFile, current);

    const shouldSend = forceNotify || shouldNotify(previous, current, config);
    if (shouldSend) {
      await telegram.sendMessage(formatAlert(previous, current, config), chatId);
    }

    log(
      `Checked ${current.productName || current.productVariantId || "product"}: ` +
        `available=${current.available}, qty=${current.availableQuantity ?? "unknown"}`
    );

    return current;
  } catch (error) {
    const message = `Zepto tracker error\n${error.stack || error.message}`;
    log(message);
    await telegram.sendMessage(message.slice(0, 3900), chatId).catch((telegramError) => {
      log(`Telegram error notification failed: ${telegramError.message}`);
    });
    throw error;
  } finally {
    checking = false;
  }
}

async function commandLoop() {
  while (!config.runOnce && config.enableTelegramCommands) {
    try {
      const updates = await telegram.getUpdates(lastTelegramUpdateId ? lastTelegramUpdateId + 1 : undefined, 25);

      for (const update of updates) {
        lastTelegramUpdateId = update.update_id;
        const message = update.message;
        const text = message?.text?.trim() || "";
        const chatId = message?.chat?.id;
        if (!chatId || !text.startsWith("/")) continue;

        if (text.startsWith("/status")) {
          const snapshot = lastSnapshot || (await readState(config.stateFile));
          await telegram.sendMessage(
            snapshot ? formatSnapshot(snapshot, "Last Zepto stock status") : "No stock check has completed yet.",
            chatId
          );
        } else if (text.startsWith("/check")) {
          await telegram.sendMessage("Running a Zepto stock check now...", chatId);
          await runCheck({ forceNotify: true, chatId }).catch(() => {});
        } else if (text.startsWith("/help") || text.startsWith("/start")) {
          await telegram.sendMessage(
            [
              "Zepto stock tracker commands:",
              "/status - show the last known stock status",
              "/check - run a check now",
              "/help - show this help"
            ].join("\n"),
            chatId
          );
        }
      }
    } catch (error) {
      log(`Command polling failed: ${error.message}`);
      await sleep(5000);
    }
  }
}

async function schedulerLoop() {
  while (!config.runOnce) {
    await sleep(config.checkIntervalSeconds * 1000);
    await runCheck().catch(() => {});
  }
}

async function main() {
  lastSnapshot = await readState(config.stateFile);
  log("Starting Zepto Telegram stock tracker.");

  await runCheck({ forceNotify: !lastSnapshot });

  if (config.runOnce) {
    log("RUN_ONCE=true, exiting after one check.");
    return;
  }

  await Promise.all([schedulerLoop(), commandLoop()]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
