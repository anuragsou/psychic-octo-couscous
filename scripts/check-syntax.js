const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const targets = [];

function collectJsFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      targets.push(fullPath);
    }
  }
}

collectJsFiles(path.join(rootDir, "src"));
collectJsFiles(path.join(rootDir, "scripts"));

let failed = false;
for (const file of targets) {
  const relativeFile = path.relative(rootDir, file);
  const result = spawnSync(process.execPath, ["--check", relativeFile], {
    cwd: rootDir,
    stdio: "inherit"
  });
  if (result.status !== 0) failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Syntax OK (${targets.length} files).`);
}
