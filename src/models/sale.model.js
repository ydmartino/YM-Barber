"use strict";

const { pool, transaction } = require("./database.model");
const { fail } = require("./errors");

async function list() {
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

async function register({ clientId, productId, quantity, userId }) {
  return transaction(async (connection) => {
    const [clients] = await connection.execute("SELECT id FROM clients WHERE id = ?", [clientId]);
    if (!clients.length) fail(422, "O cliente selecionado não existe.");

    const [products] = await connection.execute(
      "SELECT id, name, price, stock, item_type FROM products WHERE id = ? AND is_active = 1 FOR UPDATE",
      [productId]
    );
    const product = products[0];
    if (!product) fail(422, "O item selecionado não existe ou está inativo.");
    if (product.item_type === "P" && Number(product.stock) < quantity) {
      fail(409, "Estoque insuficiente para essa quantidade.");
    }

    const unitCents = Math.round(Number(product.price) * 100);
    const total = ((unitCents * quantity) / 100).toFixed(2);
    const [sale] = await connection.execute(
      "INSERT INTO sales (client_id, registered_by, total) VALUES (?, ?, ?)",
      [clientId, userId, total]
    );
    await connection.execute(
      `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sale.insertId, productId, product.name, quantity, product.price, total]
    );
    const stockAfter = product.item_type === "P" ? Number(product.stock) - quantity : 0;
    if (product.item_type === "P") {
      await connection.execute("UPDATE products SET stock = ? WHERE id = ?", [stockAfter, productId]);
      await connection.execute(
        `INSERT INTO stock_movements
         (product_id, user_id, sale_id, movement_type, quantity_change, stock_after, notes)
         VALUES (?, ?, ?, 'sale', ?, ?, 'Saída por venda')`,
        [productId, userId, sale.insertId, -quantity, stockAfter]
      );
    }
    return { id: sale.insertId, total: Number(total), stock: stockAfter };
  });
}

module.exports = { list, register };
