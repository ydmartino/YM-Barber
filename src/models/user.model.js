"use strict";

const { pool, transaction } = require("./database.model");
const { ApiError } = require("./errors");

async function findByEmail(email) {
  const [rows] = await pool.execute(
    "SELECT id, password_hash, is_admin, commission_percent FROM users WHERE email = ? AND is_active = 1",
    [email]
  );
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.execute(
    "SELECT id, name, email, is_admin, is_active, role, commission_percent FROM users WHERE id = ?",
    [id]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  const [permissions] = user.is_admin
    ? [[]]
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
    role: user.is_admin ? "admin" : user.role,
    is_active: Boolean(user.is_active),
    commission_percent: Number(user.commission_percent),
    permissions: permissions.map((permission) => permission.code),
  };
}

async function list() {
  const [users] = await pool.query(
    "SELECT id, name, email, is_admin, is_active, role, commission_percent, created_at FROM users ORDER BY name"
  );
  const [grants] = await pool.query(
    `SELECT up.user_id, p.code FROM user_permissions up
     INNER JOIN permissions p ON p.id = up.permission_id`
  );
  const permissionsByUser = new Map();
  for (const grant of grants) {
    const userId = Number(grant.user_id);
    if (!permissionsByUser.has(userId)) permissionsByUser.set(userId, []);
    permissionsByUser.get(userId).push(grant.code);
  }
  return users.map((user) => ({
    ...user,
    id: Number(user.id),
    is_admin: Boolean(user.is_admin),
    role: user.is_admin ? "admin" : user.role,
    is_active: Boolean(user.is_active),
    commission_percent: Number(user.commission_percent),
    permissions: permissionsByUser.get(Number(user.id)) || [],
  }));
}

async function listPermissions() {
  const [rows] = await pool.query(
    "SELECT id, code, name, description FROM permissions ORDER BY id"
  );
  return rows;
}

async function syncPermissions(connection, userId, permissionIds, grantedBy) {
  if (!Array.isArray(permissionIds) || permissionIds.length === 0 || permissionIds.length > 30) {
    throw new ApiError(422, "A lista de permissões é inválida.");
  }
  const normalized = [...new Set(permissionIds)];
  if (normalized.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new ApiError(422, "A lista de permissões é inválida.");
  }
  const placeholders = normalized.map(() => "?").join(",");
  const [existing] = await connection.execute(
    `SELECT id FROM permissions WHERE id IN (${placeholders})`,
    normalized
  );
  if (existing.length !== normalized.length) {
    throw new ApiError(422, "Uma ou mais permissões não são válidas.");
  }
  await connection.execute("DELETE FROM user_permissions WHERE user_id = ?", [userId]);
  for (const permissionId of normalized) {
    await connection.execute(
      "INSERT INTO user_permissions (user_id, permission_id, granted_by) VALUES (?, ?, ?)",
      [userId, permissionId, grantedBy]
    );
  }
}

async function create({ name, email, passwordHash, isAdmin, role = "barber", commissionPercent, permissionIds, grantedBy }) {
  return transaction(async (connection) => {
    const [result] = await connection.execute(
      "INSERT INTO users (name, email, password_hash, is_admin, role, commission_percent) VALUES (?, ?, ?, ?, ?, ?)",
      [name, email, passwordHash, Number(isAdmin), role, commissionPercent]
    );
    if (!isAdmin) await syncPermissions(connection, result.insertId, permissionIds, grantedBy);
    if (role === "barber") {
      for (const weekday of [2, 3, 4, 5, 6]) {
        await connection.execute(
          "INSERT INTO working_hours (barber_id, weekday, start_time, end_time) VALUES (?, ?, '09:00', '20:00')",
          [result.insertId, weekday]
        );
      }
    }
    return { id: result.insertId };
  });
}

async function update({
  id,
  name,
  email,
  passwordHash,
  isAdmin,
  role = "barber",
  isActive,
  commissionPercent,
  permissionIds,
  grantedBy,
}) {
  return transaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT is_admin, is_active, role FROM users WHERE id = ? FOR UPDATE",
      [id]
    );
    if (!rows.length) return false;
    const removingActiveAdmin = Boolean(rows[0].is_admin) && (!isAdmin || !isActive);
    if (removingActiveAdmin) {
      const [admins] = await connection.query(
        "SELECT id FROM users WHERE is_admin = 1 AND is_active = 1 FOR UPDATE"
      );
      if (admins.length <= 1) {
        throw new ApiError(409, "O sistema precisa manter pelo menos um administrador ativo.");
      }
    }

    const assignments = ["name = ?", "email = ?", "is_admin = ?", "role = ?", "is_active = ?", "commission_percent = ?"];
    const values = [name, email, Number(isAdmin), role, Number(isActive), commissionPercent];
    if (passwordHash) {
      assignments.push("password_hash = ?");
      values.push(passwordHash);
    }
    values.push(id);
    await connection.execute(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`, values);
    if (role === "barber" && rows[0].role !== "barber") {
      for (const weekday of [2, 3, 4, 5, 6]) {
        await connection.execute(
          "INSERT IGNORE INTO working_hours (barber_id, weekday, start_time, end_time) VALUES (?, ?, '09:00', '20:00')",
          [id, weekday]
        );
      }
    }
    if (isAdmin) {
      await connection.execute("DELETE FROM user_permissions WHERE user_id = ?", [id]);
    } else {
      await syncPermissions(connection, id, permissionIds, grantedBy);
    }
    return { updated: true };
  });
}

async function replacePasswordHash(id, passwordHash) {
  await pool.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, id]);
}

async function loginLock(email) {
  const [rows] = await pool.execute(
    "SELECT failed_attempts, locked_until FROM login_attempts WHERE email = ?",
    [email]
  );
  return rows[0] || null;
}

async function recordLoginFailure(email) {
  return transaction(async (connection) => {
    await connection.execute("INSERT IGNORE INTO login_attempts (email) VALUES (?)", [email]);
    const [rows] = await connection.execute(
      "SELECT failed_attempts, locked_until FROM login_attempts WHERE email = ? FOR UPDATE",
      [email]
    );
    const lockedUntil = rows[0].locked_until;
    if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
      return { locked: true };
    }
    const attempts = lockedUntil ? 1 : Number(rows[0].failed_attempts) + 1;
    const locked = attempts >= 5;
    await connection.execute(
      `UPDATE login_attempts SET failed_attempts = ?, locked_until = ${locked
        ? "DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)"
        : "NULL"} WHERE email = ?`,
      [attempts, email]
    );
    return { locked };
  });
}

async function clearLoginFailures(email) {
  await pool.execute("DELETE FROM login_attempts WHERE email = ?", [email]);
}

module.exports = {
  findByEmail,
  findById,
  list,
  listPermissions,
  create,
  update,
  replacePasswordHash,
  loginLock,
  recordLoginFailure,
  clearLoginFailures,
};
