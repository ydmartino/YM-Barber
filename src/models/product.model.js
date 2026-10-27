"use strict";

const { pool, transaction } = require("./database.model");

async function list() {
  const [rows] = await pool.query(
    `SELECT id, name, category, price, discount_percent, stock, low_stock_threshold, item_type
     FROM products WHERE is_active = 1 ORDER BY name LIMIT 500`
  );
  return rows;
}

async function create({ name, category, price, discountPercent, stock, itemType, userId }) {
  return transaction(async (connection) => {
    const [result] = await connection.execute(
      "INSERT INTO products (name, category, price, discount_percent, stock, item_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [name, category, price, discountPercent, stock, itemType, userId]
    );
    if (itemType === "P" && stock > 0) {
      await connection.execute(
        `INSERT INTO stock_movements
         (product_id, user_id, movement_type, quantity_change, stock_after, notes)
         VALUES (?, ?, 'initial', ?, ?, 'Estoque inicial')`,
        [result.insertId, userId, stock, stock]
      );
    }
    return { id: result.insertId };
  });
}

async function update(id, { name, category, price, discountPercent, stock, itemType, userId }) {
  return transaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT stock, item_type FROM products WHERE id = ? AND is_active = 1 FOR UPDATE",
      [id]
    );
    if (!rows.length) return false;
    const previousStock = Number(rows[0].stock);
    await connection.execute(
      "UPDATE products SET name = ?, category = ?, price = ?, discount_percent = ?, stock = ?, item_type = ? WHERE id = ?",
      [name, category, price, discountPercent, stock, itemType, id]
    );
    const quantityChange = stock - previousStock;
    if (quantityChange !== 0) {
      await connection.execute(
        `INSERT INTO stock_movements
         (product_id, user_id, movement_type, quantity_change, stock_after, notes)
         VALUES (?, ?, 'adjustment', ?, ?, 'Ajuste manual de estoque')`,
        [id, userId, quantityChange, stock]
      );
    }
    return true;
  });
}

async function deactivate(id) {
  const [result] = await pool.execute(
    "UPDATE products SET is_active = 0 WHERE id = ? AND is_active = 1",
    [id]
  );
  return result.affectedRows;
}

module.exports = { list, create, update, deactivate };
