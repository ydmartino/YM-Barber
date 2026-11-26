"use strict";

const { pool } = require("./database.model");
const { fail } = require("./errors");

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function list({ from, to, user, barberId = null }) {
  if (!isDate(from) || !isDate(to) || from > to) {
    fail(422, "Informe um período válido para consultar as comissões.");
  }
  const values = [`${from} 00:00:00`, `${to} 23:59:59`];
  const conditions = ["s.status = 'completed'", "s.sold_at >= ?", "s.sold_at <= ?"];
  if (!user.is_admin) {
    conditions.push("s.registered_by = ?");
    values.push(user.id);
  } else if (barberId) {
    const id = Number(barberId);
    if (!Number.isSafeInteger(id) || id < 1) fail(422, "Barbeiro inválido.");
    conditions.push("s.registered_by = ?");
    values.push(id);
  }
  const [rows] = await pool.execute(
    `SELECT s.id, s.sold_at, s.total, s.commission_percent, s.commission_amount,
            c.name AS client_name, u.name AS barber_name
     FROM sales s
     INNER JOIN clients c ON c.id = s.client_id
     LEFT JOIN users u ON u.id = s.registered_by
     WHERE ${conditions.join(" AND ")}
     ORDER BY s.sold_at DESC`,
    values
  );
  const total = rows.reduce((sum, row) => sum + Number(row.commission_amount), 0);
  return {
    total: Number(total.toFixed(2)),
    count: rows.length,
    sales: rows.map((row) => ({
      ...row,
      id: Number(row.id),
      total: Number(row.total),
      commission_percent: Number(row.commission_percent),
      commission_amount: Number(row.commission_amount),
    })),
  };
}

module.exports = { list };
