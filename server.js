"use strict";

const http = require("node:http");
const { loadEnvironment } = require("./src/config/environment");

loadEnvironment();

const { pool } = require("./src/models/database.model");
const { ApiError } = require("./src/models/errors");
const apiView = require("./src/views/api.view");
const applicationView = require("./src/views/application.view");

async function ensureColumn(table, column, definition) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function setCheckConstraint(table, constraint, definition) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, constraint]
  );
  if (rows.length) await pool.query(`ALTER TABLE \`${table}\` DROP CHECK \`${constraint}\``);
  await pool.query(
    `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\` CHECK (${definition})`
  );
}

const server = http.createServer(async (request, response) => {
  try {
    if (process.env.NODE_ENV === "production") {
      const forwardedProtocol = String(request.headers["x-forwarded-proto"] || "")
        .split(",")[0].trim().toLowerCase();
      if (forwardedProtocol !== "https") {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("HTTPS é obrigatório.");
        return;
      }
      response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api") {
      await apiView.view(request, response, url);
      return;
    }
    await applicationView.view(request, response, url);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (error instanceof ApiError) {
      response.writeHead(error.status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message }));
      return;
    }
    console.error("Erro ao servir a aplicação:", error);
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Ocorreu um erro inesperado ao processar a solicitação." }));
  }
});

