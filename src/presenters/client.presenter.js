"use strict";

const clientModel = require("../models/client.model");
const authPresenter = require("./auth.presenter");
const { fail, optionalEmail, requiredString } = require("../models/errors");

async function handle({ user, method, id, body }) {
  if (method === "GET" && !id) {
    authPresenter.requireAnyPermission(user, ["clients.view", "sales.create"]);
    return clientModel.list();
  }
  authPresenter.requirePermission(user, "clients.manage");
  if (method === "POST" && !id) {
    if (body.consent !== true) fail(422, "O consentimento para o tratamento dos dados é obrigatório.");
    return clientModel.create({
      name: requiredString(body, "name", 120),
      phone: requiredString(body, "phone", 30),
      email: optionalEmail(body),
      userId: user.id,
    });
  }
  if (method === "PUT" && id) {
    if (body.consent !== true) fail(422, "O consentimento para o tratamento dos dados é obrigatório.");
    const updated = await clientModel.update(id, {
      name: requiredString(body, "name", 120),
      phone: requiredString(body, "phone", 30),
      email: optionalEmail(body),
    });
    if (!updated) fail(404, "Cliente não encontrado.");
    return { updated: true };
  }
  if (method === "DELETE" && id) {
    if (!await clientModel.remove(id)) fail(404, "Cliente não encontrado.");
    return { deleted: true };
  }
  fail(405, "Método não permitido.");
}

module.exports = { handle };
