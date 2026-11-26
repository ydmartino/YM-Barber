"use strict";

const { pool, transaction } = require("./database.model");
const { fail } = require("./errors");

async function list() {
  const [rows] = await pool.query(
    `SELECT id, name, category, price, discount_percent, stock, low_stock_threshold, item_type, duration_minutes
     FROM products WHERE is_active = 1 ORDER BY name LIMIT 500`
  );
  return rows;
}

async function create({ name, category, price, discountPercent, stock, lowStockThreshold, itemType, durationMinutes, userId }) {
  return transaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO products
       (name, category, price, discount_percent, stock, low_stock_threshold, item_type, duration_minutes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, category, price, discountPercent, stock, lowStockThreshold, itemType, durationMinutes, userId]
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

async function update(id, { name, category, price, discountPercent, stock, lowStockThreshold, itemType, durationMinutes, userId }) {
  return transaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT stock, item_type FROM products WHERE id = ? AND is_active = 1 FOR UPDATE",
      [id]
    );
    if (!rows.length) return false;
    const previousStock = Number(rows[0].stock);
    await connection.execute(
      `UPDATE products SET name = ?, category = ?, price = ?, discount_percent = ?,
       stock = ?, low_stock_threshold = ?, item_type = ?, duration_minutes = ? WHERE id = ?`,
      [name, category, price, discountPercent, stock, lowStockThreshold, itemType, durationMinutes, id]
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

async function receiveStock(id, quantity, userId) {
  return transaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT stock, item_type FROM products WHERE id = ? AND is_active = 1 FOR UPDATE",
      [id]
    );
    if (!rows.length) return false;
    if (rows[0].item_type !== "P") {
      fail(422, "Serviços não possuem controle de estoque.");
    }
    const stockAfter = Number(rows[0].stock) + quantity;
    if (!Number.isSafeInteger(stockAfter) || stockAfter > 4294967295) {
      fail(422, "A quantidade resultaria em um estoque acima do limite permitido.");
    }
    await connection.execute("UPDATE products SET stock = ? WHERE id = ?", [stockAfter, id]);
    await connection.execute(
      `INSERT INTO stock_movements
       (product_id, user_id, movement_type, quantity_change, stock_after, notes)
       VALUES (?, ?, 'entry', ?, ?, 'Entrada de reposição')`,
      [id, userId, quantity, stockAfter]
    );
    return { stock: stockAfter };
  });
}

module.exports = { list, create, update, deactivate, receiveStock };
