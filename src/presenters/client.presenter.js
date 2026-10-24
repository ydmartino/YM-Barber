"use strict";

const clientModel = require("../models/client.model");
const authPresenter = require("./auth.presenter");
const { fail, optionalEmail, optionalText, requiredString } = require("../models/errors");

async function handle({ user, method, id, body }) {
  if (method === "GET" && !id) {
    authPresenter.requireAnyPermission(user, ["clients.view", "sales.create"]);
    return clientModel.list();
  }
  authPresenter.requirePermission(user, "clients.manage");
  if (method === "POST" && !id) {
    return clientModel.create({
      name: requiredString(body, "name", 120),
      phone: requiredString(body, "phone", 30),
      email: optionalEmail(body),
      notes: optionalText(body, "notes", 5000),
      userId: user.id,
    });
  }
  if (method === "PUT" && id) {
    const updated = await clientModel.update(id, {
      name: requiredString(body, "name", 120),
      phone: requiredString(body, "phone", 30),
      email: optionalEmail(body),
      notes: optionalText(body, "notes", 5000),
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
