"use strict";

const commissionModel = require("../models/commission.model");
const authPresenter = require("./auth.presenter");
const { fail } = require("../models/errors");

async function handle({ user, method, id, url }) {
  if (method !== "GET" || id) fail(405, "Método não permitido.");
  authPresenter.requirePermission(user, "commissions.view");
  if (!user.is_admin && user.role !== "barber") {
    fail(403, "Somente barbeiros podem consultar comissões próprias.");
  }
  return commissionModel.list({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    barberId: url.searchParams.get("barber_id"),
    user,
  });
}

module.exports = { handle };
