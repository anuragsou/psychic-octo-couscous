require("dotenv").config();

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("Set TELEGRAM_BOT_TOKEN in .env first.");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || "Telegram getUpdates failed.");
  }

  const chats = new Map();
  for (const update of data.result) {
    const chat = update.message?.chat;
    if (chat?.id) {
      chats.set(chat.id, {
        id: chat.id,
        type: chat.type,
        title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || ""
      });
    }
  }

  if (!chats.size) {
    console.log("No chats found. Send any message to your bot in Telegram, then run this again.");
    return;
  }

  console.log("Available Telegram chat IDs:");
  for (const chat of chats.values()) {
    console.log(`${chat.id}\t${chat.type}\t${chat.title}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
