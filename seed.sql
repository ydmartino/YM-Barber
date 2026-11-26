-- Script de população de dados de demonstração para o banco navalha
-- Execute após database.sql:
-- Get-Content .\seed.sql | mysql -u admin -p
--
-- ATENÇÃO: este arquivo contém contas de demonstração. Não use em produção.
-- Senha da conta administrador: Admin@123456
-- Senha da conta barbeiro: Barbeiro@123

USE navalha;

START TRANSACTION;

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

INSERT INTO users (name, email, password_hash, is_admin, is_active, commission_percent) VALUES
  ('Administrador Demo', 'admin@barbearia.com', 'scrypt$PfZGNEgfpsfQk3nHjs6OOw$OSsiftsKNo22gKGphPMM6cKpYdZ0H9j0bkphSylcxEJCgsCIGpEiQGOrpyfDT2t_6JN-8sxq6fA4Y8fztk2gyg', 1, 1, 0.00),
  ('Lucas Barbeiro', 'lucas@barbearia.com', 'scrypt$4GsI7fRPFm1KeoWHdvufHw$EjKCSQqWtFxxCjDfpVT6F3q4UTy-Io8QWjV_Bh45oTb2r-HtVO-PnVSjWML_FJr0YT_sLGqjWZMvnvS2DQgBIg', 0, 1, 30.00)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  is_admin = VALUES(is_admin),
  is_active = VALUES(is_active),
  commission_percent = VALUES(commission_percent);

-- Permite que o barbeiro demo acesse clientes, produtos e vendas.
INSERT IGNORE INTO user_permissions (user_id, permission_id, granted_by)
SELECT u.id, p.id, admin.id
FROM users u
CROSS JOIN permissions p
JOIN users admin ON admin.email = 'admin@barbearia.com'
WHERE u.email = 'lucas@barbearia.com'
  AND p.code IN ('dashboard.view', 'clients.view', 'clients.manage', 'products.view', 'sales.view', 'sales.create', 'appointments.view', 'appointments.manage', 'commissions.view');

INSERT INTO clients (name, phone, email, notes, created_by) VALUES
  ('Carlos Silva', '(11) 98888-1001', 'carlos.silva@example.com', 'Prefere corte fade com tesoura.', (SELECT id FROM users WHERE email = 'lucas@barbearia.com')),
  ('Ricardo Souza', '(11) 98888-1002', 'ricardo.souza@example.com', 'Atendimento preferencial às sextas.', (SELECT id FROM users WHERE email = 'lucas@barbearia.com')),
  ('Marcos Oliveira', '(11) 98888-1003', 'marcos.oliveira@example.com', NULL, (SELECT id FROM users WHERE email = 'lucas@barbearia.com')),
  ('Paulo Santos', '(11) 98888-1004', NULL, 'Usa barba por máquina número 3.', (SELECT id FROM users WHERE email = 'lucas@barbearia.com'));

SET @lucas_id = (SELECT id FROM users WHERE email = 'lucas@barbearia.com');

INSERT INTO products (name, category, price, discount_percent, stock, low_stock_threshold, item_type, duration_minutes, is_active, created_by) VALUES
  ('Corte Masculino', 'Serviços', 45.00, 0.00, 0, 0, 'S', 30, 1, @lucas_id),
  ('Barba Completa', 'Serviços', 35.00, 0.00, 0, 0, 'S', 30, 1, @lucas_id),
  ('Corte + Barba', 'Combos', 70.00, 10.00, 0, 0, 'S', 60, 1, @lucas_id),
  ('Pomada Modeladora', 'Produtos', 32.00, 5.00, 30, 5, 'P', NULL, 1, @lucas_id),
  ('Óleo para Barba', 'Produtos', 28.00, 5.00, 20, 4, 'P', NULL, 1, @lucas_id),
  ('Shampoo Especial', 'Produtos', 25.00, 0.00, 18, 3, 'P', NULL, 1, @lucas_id);

