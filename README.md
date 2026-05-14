# Zepto Telegram Stock Bot

Tracks one Zepto product for one pincode and sends Telegram alerts when stock, available quantity, max order quantity, or price changes.

Zepto does not provide a public stock API, so this bot uses a real browser session. It captures Zepto page/API JSON where fields such as `availableQuantity`, `quantity`, `maxAllowedQuantity`, and `outOfStock` are present, then falls back to visible page text if Zepto changes the response shape.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Telegram bot with BotFather and put the token in `.env`.

3. Copy the env template:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Fill these values in `.env`:

   ```env
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_CHAT_ID=...
   ZEPTO_PRODUCT_URL=https://www.zeptonow.com/pn/.../pvid/...
   ZEPTO_PINCODE=560001
   ```

5. To find your chat ID, send any message to your bot in Telegram, then run:

   ```bash
   npm run telegram:chat-id
   ```

## First Run

Run one check:

```bash
npm run check:once
```

If Zepto asks for location confirmation and the automatic pincode flow cannot finish, run this once:

```bash
npm run setup:location
```

A visible browser opens. Confirm the Zepto location manually if needed, then let the command complete. The browser profile is stored in `.browser-profile/`, so future headless checks reuse that location session.

## Run Continuously

```bash
npm start
```

For server deployment, see `deploy/DEPLOY.md`.

Telegram commands:

- `/status` shows the last saved stock status.
- `/check` runs an immediate check.
- `/help` shows the command list.

## Useful Env Options

- `CHECK_INTERVAL_SECONDS=300` controls how often checks run. Keep this reasonable so Zepto is not hammered.
- `NOTIFY_ON_EVERY_CHECK=false` only alerts on changes.
- `LOW_STOCK_THRESHOLD=3` adds a low-stock note when available quantity is at or below this number.
- `ENABLE_CART_QUANTITY_PROBE=true` lets the bot infer hidden in-stock quantity by adding the product to cart, incrementing until Zepto refuses more, then decrementing back to zero.
- `MAX_QUANTITY_PROBE=30` caps the cart probe. If the cap is reached, the bot reports a lower bound such as `30+`.
- `HEADLESS=false` opens the browser visibly for debugging.
- `DEBUG=true` writes `.debug/last-details.json` and `.debug/last-page.png`.

## Notes

Exact available quantity depends on what Zepto exposes in the current page/API response for that pincode. When Zepto hides the exact quantity but the product is in stock, the optional cart probe estimates the maximum addable quantity without checking out.
