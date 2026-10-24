"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = path.resolve(__dirname, "../..");

function loadEnvironment() {
  const filename = path.join(rootDirectory, ".env");
  if (!fs.existsSync(filename)) return;

  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

module.exports = { loadEnvironment, rootDirectory };
