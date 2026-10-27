"use strict";

const { pool } = require("./database.model");

async function getSummary({ includeSales }) {
  const [[today]] = await pool.query(
    "SELECT COUNT(*) AS sale_count, COALESCE(SUM(total), 0) AS total FROM sales WHERE status = 'completed' AND sold_at >= UTC_DATE()"
  );
  const [[clientCount]] = await pool.query("SELECT COUNT(*) AS count FROM clients");
  const [[products]] = await pool.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(stock), 0) AS stock,
            COALESCE(SUM(stock <= low_stock_threshold), 0) AS low_stock
     FROM products WHERE is_active = 1 AND item_type = 'P'`
  );
  const [recent] = includeSales
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

module.exports = { getSummary };