-- Movimentações iniciais de estoque dos produtos cadastrados acima.
INSERT INTO stock_movements (product_id, user_id, movement_type, quantity_change, stock_after, notes)
SELECT p.id, @lucas_id, 'initial', p.stock, p.stock, 'Estoque inicial de demonstração'
FROM products p
WHERE p.category = 'Produtos'
  AND p.created_by = @lucas_id;

-- Venda de demonstração 1: Corte + Barba.
INSERT INTO sales (client_id, registered_by, total, commission_percent, commission_amount, status, notes)
SELECT c.id, @lucas_id, 63.00, 30.00, 18.90, 'completed', 'Seed demo: venda de demonstração 1'
FROM clients c WHERE c.email = 'carlos.silva@example.com';

SET @sale1 = LAST_INSERT_ID();
INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, discount_percent, discount_amount, subtotal)
SELECT @sale1, p.id, p.name, 1, p.price, 10.00, 7.00, 63.00
FROM products p WHERE p.name = 'Corte + Barba';

-- Venda de demonstração 2: Corte, óleo para barba e pomada.
INSERT INTO sales (client_id, registered_by, total, commission_percent, commission_amount, status, notes)
SELECT c.id, @lucas_id, 102.00, 30.00, 30.60, 'completed', 'Seed demo: venda de demonstração 2'
FROM clients c WHERE c.email = 'ricardo.souza@example.com';

SET @sale2 = LAST_INSERT_ID();
INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, discount_percent, discount_amount, subtotal)
VALUES
  (@sale2, (SELECT id FROM products WHERE name = 'Corte Masculino'), 'Corte Masculino', 1, 45.00, 0.00, 0.00, 45.00),
  (@sale2, (SELECT id FROM products WHERE name = 'Óleo para Barba'), 'Óleo para Barba', 1, 28.00, 0.00, 0.00, 28.00),
  (@sale2, (SELECT id FROM products WHERE name = 'Pomada Modeladora'), 'Pomada Modeladora', 1, 32.00, 0.00, 0.00, 32.00);

UPDATE products SET stock = stock - 1 WHERE name = 'Óleo para Barba';
UPDATE products SET stock = stock - 1 WHERE name = 'Pomada Modeladora';

INSERT INTO stock_movements (product_id, user_id, sale_id, movement_type, quantity_change, stock_after, notes)
SELECT p.id, @lucas_id, @sale2, 'sale', -1, p.stock, 'Saída por venda de demonstração'
FROM products p WHERE p.name IN ('Óleo para Barba', 'Pomada Modeladora');

-- Venda de demonstração 3: Barba completa e shampoo.
INSERT INTO sales (client_id, registered_by, total, commission_percent, commission_amount, status, notes)
SELECT c.id, @lucas_id, 60.00, 30.00, 18.00, 'completed', 'Seed demo: venda de demonstração 3'
FROM clients c WHERE c.email = 'marcos.oliveira@example.com';

SET @sale3 = LAST_INSERT_ID();
INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, discount_percent, discount_amount, subtotal)
VALUES
  (@sale3, (SELECT id FROM products WHERE name = 'Barba Completa'), 'Barba Completa', 1, 35.00, 0.00, 0.00, 35.00),
  (@sale3, (SELECT id FROM products WHERE name = 'Shampoo Especial'), 'Shampoo Especial', 1, 25.00, 0.00, 0.00, 25.00);

UPDATE products SET stock = stock - 1 WHERE name = 'Shampoo Especial';
INSERT INTO stock_movements (product_id, user_id, sale_id, movement_type, quantity_change, stock_after, notes)
SELECT p.id, @lucas_id, @sale3, 'sale', -1, p.stock, 'Saída por venda de demonstração'
FROM products p WHERE p.name = 'Shampoo Especial';

COMMIT;

SELECT 'Script de população executado com sucesso.' AS resultado;
