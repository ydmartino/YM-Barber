"use strict";

const { pool } = require("./database.model");

async function list() {
  const [rows] = await pool.query(
    "SELECT id, name, phone, email, created_at FROM clients ORDER BY name LIMIT 500"
  );
  return rows;
}

async function create({ name, phone, email, notes, userId }) {
  const [result] = await pool.execute(
    "INSERT INTO clients (name, phone, email, notes, created_by) VALUES (?, ?, ?, ?, ?)",
    [name, phone, email, notes, userId]
  );
  return { id: result.insertId };
}

async function update(id, { name, phone, email, notes }) {
  const [result] = await pool.execute(
    "UPDATE clients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?",
    [name, phone, email, notes, id]
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
