# Deploy The Zepto Stock Bot

This bot needs a server that can run a long-lived Node process plus headless Chromium. A small VM is the safest free-hosting style. Free web services that sleep are not ideal for 5-minute tracking.

## What I Can Do For You

I can prepare the project, Docker files, startup configs, and deployment commands. To actually deploy to a free cloud VM, you need to create the cloud account/VM or give me SSH access to a VM you already control.

Do not paste private SSH keys or cloud passwords into chat. Use a local key file on your machine and share only the server IP, username, and which key file to use.

## Recommended Free VM Path

Use an Oracle Cloud Always Free VM or any small Ubuntu VM with at least 1 GB RAM. More RAM is better because Chromium can be memory-hungry.

If you do not have a credit/debit card, use the GitHub Actions fallback below. It is not a VM, but it can run scheduled checks without a cloud payment method.

## No-Card Fallback: GitHub Actions

This project includes `.github/workflows/zepto-stock-check.yml`.

1. Create a GitHub account.
2. Create a new repository.
3. Upload this project folder to that repository.
4. In GitHub, open `Settings > Secrets and variables > Actions > New repository secret`.
5. Add these secrets:

   ```text
   TELEGRAM_BOT_TOKEN
   TELEGRAM_CHAT_ID
   ```

6. Open the `Actions` tab and enable workflows if GitHub asks.
7. Run `Zepto Stock Check` manually once with `workflow_dispatch`.

By default the workflow runs every 30 minutes. GitHub supports schedules as short as 5 minutes, but private repositories have monthly free minute limits, so 30 minutes is safer. To check every 5 minutes, edit the cron line:

```yaml
- cron: "*/5 * * * *"
```

GitHub scheduled jobs can be delayed, so this is a practical free fallback, not an exact always-on replacement.

## Docker Compose Deployment

On the server:

```bash
sudo apt-get update
sudo apt-get install -y git docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

Copy this project to the server, then inside the project folder create `.env` with your real values:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=6612833687
ZEPTO_PRODUCT_URL=https://www.zepto.com/pn/abhi-vit-d3-white-eggs-with-immunity-boosters/pvid/e2b2c19f-1eca-4900-9c9e-c997ac193fdb
ZEPTO_PINCODE=382449
ZEPTO_LOCATION_TEXT=New Maninagar 382449
CHECK_INTERVAL_SECONDS=300
NOTIFY_ON_EVERY_CHECK=false
LOW_STOCK_THRESHOLD=3
ENABLE_CART_QUANTITY_PROBE=true
MAX_QUANTITY_PROBE=30
HEADLESS=true
ENABLE_TELEGRAM_COMMANDS=true
DEBUG=false
```

Start it:

```bash
docker compose up -d --build
docker compose logs -f
```

Stop it:

```bash
docker compose down
```

Update after code changes:

```bash
docker compose up -d --build
```

## Direct Node + PM2 Deployment

If you do not want Docker:

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm
npm ci --omit=dev
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run a one-time check:

```bash
npm run check:once
```

View logs:

```bash
pm2 logs zepto-stock-bot
```

Restart:

```bash
pm2 restart zepto-stock-bot
```

## Direct Node + systemd Deployment

Use `deploy/zepto-telegram-stock-bot.service.example` as a template if you prefer systemd. Copy the project to `/opt/zepto-telegram-stock-bot`, create a Linux user named `zeptobot`, then install the service:

```bash
sudo cp deploy/zepto-telegram-stock-bot.service.example /etc/systemd/system/zepto-telegram-stock-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now zepto-telegram-stock-bot
sudo systemctl status zepto-telegram-stock-bot
```

View logs:

```bash
journalctl -u zepto-telegram-stock-bot -f
```

## Important Notes

- Keep `.env` private. It contains your Telegram bot token.
- The Docker Compose setup uses named volumes so `.browser-profile`, `.state`, and `.debug` survive container rebuilds.
- If Zepto changes its website, run with `DEBUG=true` once and inspect `.debug/last-page.png` and `.debug/last-details.json`.
- The cart quantity probe adds the item, increments until the configured cap or Zepto limit, then decrements back to zero. It does not checkout.
