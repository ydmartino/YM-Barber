"use strict";

const productModel = require("../models/product.model");
const authPresenter = require("./auth.presenter");
const { fail, positiveInteger, productPrice, productStock, requiredString } = require("../models/errors");

function productInput(body, userId) {
  return {
    name: requiredString(body, "name", 120),
    category: requiredString(body, "category", 80),
    price: productPrice(body.price),
    stock: productStock(body.stock),
    userId,
  };
}

async function handle({ user, method, id, body }) {
  if (method === "GET" && !id) {
    authPresenter.requireAnyPermission(user, ["products.view", "sales.create"]);
    return productModel.list();
  }
  authPresenter.requirePermission(user, "products.manage");
  if (method === "POST" && !id) {
    return productModel.create(productInput(body, user.id));
  }
  if (method === "PUT" && id) {
    const updated = await productModel.update(positiveInteger(id, "Produto não encontrado."), productInput(body, user.id));
    if (!updated) fail(404, "Produto não encontrado.");
    return { updated: true };
  }
  if (method === "DELETE" && id) {
    if (!await productModel.deactivate(positiveInteger(id, "Produto não encontrado."))) {
      fail(404, "Produto não encontrado.");
    }
    return { deleted: true };
  }
  fail(405, "Método não permitido.");
}

module.exports = { handle };
