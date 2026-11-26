"use strict";

const { pool } = require("./database.model");

async function list() {
  const [rows] = await pool.query(
    "SELECT id, name, phone, email, consent_at, created_at FROM clients ORDER BY name LIMIT 500"
  );
  return rows;
}

async function create({ name, phone, email, userId }) {
  const [result] = await pool.execute(
    "INSERT INTO clients (name, phone, email, consent_at, created_by) VALUES (?, ?, ?, UTC_TIMESTAMP(), ?)",
    [name, phone, email, userId]
  );
  return { id: result.insertId };
}

async function update(id, { name, phone, email }) {
  const [result] = await pool.execute(
    "UPDATE clients SET name = ?, phone = ?, email = ?, consent_at = COALESCE(consent_at, UTC_TIMESTAMP()) WHERE id = ?",
    [name, phone, email, id]
  );
  if (result.affectedRows) return true;
  const [rows] = await pool.execute("SELECT id FROM clients WHERE id = ?", [id]);
  return rows.length > 0;
}

async function remove(id) {
  const [result] = await pool.execute("DELETE FROM clients WHERE id = ?", [id]);
  return result.affectedRows;
}

module.exports = { list, create, update, remove };
