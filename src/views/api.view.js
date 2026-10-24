"use strict";

const authPresenter = require("../presenters/auth.presenter");
const dashboardPresenter = require("../presenters/dashboard.presenter");
const clientPresenter = require("../presenters/client.presenter");
const productPresenter = require("../presenters/product.presenter");
const salePresenter = require("../presenters/sale.presenter");
const userPresenter = require("../presenters/user.presenter");
const { ApiError, fail } = require("../models/errors");

const MAX_BODY_SIZE = 1024 * 1024;
const presenters = {
  dashboard: dashboardPresenter,
  clients: clientPresenter,
  products: productPresenter,
  sales: salePresenter,
  users: userPresenter,
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) fail(413, "A requisição excede o tamanho máximo permitido.");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      fail(400, "O corpo deve ser um objeto JSON.");
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, "O corpo da requisição deve conter JSON válido.");
  }
}

function parseRoute(url) {
  const route = url.searchParams.get("route") || "";
  const parts = route.split("/").filter(Boolean);
  if (parts.length > 2 || parts.some((part) => !/^[a-z-]+$|^\d+$/.test(part))) {
    fail(400, "A rota solicitada é inválida.");
  }
  return parts;
}

async function handle(request, response, url) {
  const method = request.method || "GET";
  if (method === "OPTIONS") {
    response.writeHead(204, { Allow: "GET, POST, PUT, DELETE, OPTIONS" });
    return response.end();
  }
  const [resource, id] = parseRoute(url);
  const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(request) : {};

  if (resource === "session" && method === "GET") {
    const session = await authPresenter.getSession(request);
    if (!session.authenticated) authPresenter.clearSessionCookie(response);
    return sendJson(response, 200, session);
  }

  if (resource === "login" && method === "POST") {
    const result = await authPresenter.login(request, response, body);
    return sendJson(response, 200, result);
  }

  if (resource === "logout" && method === "POST") {
    const user = await authPresenter.currentUser(request);
    const result = authPresenter.logout(request, response, user);
    return sendJson(response, 200, result);
  }

  if (!["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method)) {
    fail(405, "Método não permitido.");
  }
  const user = await authPresenter.currentUser(request);
  if (!["GET", "HEAD"].includes(method)) {
    authPresenter.validateSameOrigin(request);
    authPresenter.requireCsrf(request, user);
  }
  const presenter = presenters[resource];
  if (!presenter) fail(404, "Rota não encontrada.");
  if (resource === "dashboard" && (id || method !== "GET")) fail(405, "Método não permitido.");

  const result = resource === "dashboard"
    ? await presenter.getSummary(user)
    : await presenter.handle({ user, method, id, body });
  return sendJson(response, method === "POST" ? 201 : 200, { data: result });
}

async function view(request, response, url) {
  try {
    await handle(request, response, url);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (error instanceof ApiError) return sendJson(response, error.status, { error: error.message });
    if (error && error.code === "ER_DUP_ENTRY") {
      return sendJson(response, 409, { error: "Já existe um cadastro com esses dados." });
    }
    if (error && error.code === "ER_ROW_IS_REFERENCED_2") {
      return sendJson(response, 409, { error: "Não é possível excluir este registro porque ele está vinculado a vendas." });
    }
    if (error && ["ECONNREFUSED", "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR"].includes(error.code)) {
      console.error("Falha na conexão com MySQL:", error.code);
      return sendJson(response, 503, { error: "Não foi possível conectar ao MySQL. Confira a configuração do banco." });
    }
    console.error("Erro na API Navalha:", error);
    return sendJson(response, 500, { error: "Ocorreu um erro inesperado ao processar a solicitação." });
  }
}

module.exports = { view };
