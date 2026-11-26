"use strict";

const saleModel = require("../models/sale.model");
const userModel = require("../models/user.model");
const authPresenter = require("./auth.presenter");
const { fail, optionalEmail, positiveInteger, verifyPassword } = require("../models/errors");

async function handle({ user, method, id, body }) {
  if (method === "GET") {
    authPresenter.requirePermission(user, "sales.view");
    const clientId = id ? positiveInteger(id, "Cliente não encontrado.") : null;
    return saleModel.list({ user, clientId });
  }
  authPresenter.requirePermission(user, "sales.create");
  if (method !== "POST" || id) fail(405, "Método não permitido.");

  if (!Array.isArray(body.items)) fail(422, "Adicione pelo menos um produto ou serviço à venda.");
  const requiresAuthorization = body.items.some((item) => Number(item?.discount_percent) > 15);
  let authorizedBy = null;
  if (requiresAuthorization) {
    const email = optionalEmail(body.discount_authorization || {}, "email");
    const password = body.discount_authorization?.password;
    if (!email || typeof password !== "string") {
      fail(403, "Descontos acima de 15% exigem credenciais de um administrador.");
    }
    const administrator = await userModel.findByEmail(email);
    if (!administrator?.is_admin || !verifyPassword(password, administrator.password_hash)) {
      fail(403, "A autorização do administrador não foi validada.");
    }
    authorizedBy = Number(administrator.id);
  } else if (body.discount_authorization) {
    fail(422, "Autorização de administrador só deve ser enviada para descontos acima de 15%.");
  }
  return saleModel.register({
    clientId: positiveInteger(body.client_id, "Selecione um cliente válido."),
    items: body.items,
    userId: user.id,
    authorizedBy,
  });
}

module.exports = { handle };
