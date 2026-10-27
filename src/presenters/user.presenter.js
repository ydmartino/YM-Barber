"use strict";

const userModel = require("../models/user.model");
const authPresenter = require("./auth.presenter");
const { fail, optionalEmail, passwordHash, positiveInteger, requiredString } = require("../models/errors");

function commissionPercent(body) {
  const value = Number(body.commission_percent);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    fail(422, "A comissão deve estar entre 0% e 100%.");
  }
  return value.toFixed(2);
}

function permissionIds(body, isAdmin) {
  if (isAdmin) return [];
  if (!Array.isArray(body.permission_ids) || body.permission_ids.length === 0 || body.permission_ids.length > 30) {
    fail(422, "Selecione ao menos uma permissão para o usuário.");
  }
  return body.permission_ids.map((permissionId) => positiveInteger(permissionId, "A lista de permissões é inválida."));
}

async function handle({ user, method, id, body }) {
  authPresenter.requireAdmin(user);
  if (method === "GET" && id === "permissions") return userModel.listPermissions();
  if (method === "GET" && !id) return userModel.list();

  if (method === "POST" && !id) {
    const email = optionalEmail(body);
    if (!email) fail(422, "Informe um e-mail válido.");
    const isAdmin = body.is_admin === true;
    return userModel.create({
      name: requiredString(body, "name", 120),
      email,
      passwordHash: passwordHash(body.password),
      isAdmin,
      commissionPercent: commissionPercent(body),
      permissionIds: permissionIds(body, isAdmin),
      grantedBy: user.id,
    });
  }

  if (method === "PUT" && id) {
    const targetId = positiveInteger(id, "Usuário não encontrado.");
    const name = requiredString(body, "name", 120);
    const email = optionalEmail(body);
    if (!email) fail(422, "Informe um e-mail válido.");
    const isAdmin = body.is_admin === true;
    const isActive = body.is_active !== false;
    if (targetId === user.id && (!isAdmin || !isActive)) {
      fail(422, "Não é possível desativar ou remover sua própria função de administrador.");
    }
    const result = await userModel.update({
      id: targetId,
      name,
      email,
      passwordHash: body.password ? passwordHash(body.password) : null,
      isAdmin,
      isActive,
      commissionPercent: commissionPercent(body),
      permissionIds: permissionIds(body, isAdmin),
      grantedBy: user.id,
    });
    if (result === false) fail(404, "Usuário não encontrado.");
    return result;
  }

  fail(405, "Método não permitido.");
}

module.exports = { handle };
