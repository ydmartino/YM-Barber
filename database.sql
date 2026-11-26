CREATE DATABASE IF NOT EXISTS navalha
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE navalha;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  role ENUM('barber', 'reception') NOT NULL DEFAULT 'barber',
  commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_active (is_active),
  CONSTRAINT chk_users_admin CHECK (is_admin IN (0, 1)),
  CONSTRAINT chk_users_active CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_users_commission CHECK (commission_percent >= 0 AND commission_percent <= 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id BIGINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  granted_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission_id),
  CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_permissions_permission FOREIGN KEY (permission_id)
    REFERENCES permissions (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_permissions_granted_by FOREIGN KEY (granted_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(190) NULL,
  notes TEXT NULL,
  consent_at TIMESTAMP NULL COMMENT 'Data e hora UTC em que o consentimento LGPD foi registrado',
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_clients_name (name),
  KEY idx_clients_phone (phone),
  KEY idx_clients_email (email),
  CONSTRAINT fk_clients_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  low_stock_threshold INT UNSIGNED NOT NULL DEFAULT 5,
  item_type CHAR(1) NOT NULL DEFAULT 'P',
  duration_minutes SMALLINT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_products_name (name),
  KEY idx_products_active_stock (is_active, stock),
  CONSTRAINT chk_products_price_positive CHECK (price >= 0),
  CONSTRAINT chk_products_discount CHECK (discount_percent >= 0 AND discount_percent <= 100),
  CONSTRAINT chk_products_item_type CHECK (item_type IN ('P', 'S')),
  CONSTRAINT chk_products_duration CHECK (
    (item_type = 'S' AND duration_minutes BETWEEN 5 AND 480) OR
    (item_type = 'P' AND duration_minutes IS NULL)
  ),
  CONSTRAINT chk_products_service_stock CHECK (item_type = 'P' OR stock = 0),
  CONSTRAINT fk_products_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id BIGINT UNSIGNED NOT NULL,
  registered_by BIGINT UNSIGNED NULL,
  authorized_by BIGINT UNSIGNED NULL,
  total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  status ENUM('completed', 'cancelled') NOT NULL DEFAULT 'completed',
  notes VARCHAR(500) NULL,
  sold_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sales_sold_at (sold_at),
  KEY idx_sales_client (client_id),
  KEY idx_sales_registered_by (registered_by),
  CONSTRAINT chk_sales_total_nonnegative CHECK (total >= 0),
  CONSTRAINT fk_sales_client FOREIGN KEY (client_id)
    REFERENCES clients (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_registered_by FOREIGN KEY (registered_by)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_sales_authorized_by FOREIGN KEY (authorized_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  product_name VARCHAR(120) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  subtotal DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sale_items_sale (sale_id),
  KEY idx_sale_items_product (product_id),
  CONSTRAINT chk_sale_items_quantity CHECK (quantity > 0),
  CONSTRAINT chk_sale_items_price CHECK (unit_price >= 0),
  CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id)
    REFERENCES sales (id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_items_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB;

DROP TRIGGER IF EXISTS trg_sale_items_limit_discount_insert;
DELIMITER //
CREATE TRIGGER trg_sale_items_limit_discount_insert
BEFORE INSERT ON sale_items
FOR EACH ROW
BEGIN
  DECLARE configured_discount DECIMAL(5,2);
  DECLARE maximum_allowed DECIMAL(5,2);
  IF NEW.product_id IS NOT NULL THEN
    SELECT discount_percent INTO configured_discount
    FROM products WHERE id = NEW.product_id;
    SET maximum_allowed = COALESCE(configured_discount, 0);
    IF NEW.discount_percent < 0 OR NEW.discount_percent > maximum_allowed THEN
      SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Desconto inválido ou acima do limite permitido para este produto ou serviço.';
    END IF;
  END IF;
END//
DELIMITER ;

DROP TRIGGER IF EXISTS trg_sale_items_limit_discount_update;
DELIMITER //
CREATE TRIGGER trg_sale_items_limit_discount_update
BEFORE UPDATE ON sale_items
FOR EACH ROW
BEGIN
  DECLARE configured_discount DECIMAL(5,2);
  DECLARE maximum_allowed DECIMAL(5,2);
  IF NEW.product_id IS NOT NULL THEN
    SELECT discount_percent INTO configured_discount
    FROM products WHERE id = NEW.product_id;
    SET maximum_allowed = COALESCE(configured_discount, 0);
    IF NEW.discount_percent < 0 OR NEW.discount_percent > maximum_allowed THEN
      SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Desconto inválido ou acima do limite permitido para este produto ou serviço.';
    END IF;
  END IF;
END//
DELIMITER ;

CREATE OR REPLACE VIEW v_sales_history AS
SELECT
  s.id,
  s.client_id,
  c.name AS client_name,
  s.registered_by,
  s.total,
  s.commission_percent,
  s.commission_amount,
  s.status,
  s.sold_at AS date,
  u.name AS registered_by_name,
  u.is_admin AS registered_user_is_admin,
  GROUP_CONCAT(CONCAT(si.product_name, ' (', si.quantity, ')') ORDER BY si.id SEPARATOR ', ') AS product_name,
  SUM(si.quantity) AS quantity
FROM sales s
INNER JOIN clients c ON c.id = s.client_id
LEFT JOIN users u ON u.id = s.registered_by
INNER JOIN sale_items si ON si.sale_id = s.id
GROUP BY
  s.id, s.client_id, c.name, s.registered_by, s.total,
  s.commission_percent, s.commission_amount, s.status, s.sold_at,
  u.name, u.is_admin;

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  sale_id BIGINT UNSIGNED NULL,
  movement_type ENUM('initial', 'sale', 'adjustment', 'entry') NOT NULL,
  quantity_change BIGINT NOT NULL,
  stock_after INT UNSIGNED NOT NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_stock_movements_product_date (product_id, created_at),
  KEY idx_stock_movements_sale (sale_id),
  CONSTRAINT fk_stock_movements_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_movements_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_stock_movements_sale FOREIGN KEY (sale_id)
    REFERENCES sales (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS working_hours (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointments (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS login_attempts (
  email VARCHAR(190) NOT NULL,
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (email)
) ENGINE=InnoDB;

DROP TRIGGER IF EXISTS trg_appointments_no_overlap_insert;
DELIMITER //
CREATE TRIGGER trg_appointments_no_overlap_insert
BEFORE INSERT ON appointments
FOR EACH ROW
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
END//
DELIMITER ;

DROP TRIGGER IF EXISTS trg_appointments_no_overlap_update;
DELIMITER //
CREATE TRIGGER trg_appointments_no_overlap_update
BEFORE UPDATE ON appointments
FOR EACH ROW
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
END//
DELIMITER ;

INSERT INTO permissions (code, name, description) VALUES
  ('dashboard.view', 'Visão geral', 'Visualizar indicadores e vendas recentes.'),
  ('clients.view', 'Consultar clientes', 'Visualizar e pesquisar clientes.'),
  ('clients.manage', 'Gerenciar clientes', 'Cadastrar, editar e excluir clientes.'),
  ('products.view', 'Consultar produtos', 'Visualizar produtos e estoque.'),
  ('products.manage', 'Gerenciar produtos', 'Cadastrar, editar e excluir produtos.'),
  ('sales.view', 'Consultar vendas', 'Visualizar o histórico de vendas.'),
  ('sales.create', 'Registrar vendas', 'Registrar vendas e baixar o estoque.'),
  ('appointments.view', 'Consultar agenda', 'Visualizar e consultar agendamentos.'),
  ('appointments.manage', 'Gerenciar agenda', 'Criar e atualizar agendamentos.'),
  ('stock.manage', 'Gerenciar estoque', 'Registrar entradas e ajustes de estoque.'),
  ('commissions.view', 'Consultar comissões', 'Visualizar comissões por período.')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description);
