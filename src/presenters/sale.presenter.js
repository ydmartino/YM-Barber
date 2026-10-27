"use strict";

const saleModel = require("../models/sale.model");
const authPresenter = require("./auth.presenter");
const { fail, positiveInteger } = require("../models/errors");

async function handle({ user, method, id, body }) {
  if (method === "GET" && !id) {
    authPresenter.requirePermission(user, "sales.view");
    return saleModel.list();
  }
  authPresenter.requirePermission(user, "sales.create");
  if (method !== "POST" || id) fail(405, "Método não permitido.");

  if (!Array.isArray(body.items)) fail(422, "Adicione pelo menos um produto ou serviço à venda.");
  return saleModel.register({
    clientId: positiveInteger(body.client_id, "Selecione um cliente válido."),
    items: body.items,
    userId: user.id,
  });
}

module.exports = { handle };