async function start() {
  const port = Number(process.env.PORT || 8000);
  await pool.query("SELECT 1");
  await ensureColumn("users", "role", "ENUM('barber', 'reception') NOT NULL DEFAULT 'barber'");
  await ensureColumn("clients", "consent_at", "TIMESTAMP NULL");
  await ensureColumn("products", "duration_minutes", "SMALLINT UNSIGNED NULL");
  await ensureColumn("sales", "authorized_by", "BIGINT UNSIGNED NULL");
  const [authorizedByForeignKey] = await pool.execute(
    `SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales'
       AND COLUMN_NAME = 'authorized_by' AND REFERENCED_TABLE_NAME = 'users'`
  );
  if (!authorizedByForeignKey.length) {
    await pool.query(`ALTER TABLE sales ADD CONSTRAINT fk_sales_authorized_by
      FOREIGN KEY (authorized_by) REFERENCES users (id) ON DELETE SET NULL`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS working_hours (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    barber_id BIGINT UNSIGNED NOT NULL,
    weekday TINYINT UNSIGNED NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_working_hours_barber_weekday (barber_id, weekday),
    CONSTRAINT chk_working_hours_weekday CHECK (weekday BETWEEN 1 AND 7),
    CONSTRAINT chk_working_hours_time CHECK (start_time < end_time),
    CONSTRAINT fk_working_hours_barber FOREIGN KEY (barber_id)
      REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS appointments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id BIGINT UNSIGNED NOT NULL,
    barber_id BIGINT UNSIGNED NOT NULL,
    service_id BIGINT UNSIGNED NOT NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    status ENUM('scheduled', 'completed', 'cancelled', 'no_show') NOT NULL DEFAULT 'scheduled',
    cancellation_token_hash CHAR(64) NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_appointments_barber_start (barber_id, start_at, end_at, status),
    KEY idx_appointments_client_start (client_id, start_at, status),
    CONSTRAINT chk_appointments_time CHECK (end_at > start_at),
    CONSTRAINT fk_appointments_client FOREIGN KEY (client_id)
      REFERENCES clients (id) ON DELETE RESTRICT,
    CONSTRAINT fk_appointments_barber FOREIGN KEY (barber_id)
      REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_appointments_service FOREIGN KEY (service_id)
      REFERENCES products (id) ON DELETE RESTRICT,
    CONSTRAINT fk_appointments_created_by FOREIGN KEY (created_by)
      REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS login_attempts (
    email VARCHAR(190) NOT NULL,
    failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (email)
  ) ENGINE=InnoDB`);
  await pool.query(`INSERT INTO permissions (code, name, description) VALUES
    ('appointments.view', 'Consultar agenda', 'Visualizar e consultar agendamentos.'),
    ('appointments.manage', 'Gerenciar agenda', 'Criar e atualizar agendamentos.'),
    ('stock.manage', 'Gerenciar estoque', 'Registrar entradas e ajustes de estoque.'),
    ('commissions.view', 'Consultar comissões', 'Visualizar comissões por período.')
    ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`);
  await pool.query(
    "ALTER TABLE stock_movements MODIFY movement_type ENUM('initial', 'sale', 'adjustment', 'entry') NOT NULL"
  );
  await pool.query(`INSERT IGNORE INTO working_hours (barber_id, weekday, start_time, end_time)
    SELECT u.id, days.weekday, '09:00', '20:00'
    FROM users u
    CROSS JOIN (SELECT 2 AS weekday UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) days
    WHERE u.role = 'barber' AND u.is_active = 1`);
  await pool.query("DROP TRIGGER IF EXISTS trg_appointments_no_overlap_insert");
  await pool.query(`CREATE TRIGGER trg_appointments_no_overlap_insert
    BEFORE INSERT ON appointments FOR EACH ROW
    BEGIN
      DECLARE locked_barber BIGINT UNSIGNED;
      DECLARE conflicts INT DEFAULT 0;
      IF NEW.status = 'scheduled' THEN
        SELECT id INTO locked_barber FROM users WHERE id = NEW.barber_id FOR UPDATE;
        SELECT COUNT(*) INTO conflicts FROM appointments
          WHERE barber_id = NEW.barber_id AND status = 'scheduled'
            AND start_at < NEW.end_at AND end_at > NEW.start_at;
        IF conflicts > 0 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Este horário acabou de ser reservado.';
        END IF;
      END IF;
    END`);
  await pool.query("DROP TRIGGER IF EXISTS trg_appointments_no_overlap_update");
  await pool.query(`CREATE TRIGGER trg_appointments_no_overlap_update
    BEFORE UPDATE ON appointments FOR EACH ROW
    BEGIN
      DECLARE locked_barber BIGINT UNSIGNED;
      DECLARE conflicts INT DEFAULT 0;
      IF NEW.status = 'scheduled' THEN
        SELECT id INTO locked_barber FROM users WHERE id = NEW.barber_id FOR UPDATE;
        SELECT COUNT(*) INTO conflicts FROM appointments
          WHERE barber_id = NEW.barber_id AND id <> NEW.id AND status = 'scheduled'
            AND start_at < NEW.end_at AND end_at > NEW.start_at;
        IF conflicts > 0 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Este horário já está ocupado.';
        END IF;
      END IF;
    END`);
  const [columns] = await pool.query(
    `SELECT DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'item_type'`
  );
  if (columns.length === 0) {
    await pool.query(
      "ALTER TABLE products ADD COLUMN item_type CHAR(1) NOT NULL DEFAULT 'P' AFTER low_stock_threshold"
    );
  } else {
    await pool.query("ALTER TABLE products MODIFY COLUMN item_type VARCHAR(10) NOT NULL DEFAULT 'P'");
    await pool.query("UPDATE products SET item_type = 'S' WHERE item_type = 'service'");
    await pool.query("UPDATE products SET item_type = 'P' WHERE item_type IN ('product', '')");
    await pool.query("ALTER TABLE products MODIFY COLUMN item_type CHAR(1) NOT NULL DEFAULT 'P'");
  }
  await pool.query(
    "UPDATE products SET duration_minutes = 30 WHERE item_type = 'S' AND duration_minutes IS NULL"
  );
  await pool.query("UPDATE products SET stock = 0 WHERE item_type = 'S' AND stock <> 0");
  await setCheckConstraint(
    "products",
    "chk_products_duration",
    "(item_type = 'S' AND duration_minutes BETWEEN 5 AND 480) OR (item_type = 'P' AND duration_minutes IS NULL)"
  );
  await setCheckConstraint("products", "chk_products_service_stock", "item_type = 'P' OR stock = 0");
  await setCheckConstraint("products", "chk_products_price_positive", "price >= 0");
  await setCheckConstraint("sale_items", "chk_sale_items_price", "unit_price >= 0");
  const [userCommissionColumns] = await pool.query(
    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'commission_percent'"
  );
  if (Number(userCommissionColumns[0].count) === 0) {
    await pool.query("ALTER TABLE users ADD COLUMN commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER is_active");
  }
  const [saleCommissionColumns] = await pool.query(
    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales' AND COLUMN_NAME = 'commission_amount'"
  );
  if (Number(saleCommissionColumns[0].count) === 0) {
    await pool.query("ALTER TABLE sales ADD COLUMN commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER total");
    await pool.query("ALTER TABLE sales ADD COLUMN commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER commission_percent");
  }
  const [productDiscountColumns] = await pool.query(
    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'discount_percent'"
  );
  if (Number(productDiscountColumns[0].count) === 0) {
    await pool.query("ALTER TABLE products ADD COLUMN discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER price");
  }
  const [saleItemPercentColumns] = await pool.query(
    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_items' AND COLUMN_NAME = 'discount_percent'"
  );
  if (Number(saleItemPercentColumns[0].count) === 0) {
    await pool.query("ALTER TABLE sale_items ADD COLUMN discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER unit_price");
  }
  const [saleItemAmountColumns] = await pool.query(
    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_items' AND COLUMN_NAME = 'discount_amount'"
  );
  if (Number(saleItemAmountColumns[0].count) === 0) {
    await pool.query("ALTER TABLE sale_items ADD COLUMN discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER discount_percent");
  }
  await pool.query("DROP TRIGGER IF EXISTS trg_sale_items_limit_discount_insert");
  await pool.query(`CREATE TRIGGER trg_sale_items_limit_discount_insert BEFORE INSERT ON sale_items FOR EACH ROW
    BEGIN
      DECLARE configured_discount DECIMAL(5,2);
      DECLARE maximum_allowed DECIMAL(5,2);
      IF NEW.product_id IS NOT NULL THEN
        SELECT discount_percent INTO configured_discount FROM products WHERE id = NEW.product_id;
        SET maximum_allowed = COALESCE(configured_discount, 0);
        IF NEW.discount_percent < 0 OR NEW.discount_percent > maximum_allowed THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Desconto inválido ou acima do limite permitido para este produto ou serviço.';
        END IF;
      END IF;
    END`);
  await pool.query("DROP TRIGGER IF EXISTS trg_sale_items_limit_discount_update");
  await pool.query(`CREATE TRIGGER trg_sale_items_limit_discount_update BEFORE UPDATE ON sale_items FOR EACH ROW
    BEGIN
      DECLARE configured_discount DECIMAL(5,2);
      DECLARE maximum_allowed DECIMAL(5,2);
      IF NEW.product_id IS NOT NULL THEN
        SELECT discount_percent INTO configured_discount FROM products WHERE id = NEW.product_id;
        SET maximum_allowed = COALESCE(configured_discount, 0);
        IF NEW.discount_percent < 0 OR NEW.discount_percent > maximum_allowed THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Desconto inválido ou acima do limite permitido para este produto ou serviço.';
        END IF;
      END IF;
    END`);
  await pool.query(`CREATE OR REPLACE VIEW v_sales_history AS
    SELECT s.id, s.client_id, c.name AS client_name, s.registered_by,
           s.total, s.commission_percent, s.commission_amount, s.status,
           s.sold_at AS date, u.name AS registered_by_name,
           u.is_admin AS registered_user_is_admin,
           GROUP_CONCAT(CONCAT(si.product_name, ' (', si.quantity, ')') ORDER BY si.id SEPARATOR ', ') AS product_name,
           SUM(si.quantity) AS quantity
    FROM sales s
    INNER JOIN clients c ON c.id = s.client_id
    LEFT JOIN users u ON u.id = s.registered_by
    INNER JOIN sale_items si ON si.sale_id = s.id
    GROUP BY s.id, s.client_id, c.name, s.registered_by, s.total,
             s.commission_percent, s.commission_amount, s.status, s.sold_at,
             u.name, u.is_admin`);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  console.log(`Navalha disponível em http://localhost:${port}`);
  console.log("Conexão com MySQL estabelecida.");
  if (!process.env.SESSION_SECRET) {
    console.warn("SESSION_SECRET não definido: sessões existentes serão encerradas ao reiniciar o servidor.");
  }
  return server;
}

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Não foi possível iniciar o servidor:", error.code || error.message);
    process.exitCode = 1;
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = { server, start };
