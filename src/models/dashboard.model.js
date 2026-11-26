"use strict";

const { pool } = require("./database.model");
const analyticsModel = require("./analytics.model");

async function getSummary({ includeSales, user }) {
  const todaySql = user.is_admin
    ? "SELECT COUNT(*) AS sale_count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(commission_amount), 0) AS commission FROM sales WHERE status = 'completed' AND sold_at >= UTC_DATE()"
    : "SELECT COUNT(*) AS sale_count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(commission_amount), 0) AS commission FROM sales WHERE status = 'completed' AND registered_by = ? AND sold_at >= UTC_DATE()";
  const [[today]] = user.is_admin
    ? await pool.query(todaySql)
    : await pool.execute(todaySql, [user.id]);
  const [[clientCount]] = await pool.query("SELECT COUNT(*) AS count FROM clients");
  const [[products]] = await pool.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(stock), 0) AS stock,
            COALESCE(SUM(stock <= low_stock_threshold), 0) AS low_stock
     FROM products WHERE is_active = 1 AND item_type = 'P'`
  );
  const clientSegments = await analyticsModel.getClientSegments();
  let recent = [];
  if (includeSales) {
    const recentSql = user.is_admin
      ? `SELECT id, client_name, date AS sold_at, total, product_name AS products
         FROM v_sales_history WHERE status = 'completed'
         ORDER BY date DESC LIMIT 5`
      : `SELECT id, client_name, date AS sold_at, total, product_name AS products
         FROM v_sales_history WHERE status = 'completed' AND registered_by = ?
         ORDER BY date DESC LIMIT 5`;
    const [rows] = user.is_admin ? await pool.query(recentSql) : await pool.execute(recentSql, [user.id]);
    recent = rows;
  }
  return {
    today: {
      count: Number(today.sale_count),
      total: Number(today.total),
      commission: Number(today.commission),
    },
    clients: Number(clientCount.count),
    products: {
      count: Number(products.count),
      stock: Number(products.stock),
      low_stock: Number(products.low_stock),
    },
    client_segments: clientSegments,
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
