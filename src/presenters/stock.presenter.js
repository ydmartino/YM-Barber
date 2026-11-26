"use strict";

const productModel = require("../models/product.model");
const authPresenter = require("./auth.presenter");
const { fail, positiveInteger } = require("../models/errors");

async function handle({ user, method, id, body }) {
  authPresenter.requirePermission(user, "stock.manage");
  if (method !== "POST" || id !== "entry") fail(405, "Método não permitido.");
  const productId = positiveInteger(body.product_id, "Selecione um produto válido.");
  const quantity = positiveInteger(body.quantity, "A quantidade de entrada deve ser maior que zero.");
  const result = await productModel.receiveStock(productId, quantity, user.id);
  if (!result) fail(404, "Produto não encontrado.");
  return result;
}

module.exports = { handle };
