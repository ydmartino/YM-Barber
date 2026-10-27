"use strict";

const http = require("node:http");
const { loadEnvironment } = require("./src/config/environment");

loadEnvironment();

const { pool } = require("./src/models/database.model");
const { ApiError } = require("./src/models/errors");
const apiView = require("./src/views/api.view");
const applicationView = require("./src/views/application.view");

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api") {
      await apiView.view(request, response, url);
      return;
    }
    await applicationView.view(request, response, url);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (error instanceof ApiError) {
      response.writeHead(error.status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message }));
      return;
    }
    console.error("Erro ao servir a aplicação:", error);
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Ocorreu um erro inesperado ao processar a solicitação." }));
  }
});

async function start() {
  const port = Number(process.env.PORT || 8000);
  await pool.query("SELECT 1");
  const [columns] = await pool.query(
    `SELECT DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'item_type'`
  );
  if (columns.length === 0) {
    await pool.query(
      "ALTER TABLE products ADD COLUMN item_type CHAR(1) NOT NULL DEFAULT 'P' AFTER low_stock_threshold"
    );
  } else {
    await pool.query("ALTER TABLE products MODIFY COLUMN item_type VARCHAR(10) NOT NULL DEFAULT 'P'");
    await pool.query("UPDATE products SET item_type = 'S' WHERE item_type = 'service'");
    await pool.query("UPDATE products SET item_type = 'P' WHERE item_type IN ('product', '')");
    await pool.query("ALTER TABLE products MODIFY COLUMN item_type CHAR(1) NOT NULL DEFAULT 'P'");
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  console.log(`Navalha disponível em http://localhost:${port}`);
  console.log("Conexão com MySQL estabelecida.");
  if (!process.env.SESSION_SECRET) {
    console.warn("SESSION_SECRET não definido: sessões existentes serão encerradas ao reiniciar o servidor.");
  }
  return server;
}

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Não foi possível iniciar o servidor:", error.code || error.message);
    process.exitCode = 1;
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = { server, start };
