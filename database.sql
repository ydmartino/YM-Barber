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
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_products_name (name),
  KEY idx_products_active_stock (is_active, stock),
  CONSTRAINT chk_products_price_positive CHECK (price > 0),
  CONSTRAINT chk_products_discount CHECK (discount_percent >= 0 AND discount_percent <= 100),
  CONSTRAINT chk_products_item_type CHECK (item_type IN ('P', 'S')),
  CONSTRAINT fk_products_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id BIGINT UNSIGNED NOT NULL,
  registered_by BIGINT UNSIGNED NULL,
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
  CONSTRAINT chk_sale_items_price CHECK (unit_price > 0),
  CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id)
    REFERENCES sales (id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_items_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  sale_id BIGINT UNSIGNED NULL,
  movement_type ENUM('initial', 'sale', 'adjustment') NOT NULL,
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

INSERT INTO permissions (code, name, description) VALUES
  ('dashboard.view', 'Visão geral', 'Visualizar indicadores e vendas recentes.'),
  ('clients.view', 'Consultar clientes', 'Visualizar e pesquisar clientes.'),
  ('clients.manage', 'Gerenciar clientes', 'Cadastrar, editar e excluir clientes.'),
  ('products.view', 'Consultar produtos', 'Visualizar produtos e estoque.'),
  ('products.manage', 'Gerenciar produtos', 'Cadastrar, editar e excluir produtos.'),
  ('sales.view', 'Consultar vendas', 'Visualizar o histórico de vendas.'),
  ('sales.create', 'Registrar vendas', 'Registrar vendas e baixar o estoque.')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description);
