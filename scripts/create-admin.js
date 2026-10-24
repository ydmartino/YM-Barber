"use strict";

const readline = require("node:readline");
const { loadEnvironment } = require("../src/config/environment");

loadEnvironment();
const { pool } = require("../src/models/database.model");
const userModel = require("../src/models/user.model");
const { passwordHash } = require("../src/models/errors");

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
  try {
    const result = await userModel.create({
      name,
      email,
      passwordHash: passwordHash(password),
      isAdmin: true,
      permissionIds: [],
      grantedBy: null,
    });
    console.log(`Administrador criado com sucesso (ID ${result.id}): ${email}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Não foi possível criar o administrador: ${error.message}`);
  process.exitCode = 1;
});
