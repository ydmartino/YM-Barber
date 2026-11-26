"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadEnvironment } = require("../src/config/environment");

loadEnvironment();

function optionValue(value) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) {
    throw new Error("A configuração do MySQL contém um valor inválido.");
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function runDump(optionFile, outputFile, database) {
  return new Promise((resolve, reject) => {
    const process = spawn("mysqldump", [
      `--defaults-extra-file=${optionFile}`,
      "--single-transaction",
      "--routines",
      "--triggers",
      `--result-file=${outputFile}`,
      database,
    ], { windowsHide: true });
    let stderr = "";
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk) => { stderr += chunk; });
    process.once("error", reject);
    process.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mysqldump terminou com código ${code}: ${stderr.trim()}`));
    });
  });
}

async function removeExpiredBackups(directory, cutoff) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/^navalha-\d{8}T\d{6}Z-\d+\.sql$/.test(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    const metadata = await fs.stat(filename);
    if (metadata.mtimeMs < cutoff) await fs.unlink(filename);
  }
}

async function main() {
  const database = process.env.DB_NAME || "navalha";
  const directory = process.env.BACKUP_DIR;
  const port = Number(process.env.DB_PORT || 3306);
  if (!directory || !path.isAbsolute(directory)) {
    throw new Error("Defina BACKUP_DIR como um caminho absoluto para armazenar os backups.");
  }
  if (!/^[A-Za-z0-9_]+$/.test(database) || !process.env.DB_USER || !process.env.DB_PASSWORD ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Configure DB_NAME, DB_USER e DB_PASSWORD antes de gerar o backup.");
  }

  await fs.mkdir(directory, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const outputFile = path.join(directory, `navalha-${stamp}-${process.pid}.sql`);
  const optionFile = path.join(os.tmpdir(), `navalha-mysqldump-${process.pid}.cnf`);
  const options = [
    "[client]",
    `host=${optionValue(process.env.DB_HOST || "localhost")}`,
    `port=${port}`,
    `user=${optionValue(process.env.DB_USER)}`,
    `password=${optionValue(process.env.DB_PASSWORD)}`,
    "",
  ].join("\n");

  let outputCreated = false;
  try {
    await fs.writeFile(optionFile, options, { mode: 0o600, flag: "wx" });
    await fs.writeFile(outputFile, "", { mode: 0o600, flag: "wx" });
    outputCreated = true;
    await runDump(optionFile, outputFile, database);
    if ((await fs.stat(outputFile)).size === 0) {
      throw new Error("mysqldump terminou sem gravar dados.");
    }
    await fs.chmod(outputFile, 0o600);
    await removeExpiredBackups(directory, now.getTime() - 30 * 24 * 60 * 60 * 1000);
    console.log(`Backup criado: ${outputFile}`);
  } catch (error) {
    if (outputCreated) await fs.rm(outputFile, { force: true });
    throw error;
  } finally {
    await fs.rm(optionFile, { force: true });
  }
}

main().catch((error) => {
  console.error(`Não foi possível gerar o backup: ${error.message}`);
  process.exitCode = 1;
});
