"use strict";

const { pool, transaction } = require("./database.model");
const { fail } = require("./errors");

async function list() {
  const [rows] = await pool.query(
    `SELECT s.id, s.client_id, c.name AS client_name, s.total,
            s.commission_percent, s.commission_amount, s.sold_at AS date,
            u.name AS registered_by_name,
            GROUP_CONCAT(CONCAT(si.product_name, ' (', si.quantity, ')')
              ORDER BY si.id SEPARATOR ', ') AS product_name,
            SUM(si.quantity) AS quantity
     FROM sales s
     INNER JOIN clients c ON c.id = s.client_id
     LEFT JOIN users u ON u.id = s.registered_by
     INNER JOIN sale_items si ON si.sale_id = s.id
     WHERE s.status = 'completed'
     GROUP BY s.id, s.client_id, c.name, s.total, s.commission_percent,
              s.commission_amount, s.sold_at, u.name
     ORDER BY s.sold_at DESC LIMIT 500`
  );
  return rows;
}

async function register({ clientId, items, userId }) {
  return transaction(async (connection) => {
    const [clients] = await connection.execute("SELECT id FROM clients WHERE id = ?", [clientId]);
    if (!clients.length) fail(422, "O cliente selecionado não existe.");
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      fail(422, "Adicione pelo menos um produto ou serviço à venda.");
    }

    const [users] = await connection.execute(
      "SELECT commission_percent FROM users WHERE id = ? AND is_active = 1",
      [userId]
    );
    if (!users.length) fail(422, "O usuário da venda não está ativo.");
    const commissionPercent = Number(users[0].commission_percent || 0);
    let totalCents = 0;
    const normalizedItems = [];

    for (const item of items) {
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity);
      const discountPercent = Number(item.discount_percent ?? 0);
      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
        fail(422, "O desconto deve estar entre 0% e 100%.");
      }
      if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(quantity) || quantity < 1) {
        fail(422, "Informe itens e quantidades válidos.");
      }
      const [products] = await connection.execute(
        "SELECT id, name, price, discount_percent, stock, item_type FROM products WHERE id = ? AND is_active = 1 FOR UPDATE",
        [productId]
      );
      const product = products[0];
      if (!product) fail(422, "Um item selecionado não existe ou está inativo.");
      const productDiscount = Number(product.discount_percent || 0);
      const maximumAllowed = Math.max(20, productDiscount);
      if (discountPercent > maximumAllowed) {
        fail(422, `Desconto máximo permitido para este item: ${maximumAllowed.toFixed(2)}%.`);
      }
      if (product.item_type === "P" && Number(product.stock) < quantity) {
        fail(409, `Estoque insuficiente para ${product.name}.`);
      }
      const unitCents = Math.round(Number(product.price) * 100);
      const grossCents = unitCents * quantity;
      const discountAmountCents = Math.round(grossCents * discountPercent / 100);
      const subtotalCents = grossCents - discountAmountCents;
      totalCents += subtotalCents;
      normalizedItems.push({ product, quantity, discountPercent, discountAmountCents, subtotalCents });
    }

    const total = (totalCents / 100).toFixed(2);
    const commissionAmount = ((totalCents * commissionPercent) / 10000).toFixed(2);
    const [sale] = await connection.execute(
      `INSERT INTO sales (client_id, registered_by, total, commission_percent, commission_amount)
       VALUES (?, ?, ?, ?, ?)`,
      [clientId, userId, total, commissionPercent.toFixed(2), commissionAmount]
    );

    for (const item of normalizedItems) {
      const { product, quantity, discountPercent, discountAmountCents, subtotalCents } = item;
      const discountAmount = (discountAmountCents / 100).toFixed(2);
      const subtotal = (subtotalCents / 100).toFixed(2);
      await connection.execute(
        `INSERT INTO sale_items
         (sale_id, product_id, product_name, quantity, unit_price, discount_percent, discount_amount, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sale.insertId, product.id, product.name, quantity, product.price, discountPercent.toFixed(2), discountAmount, subtotal]
      );
      if (product.item_type === "P") {
        const stockAfter = Number(product.stock) - quantity;
        await connection.execute("UPDATE products SET stock = ? WHERE id = ?", [stockAfter, product.id]);
        await connection.execute(
          `INSERT INTO stock_movements
           (product_id, user_id, sale_id, movement_type, quantity_change, stock_after, notes)
           VALUES (?, ?, ?, 'sale', ?, ?, 'Saída por venda')`,
          [product.id, userId, sale.insertId, -quantity, stockAfter]
        );
      }
    }
    return { id: sale.insertId, total: Number(total), commissionPercent, commissionAmount: Number(commissionAmount) };
  });
}

module.exports = { list, register };
