class TelegramClient {
  constructor({ token, defaultChatId }) {
    this.token = token;
    this.defaultChatId = defaultChatId;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async request(method, payload = {}) {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, description: text };
    }

    if (!response.ok || !data.ok) {
      throw new Error(`Telegram ${method} failed: ${data.description || response.statusText}`);
    }

    return data.result;
  }

  async sendMessage(text, chatId = this.defaultChatId) {
    return this.request("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    });
  }

  async getUpdates(offset, timeoutSeconds = 25) {
    return this.request("getUpdates", {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ["message"]
    });
  }
}

module.exports = {
  TelegramClient
};
