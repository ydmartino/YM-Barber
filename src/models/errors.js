"use strict";

const crypto = require("node:crypto");

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new ApiError(status, message);
}

function requiredString(body, key, maxLength) {
  const value = body[key];
  if (typeof value !== "string") fail(422, `O campo ${key} é obrigatório.`);
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > maxLength) {
    fail(422, `O campo ${key} é obrigatório e deve ter até ${maxLength} caracteres.`);
  }
  return trimmed;
}

function optionalText(body, key, maxLength) {
  const value = body[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || [...value].length > maxLength) {
    fail(422, `O campo ${key} deve ter até ${maxLength} caracteres.`);
  }
  return value.trim() || null;
}

function optionalEmail(body, key = "email") {
  const value = body[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") fail(422, "Informe um endereço de e-mail válido.");
  const email = value.trim().toLowerCase();
  if (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(422, "Informe um e-mail válido com até 190 caracteres.");
  }
  return email;
}

function positiveInteger(value, message) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(422, message);
  return number;
}

function productPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 99999999.99) {
    fail(422, "Informe um preço maior que zero, com até 8 dígitos antes das casas decimais.");
  }
  return number.toFixed(2);
}

function productStock(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 4294967295) {
    fail(422, "O estoque deve ser um número inteiro igual ou maior que zero.");
  }
  return number;
}

function passwordHash(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 200) {
    fail(422, "A senha deve ter entre 12 e 200 caracteres.");
  }
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const [algorithm, saltText, keyText] = stored.split("$");
  if (algorithm !== "scrypt" || !saltText || !keyText) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length > 0 && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

module.exports = {
  ApiError,
  fail,
  optionalEmail,
  optionalText,
  passwordHash,
  positiveInteger,
  productPrice,
  productStock,
  requiredString,
  verifyPassword,
};
