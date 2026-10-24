"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const mysql = require("mysql2/promise");

loadEnvironment();

function loadEnvironment() {
  const filename = path.join(__dirname, "..", ".env");
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

function readHiddenPassword() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => input.question("Senha do administrador (mínimo 12 caracteres): ", (answer) => {
      input.close();
      resolve(answer);
    }));
  }
  return new Promise((resolve, reject) => {
    process.stdout.write("Senha do administrador (mínimo 12 caracteres): ");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let password = "";
    function onData(buffer) {
      const key = buffer.toString("utf8");
      if (key === "\u0003") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        reject(new Error("Operação cancelada."));
        return;
      }
      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(password);
      } else if (key === "\u007f" || key === "\b") {
        password = password.slice(0, -1);
      } else if (!key.startsWith("\u001b")) {
        password += key;
      }
    }
    process.stdin.on("data", onData);
  });
}

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase();
  const name = (process.argv[3] || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || [...name].length > 120) {
    throw new Error('Uso: npm run create-admin -- admin@barbearia.com "Nome do administrador"');
  }
  const password = await readHiddenPassword();
  if (password.length < 12 || password.length > 200) {
    throw new Error("A senha deve ter entre 12 e 200 caracteres.");
  }
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  const passwordHash = `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || "navalha",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: "utf8mb4",
    timezone: "Z",
    connectionLimit: 1,
  });
  try {
    const [result] = await pool.execute(
      "INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, 1)",
      [name, email, passwordHash]
    );
    console.log(`Administrador criado com sucesso (ID ${result.insertId}): ${email}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Não foi possível criar o administrador: ${error.message}`);
  process.exitCode = 1;
});
