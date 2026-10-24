"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

loadEnvironment();

const ROOT = __dirname;
const API_PREFIX = "/api";
const SESSION_COOKIE = "navalha_session";
const SESSION_LIFETIME = 8 * 60 * 60;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const MAX_BODY_SIZE = 1024 * 1024;
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || "navalha",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
  timezone: "Z",
  decimalNumbers: true,
});

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function loadEnvironment() {
  const filename = path.join(__dirname, ".env");
  if (!fs.existsSync(filename)) return;
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function fail(status, message) {
  throw new ApiError(status, message);
}

function cookies(request) {
  const header = request.headers.cookie || "";
  const parsed = {};
  for (const chunk of header.split(";")) {
    const separator = chunk.indexOf("=");
    if (separator > 0) {
      parsed[chunk.slice(0, separator).trim()] = chunk.slice(separator + 1).trim();
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
  let supplied;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
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
  const value = signSession(payload);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME}${secure}`
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
  const host = request.headers.host;
  if (parsed.host !== host) fail(403, "Origem da requisição não autorizada.");
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) fail(413, "A requisição excede o tamanho máximo permitido.");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "O corpo deve ser um objeto JSON.");
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, "O corpo da requisição deve conter JSON válido.");
  }
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

async function currentUser(request) {
  const session = readSession(request);
  if (!session) fail(401, "Faça login para continuar.");
  const [rows] = await pool.execute(
    "SELECT id, name, email, is_admin, is_active FROM users WHERE id = ?",
    [session.userId]
  );
  const user = rows[0];
  if (!user || !user.is_active) fail(401, "Sua sessão expirou. Faça login novamente.");
  const [grants] = user.is_admin
    ? [[], []]
    : await pool.execute(
      `SELECT p.code FROM permissions p
       INNER JOIN user_permissions up ON up.permission_id = p.id
       WHERE up.user_id = ?`,
      [user.id]
    );
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    is_admin: Boolean(user.is_admin),
    is_active: Boolean(user.is_active),
    permissions: grants.map((permission) => permission.code),
    csrfToken: session.csrfToken,
  };
}

const impliedPermissions = {
  "clients.view": ["clients.manage", "sales.create"],
  "products.view": ["products.manage", "sales.create"],
};

function can(user, permission) {
  return user.is_admin || user.permissions.includes(permission) ||
    (impliedPermissions[permission] || []).some((grant) => user.permissions.includes(grant));
}

async function requirePermission(request, permission) {
  const user = await currentUser(request);
  if (!can(user, permission)) fail(403, "Você não tem permissão para executar esta ação.");
  return user;
}

async function requireAnyPermission(request, permissions) {
  const user = await currentUser(request);
  if (!permissions.some((permission) => can(user, permission))) {
    fail(403, "Você não tem permissão para executar esta ação.");
  }
  return user;
}

async function requireAdmin(request) {
  const user = await currentUser(request);
  if (!user.is_admin) fail(403, "Somente administradores podem gerenciar usuários e permissões.");
  return user;
}

function requireCsrf(request, user) {
  const supplied = request.headers["x-csrf-token"];
  const expected = Buffer.from(user.csrfToken);
  const received = Buffer.from(typeof supplied === "string" ? supplied : "");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    fail(403, "Token de segurança inválido. Atualize a página e tente novamente.");
  }
}

async function syncPermissions(connection, userId, permissionIds, grantedBy) {
  if (!Array.isArray(permissionIds) || permissionIds.length > 30) {
    fail(422, "A lista de permissões é inválida.");
  }
  const normalized = [...new Set(permissionIds.map((id) => positiveInteger(id, "Permissão inválida.")))];
  if (normalized.length === 0) fail(422, "Selecione ao menos uma permissão para o usuário.");
  const placeholders = normalized.map(() => "?").join(",");
  const [existing] = await connection.execute(
    `SELECT id FROM permissions WHERE id IN (${placeholders})`,
    normalized
  );
  if (existing.length !== normalized.length) fail(422, "Uma ou mais permissões não são válidas.");
  await connection.execute("DELETE FROM user_permissions WHERE user_id = ?", [userId]);
  for (const permissionId of normalized) {
    await connection.execute(
      "INSERT INTO user_permissions (user_id, permission_id, granted_by) VALUES (?, ?, ?)",
      [userId, permissionId, grantedBy]
    );
  }
}

async function inTransaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function dashboard(request) {
  const user = await requirePermission(request, "dashboard.view");
  const [[today]] = await pool.query(
    "SELECT COUNT(*) AS sale_count, COALESCE(SUM(total), 0) AS total FROM sales WHERE status = 'completed' AND sold_at >= UTC_DATE()"
  );
  const [[clientCount]] = await pool.query("SELECT COUNT(*) AS count FROM clients");
  const [[products]] = await pool.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(stock), 0) AS stock,
            COALESCE(SUM(stock <= low_stock_threshold), 0) AS low_stock
     FROM products WHERE is_active = 1`
  );
  const [recent] = can(user, "sales.view")
    ? await pool.query(
      `SELECT s.id, c.name AS client_name, s.sold_at, s.total,
              GROUP_CONCAT(CONCAT(si.product_name, ' (', si.quantity, ')')
                ORDER BY si.id SEPARATOR ', ') AS products
       FROM sales s
       INNER JOIN clients c ON c.id = s.client_id
       INNER JOIN sale_items si ON si.sale_id = s.id
       WHERE s.status = 'completed'
       GROUP BY s.id, c.name, s.sold_at, s.total
       ORDER BY s.sold_at DESC LIMIT 5`
    )
    : [[]];
  return {
    today: { count: Number(today.sale_count), total: Number(today.total) },
    clients: Number(clientCount.count),
    products: {
      count: Number(products.count),
      stock: Number(products.stock),
      low_stock: Number(products.low_stock),
    },
    recent_sales: recent.map((sale) => ({
      id: Number(sale.id),
      client_name: sale.client_name,
      product_name: sale.products,
      date: sale.sold_at,
      total: Number(sale.total),
    })),
  };
}

async function handleClients(request, method, id, body) {
  if (method === "GET" && !id) {
    await requireAnyPermission(request, ["clients.view", "sales.create"]);
    const [rows] = await pool.query(
      "SELECT id, name, phone, email, created_at FROM clients ORDER BY name LIMIT 500"
    );
    return rows;
  }
  const actor = await requirePermission(request, "clients.manage");
  if (method === "POST" && !id) {
    const [result] = await pool.execute(
      "INSERT INTO clients (name, phone, email, notes, created_by) VALUES (?, ?, ?, ?, ?)",
      [
        requiredString(body, "name", 120),
        requiredString(body, "phone", 30),
        optionalEmail(body),
        optionalText(body, "notes", 5000),
        actor.id,
      ]
    );
    return { id: result.insertId };
  }
  if (method === "PUT" && id) {
    const clientId = positiveInteger(id, "Cliente não encontrado.");
    const [result] = await pool.execute(
      "UPDATE clients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?",
      [
        requiredString(body, "name", 120),
        requiredString(body, "phone", 30),
        optionalEmail(body),
        optionalText(body, "notes", 5000),
        clientId,
      ]
    );
    if (!result.affectedRows) fail(404, "Cliente não encontrado.");
    return { updated: true };
  }
  if (method === "DELETE" && id) {
    const [result] = await pool.execute("DELETE FROM clients WHERE id = ?", [
      positiveInteger(id, "Cliente não encontrado."),
    ]);
    if (!result.affectedRows) fail(404, "Cliente não encontrado.");
    return { deleted: true };
  }
  fail(405, "Método não permitido.");
}

async function handleProducts(request, method, id, body) {
  if (method === "GET" && !id) {
    await requireAnyPermission(request, ["products.view", "sales.create"]);
    const [rows] = await pool.query(
      `SELECT id, name, category, price, stock, low_stock_threshold
       FROM products WHERE is_active = 1 ORDER BY name LIMIT 500`
    );
    return rows;
  }
  const actor = await requirePermission(request, "products.manage");
  if (method === "POST" && !id) {
    const name = requiredString(body, "name", 120);
    const category = requiredString(body, "category", 80);
    const price = productPrice(body.price);
    const stock = productStock(body.stock);
    return inTransaction(async (connection) => {
      const [result] = await connection.execute(
        "INSERT INTO products (name, category, price, stock, created_by) VALUES (?, ?, ?, ?, ?)",
        [name, category, price, stock, actor.id]
      );
      if (stock > 0) {
        await connection.execute(
          `INSERT INTO stock_movements
           (product_id, user_id, movement_type, quantity_change, stock_after, notes)
           VALUES (?, ?, 'initial', ?, ?, 'Estoque inicial')`,
          [result.insertId, actor.id, stock, stock]
        );
      }
      return { id: result.insertId };
    });
  }
  if (method === "PUT" && id) {
    const productId = positiveInteger(id, "Produto não encontrado.");
    const name = requiredString(body, "name", 120);
    const category = requiredString(body, "category", 80);
    const price = productPrice(body.price);
    const stock = productStock(body.stock);
    return inTransaction(async (connection) => {
      const [rows] = await connection.execute(
        "SELECT stock FROM products WHERE id = ? AND is_active = 1 FOR UPDATE",
        [productId]
      );
      if (!rows.length) fail(404, "Produto não encontrado.");
      const previousStock = Number(rows[0].stock);
      await connection.execute(
        "UPDATE products SET name = ?, category = ?, price = ?, stock = ? WHERE id = ?",
        [name, category, price, stock, productId]
      );
      const change = stock - previousStock;
      if (change !== 0) {
        await connection.execute(
          `INSERT INTO stock_movements
           (product_id, user_id, movement_type, quantity_change, stock_after, notes)
           VALUES (?, ?, 'adjustment', ?, ?, 'Ajuste manual de estoque')`,
          [productId, actor.id, change, stock]
        );
      }
      return { updated: true };
    });
  }
  if (method === "DELETE" && id) {
    const [result] = await pool.execute(
      "UPDATE products SET is_active = 0 WHERE id = ? AND is_active = 1",
      [positiveInteger(id, "Produto não encontrado.")]
    );
    if (!result.affectedRows) fail(404, "Produto não encontrado.");
    return { deleted: true };
  }
  fail(405, "Método não permitido.");
}

async function handleSales(request, method, id, body) {
  if (method === "GET" && !id) {
    await requirePermission(request, "sales.view");
    const [rows] = await pool.query(
      `SELECT s.id, s.client_id, c.name AS client_name, s.total, s.sold_at AS date,
              GROUP_CONCAT(CONCAT(si.product_name, ' (', si.quantity, ')')
                ORDER BY si.id SEPARATOR ', ') AS product_name,
              SUM(si.quantity) AS quantity
       FROM sales s
       INNER JOIN clients c ON c.id = s.client_id
       INNER JOIN sale_items si ON si.sale_id = s.id
       WHERE s.status = 'completed'
       GROUP BY s.id, s.client_id, c.name, s.total, s.sold_at
       ORDER BY s.sold_at DESC LIMIT 500`
    );
    return rows;
  }
  const actor = await requirePermission(request, "sales.create");
  if (method !== "POST" || id) fail(405, "Método não permitido.");
  const clientId = positiveInteger(body.client_id, "Selecione um cliente válido.");
  const productId = positiveInteger(body.product_id, "Selecione um produto válido.");
  const quantity = positiveInteger(body.quantity, "Informe uma quantidade válida.");
  if (quantity > 10000) fail(422, "A quantidade não pode exceder 10.000 unidades.");

  return inTransaction(async (connection) => {
    const [clientsFound] = await connection.execute("SELECT id FROM clients WHERE id = ?", [clientId]);
    if (!clientsFound.length) fail(422, "O cliente selecionado não existe.");
    const [productsFound] = await connection.execute(
      "SELECT id, name, price, stock FROM products WHERE id = ? AND is_active = 1 FOR UPDATE",
      [productId]
    );
    const product = productsFound[0];
    if (!product) fail(422, "O produto selecionado não existe ou está inativo.");
    if (Number(product.stock) < quantity) fail(409, "Estoque insuficiente para essa quantidade.");
    const unitCents = Math.round(Number(product.price) * 100);
    const total = ((unitCents * quantity) / 100).toFixed(2);
    const [sale] = await connection.execute(
      "INSERT INTO sales (client_id, registered_by, total) VALUES (?, ?, ?)",
      [clientId, actor.id, total]
    );
    await connection.execute(
      `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sale.insertId, productId, product.name, quantity, product.price, total]
    );
    const stockAfter = Number(product.stock) - quantity;
    await connection.execute("UPDATE products SET stock = ? WHERE id = ?", [stockAfter, productId]);
    await connection.execute(
      `INSERT INTO stock_movements
       (product_id, user_id, sale_id, movement_type, quantity_change, stock_after, notes)
       VALUES (?, ?, ?, 'sale', ?, ?, 'Saída por venda')`,
      [productId, actor.id, sale.insertId, -quantity, stockAfter]
    );
    return { id: sale.insertId, total: Number(total), stock: stockAfter };
  });
}

async function handleUsers(request, method, id, body) {
  const actor = await requireAdmin(request);
  if (method === "GET" && id === "permissions") {
    const [rows] = await pool.query("SELECT id, code, name, description FROM permissions ORDER BY id");
    return rows;
  }
  if (method === "GET" && !id) {
    const [users] = await pool.query(
      "SELECT id, name, email, is_admin, is_active, created_at FROM users ORDER BY name"
    );
    const [grants] = await pool.query(
      `SELECT up.user_id, p.code FROM user_permissions up
       INNER JOIN permissions p ON p.id = up.permission_id`
    );
    const byUser = new Map();
    for (const grant of grants) {
      if (!byUser.has(Number(grant.user_id))) byUser.set(Number(grant.user_id), []);
      byUser.get(Number(grant.user_id)).push(grant.code);
    }
    return users.map((user) => ({
      ...user,
      id: Number(user.id),
      is_admin: Boolean(user.is_admin),
      is_active: Boolean(user.is_active),
      permissions: byUser.get(Number(user.id)) || [],
    }));
  }
  if (method === "POST" && !id) {
    const name = requiredString(body, "name", 120);
    const email = optionalEmail(body);
    if (!email) fail(422, "Informe um e-mail válido.");
    const isAdmin = Boolean(body.is_admin);
    const permissions = isAdmin ? [] : body.permission_ids;
    if (!isAdmin && (!Array.isArray(permissions) || permissions.length === 0)) {
      fail(422, "Selecione ao menos uma permissão para o usuário.");
    }
    const password = passwordHash(body.password);
    return inTransaction(async (connection) => {
      const [result] = await connection.execute(
        "INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, ?)",
        [name, email, password, Number(isAdmin)]
      );
      if (!isAdmin) await syncPermissions(connection, result.insertId, permissions, actor.id);
      return { id: result.insertId };
    });
  }
  if (method === "PUT" && id) {
    const userId = positiveInteger(id, "Usuário não encontrado.");
    const name = requiredString(body, "name", 120);
    const email = optionalEmail(body);
    if (!email) fail(422, "Informe um e-mail válido.");
    const isAdmin = Boolean(body.is_admin);
    const isActive = body.is_active !== false;
    if (userId === actor.id && (!isAdmin || !isActive)) {
      fail(422, "Não é possível desativar ou remover sua própria função de administrador.");
    }
    const permissions = isAdmin ? [] : body.permission_ids;
    if (!isAdmin && (!Array.isArray(permissions) || permissions.length === 0)) {
      fail(422, "Selecione ao menos uma permissão para o usuário.");
    }
    const newPassword = body.password ? passwordHash(body.password) : null;
    return inTransaction(async (connection) => {
      const [rows] = await connection.execute(
        "SELECT is_admin, is_active FROM users WHERE id = ? FOR UPDATE",
        [userId]
      );
      if (!rows.length) fail(404, "Usuário não encontrado.");
      const removingAdmin = Boolean(rows[0].is_admin) && (!isAdmin || !isActive);
      if (removingAdmin) {
        const [admins] = await connection.query(
          "SELECT id FROM users WHERE is_admin = 1 AND is_active = 1 FOR UPDATE"
        );
        if (admins.length <= 1) fail(409, "O sistema precisa manter pelo menos um administrador ativo.");
      }
      const fields = ["name = ?", "email = ?", "is_admin = ?", "is_active = ?"];
      const values = [name, email, Number(isAdmin), Number(isActive)];
      if (newPassword) {
        fields.push("password_hash = ?");
        values.push(newPassword);
      }
      values.push(userId);
      await connection.execute(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
      if (isAdmin) {
        await connection.execute("DELETE FROM user_permissions WHERE user_id = ?", [userId]);
      } else {
        await syncPermissions(connection, userId, permissions, actor.id);
      }
      return { updated: true };
    });
  }
  fail(405, "Método não permitido.");
}

async function handleApi(request, response, url) {
  const method = request.method || "GET";
  const route = url.searchParams.get("route") || "";
  const parts = route.split("/").filter(Boolean);
  if (parts.length > 2 || parts.some((part) => !/^[a-z-]+$|^\d+$/.test(part))) {
    fail(400, "A rota solicitada é inválida.");
  }
  const [resource, id] = parts;
  if (method === "OPTIONS") {
    response.writeHead(204, { Allow: "GET, POST, PUT, DELETE, OPTIONS" });
    return response.end();
  }
  const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(request) : {};

  if (resource === "session" && method === "GET") {
    const session = readSession(request);
    if (!session) return sendJson(response, 200, { authenticated: false });
    try {
      const user = await currentUser(request);
      return sendJson(response, 200, {
        authenticated: true,
        csrf_token: session.csrfToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          is_admin: user.is_admin,
          permissions: user.permissions,
        },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearSessionCookie(response);
        return sendJson(response, 200, { authenticated: false });
      }
      throw error;
    }
  }

  if (resource === "login" && method === "POST") {
    validateSameOrigin(request);
    const email = optionalEmail(body);
    const password = body.password;
    if (!email || typeof password !== "string") fail(422, "Informe e-mail e senha.");
    const [rows] = await pool.execute(
      "SELECT id, password_hash FROM users WHERE email = ? AND is_active = 1",
      [email]
    );
    if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
      fail(401, "E-mail ou senha incorretos.");
    }
    const session = {
      userId: Number(rows[0].id),
      csrfToken: crypto.randomBytes(32).toString("hex"),
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_LIFETIME,
    };
    setSessionCookie(response, session);
    const user = await currentUser({ headers: { cookie: `${SESSION_COOKIE}=${signSession(session)}` } });
    return sendJson(response, 200, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        is_admin: user.is_admin,
        permissions: user.permissions,
      },
      csrf_token: session.csrfToken,
    });
  }

  if (resource === "logout" && method === "POST") {
    const user = await currentUser(request);
    validateSameOrigin(request);
    requireCsrf(request, user);
    clearSessionCookie(response);
    return sendJson(response, 200, { logged_out: true });
  }

  if (!["GET", "POST", "PUT", "DELETE"].includes(method)) fail(405, "Método não permitido.");
  if (!["GET", "HEAD"].includes(method)) validateSameOrigin(request);

  let current = null;
  if (!["GET", "HEAD"].includes(method)) {
    current = await currentUser(request);
    requireCsrf(request, current);
  }

  let result;
  if (resource === "dashboard" && method === "GET" && !id) result = await dashboard(request);
  else if (resource === "clients") result = await handleClients(request, method, id, body);
  else if (resource === "products") result = await handleProducts(request, method, id, body);
  else if (resource === "sales") result = await handleSales(request, method, id, body);
  else if (resource === "users") result = await handleUsers(request, method, id, body);
  else fail(404, "Rota não encontrada.");

  sendJson(response, method === "POST" ? 201 : 200, { data: result });
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveStatic(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(response, 400, { error: "Caminho de arquivo inválido." });
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filename = path.resolve(ROOT, relative);
  if (!filename.startsWith(`${ROOT}${path.sep}`) || relative.startsWith("api/") ||
      relative === ".env" || relative.startsWith("node_modules/") || relative.split(/[\\/]/).some((part) => part.startsWith("."))) {
    return sendJson(response, 404, { error: "Arquivo não encontrado." });
  }
  let content;
  try {
    content = await fs.promises.readFile(filename);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      return sendJson(response, 404, { error: "Arquivo não encontrado." });
    }
    throw error;
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filename).toLowerCase()] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === API_PREFIX) {
      await handleApi(request, response, url);
    } else {
      await serveStatic(request, response, url);
    }
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (error instanceof ApiError) return sendJson(response, error.status, { error: error.message });
    if (error && error.code === "ER_DUP_ENTRY") {
      return sendJson(response, 409, { error: "Já existe um cadastro com esses dados." });
    }
    if (error && error.code === "ER_ROW_IS_REFERENCED_2") {
      return sendJson(response, 409, { error: "Não é possível excluir este registro porque ele está vinculado a vendas." });
    }
    if (error && ["ECONNREFUSED", "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR"].includes(error.code)) {
      console.error("Falha na conexão com MySQL:", error.code);
      return sendJson(response, 503, { error: "Não foi possível conectar ao MySQL. Confira a configuração do banco." });
    }
    console.error("Erro na API Navalha:", error);
    sendJson(response, 500, { error: "Ocorreu um erro inesperado ao processar a solicitação." });
  }
});

const port = Number(process.env.PORT || 8000);
server.listen(port, "0.0.0.0", async () => {
  console.log(`Navalha disponível em http://localhost:${port}`);
  if (!process.env.SESSION_SECRET) {
    console.warn("SESSION_SECRET não definido: sessões existentes serão encerradas ao reiniciar o servidor.");
  }
  try {
    await pool.query("SELECT 1");
    console.log("Conexão com MySQL estabelecida.");
  } catch (error) {
    console.error("MySQL ainda não está acessível:", error.code || error.message);
  }
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
