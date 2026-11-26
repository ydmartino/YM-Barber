"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  ApiError,
  optionalEmail,
  passwordHash,
  productPrice,
  productStock,
  requiredString,
  verifyPassword,
} = require("../../src/models/errors");
const authPresenter = require("../../src/presenters/auth.presenter");

test("requiredString trims values and validates length", () => {
  assert.equal(requiredString({ name: "  Marina  " }, "name", 10), "Marina");
  assert.throws(() => requiredString({ name: "Too long name" }, "name", 3), ApiError);
});

test("optionalEmail normalizes valid addresses and rejects invalid input", () => {
  assert.equal(optionalEmail({ email: " USER@Example.com " }), "user@example.com");
  assert.equal(optionalEmail({ email: "" }), null);
  assert.throws(() => optionalEmail({ email: "not-an-email" }), ApiError);
});

test("product values respect the MySQL field constraints", () => {
  assert.equal(productPrice(19.9), "19.90");
  assert.equal(productPrice(0), "0.00");
  assert.equal(productStock(0), 0);
  assert.throws(() => productPrice(-0.01), ApiError);
  assert.throws(() => productStock(-1), ApiError);
});

test("password hashes can be verified without storing plaintext", () => {
  const hash = passwordHash("Senha-de-teste-123");
  assert.notEqual(hash, "Senha-de-teste-123");
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(verifyPassword("Senha-de-teste-123", hash), true);
  assert.equal(verifyPassword("senha-errada", hash), false);
});

test("legacy scrypt passwords remain valid for login migration", () => {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync("Senha-legada-123", salt, 64);
  const legacyHash = `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
  assert.equal(verifyPassword("Senha-legada-123", legacyHash), true);
});

test("presenter permissions include module management and sale prerequisites", () => {
  const user = { is_admin: false, permissions: ["clients.manage", "sales.create"] };
  assert.equal(authPresenter.can(user, "clients.view"), true);
  assert.equal(authPresenter.can(user, "products.view"), true);
  assert.equal(authPresenter.can(user, "sales.view"), false);
  assert.equal(authPresenter.can({ is_admin: true, permissions: [] }, "users.manage"), true);
});
