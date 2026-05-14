module.exports = {
  apps: [
    {
      name: "zepto-stock-bot",
      script: "src/index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        HEADLESS: "true"
      },
      autorestart: true,
      max_memory_restart: "900M",
      time: true
    }
  ]
};
