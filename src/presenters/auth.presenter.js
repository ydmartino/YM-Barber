"use strict";

const crypto = require("node:crypto");
const userModel = require("../models/user.model");
const { ApiError, fail, optionalEmail, verifyPassword } = require("../models/errors");

const SESSION_COOKIE = "navalha_session";
const SESSION_LIFETIME = 8 * 60 * 60;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const impliedPermissions = {
  "clients.view": ["clients.manage", "sales.create"],
  "products.view": ["products.manage", "sales.create"],
};

function cookies(request) {
  const parsed = {};
  for (const item of (request.headers.cookie || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator > 0) {
      parsed[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
    }
  }
  return parsed;
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readSession(request) {
  const value = cookies(request)[SESSION_COOKIE];
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const encoded = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(encoded).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!Number.isSafeInteger(payload.userId) || !Number.isSafeInteger(payload.expiresAt) ||
        payload.expiresAt <= Math.floor(Date.now() / 1000) ||
        typeof payload.csrfToken !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(response, payload) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${signSession(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME}${secure}`
  );
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
  );
}

function validateSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail(403, "Origem da requisição inválida.");
  }
  if (parsed.host !== request.headers.host) fail(403, "Origem da requisição não autorizada.");
}

async function currentUser(request) {
  const session = readSession(request);
  if (!session) fail(401, "Faça login para continuar.");
  const user = await userModel.findById(session.userId);
  if (!user) fail(401, "Sua sessão expirou. Faça login novamente.");
  return { ...user, csrfToken: session.csrfToken };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    is_admin: user.is_admin,
    permissions: user.permissions,
  };
}

function can(user, permission) {
  return user.is_admin || user.permissions.includes(permission) ||
    (impliedPermissions[permission] || []).some((granted) => user.permissions.includes(granted));
}

function requirePermission(user, permission) {
  if (!can(user, permission)) fail(403, "Você não tem permissão para executar esta ação.");
}

function requireAnyPermission(user, permissions) {
  if (!permissions.some((permission) => can(user, permission))) {
    fail(403, "Você não tem permissão para executar esta ação.");
  }
}

function requireAdmin(user) {
  if (!user.is_admin) fail(403, "Somente administradores podem gerenciar usuários e permissões.");
}

function requireCsrf(request, user) {
  const expected = Buffer.from(user.csrfToken);
  const supplied = request.headers["x-csrf-token"];
  const received = Buffer.from(typeof supplied === "string" ? supplied : "");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    fail(403, "Token de segurança inválido. Atualize a página e tente novamente.");
  }
}

async function getSession(request) {
  const session = readSession(request);
  if (!session) return { authenticated: false };
  try {
    const user = await currentUser(request);
    return {
      authenticated: true,
      csrf_token: session.csrfToken,
      user: publicUser(user),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { authenticated: false };
    throw error;
  }
}

async function login(request, response, body) {
  validateSameOrigin(request);
  const email = optionalEmail(body);
  const password = body.password;
  if (!email || typeof password !== "string") fail(422, "Informe e-mail e senha.");
  const account = await userModel.findByEmail(email);
  if (!account || !verifyPassword(password, account.password_hash)) {
    fail(401, "E-mail ou senha incorretos.");
  }
  const session = {
    userId: Number(account.id),
    csrfToken: crypto.randomBytes(32).toString("hex"),
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_LIFETIME,
  };
  setSessionCookie(response, session);
  const user = await userModel.findById(session.userId);
  return { user: publicUser(user), csrf_token: session.csrfToken };
}

function logout(request, response, user) {
  validateSameOrigin(request);
  requireCsrf(request, user);
  clearSessionCookie(response);
  return { logged_out: true };
}

module.exports = {
  can,
  clearSessionCookie,
  currentUser,
  getSession,
  login,
  logout,
  publicUser,
  requireAdmin,
  requireAnyPermission,
  requireCsrf,
  requirePermission,
  setSessionCookie,
  validateSameOrigin,
};
