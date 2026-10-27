import { api, setCsrfToken, setUnauthorizedHandler } from "../models/api.model.js";

let currentUser = null;
let products = [];
let clients = [];
let permissionCatalog = [];
let saleDraftItems = [];
let toastTimeout;

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
const dateLabel = (value) => new Intl.DateTimeFormat("pt-BR").format(new Date(value));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 3200);
}

function can(permission) {
  if (!currentUser) return false;
  if (currentUser.is_admin || currentUser.permissions.includes(permission)) return true;
  if (permission === "clients.view") return currentUser.permissions.includes("clients.manage") || currentUser.permissions.includes("sales.create");
  if (permission === "products.view") return currentUser.permissions.includes("products.manage") || currentUser.permissions.includes("sales.create");
  return false;
}

function canOpenSales() {
  return can("sales.view") || can("sales.create");
}

function showLogin() {
  $("#login-screen").hidden = false;
  $("#app-shell").hidden = true;
  $("#login-password").value = "";
}

function showApplication(user, token) {
  currentUser = user;
  setCsrfToken(token);
  $("#login-screen").hidden = true;
  $("#app-shell").hidden = false;
  const initials = user.name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "N";
  $("#sidebar-avatar").textContent = initials;
  $("#top-avatar").textContent = initials;
  $("#sidebar-user").textContent = user.name;
  $("#sidebar-role").textContent = user.is_admin ? "Administrador" : "Usuário";
  document.querySelectorAll(".nav-link").forEach((button) => {
    const view = button.dataset.view;
    const permission = view === "users" ? "users.manage" : `${view}.view`;
    button.hidden = view === "sales" ? !canOpenSales() : view !== "dashboard" && !can(permission);
    if (view === "dashboard") button.hidden = !can("dashboard.view");
  });
  document.querySelectorAll("[data-go]").forEach((button) => {
    const view = button.dataset.go;
    button.hidden = view === "sales" ? !canOpenSales() : !can(`${view}.view`);
  });
  document.querySelectorAll(".quick-action").forEach((button) => {
    const view = button.dataset.go;
    button.hidden = view === "sales" ? !canOpenSales() : !can(`${view}.view`);
  });
  $("#dashboard-new-sale").hidden = !can("sales.create");
  $("#dashboard-view-sales").hidden = !can("sales.view");
  $("#dashboard-first-sale").hidden = !can("sales.view");
  $("#new-client-button").hidden = !can("clients.manage");
  $("#new-product-button").hidden = !can("products.manage");
  $("#new-user-button").hidden = !user.is_admin;
  $("#sale-form").hidden = !can("sales.create");
  const initialView = can("dashboard.view")
    ? "dashboard"
    : ["sales", "clients", "products", "users"].find((view) => view === "sales"
      ? canOpenSales()
      : can(view === "users" ? "users.manage" : `${view}.view`));
  if (initialView) navigate(initialView);
  else {
    document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
    $("#breadcrumb-current").textContent = "SEM ACESSO";
  }
}

function navigate(view) {
  const permission = view === "users" ? "users.manage" : `${view}.view`;
  if (view === "sales" ? !canOpenSales() : !can(permission)) {
    showToast("Seu usuário não tem permissão para acessar esta área.", true);
    return;
  }
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === `view-${view}`));
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const active = document.querySelector(`.nav-link[data-view="${view}"]`);
  $("#breadcrumb-current").textContent = active.textContent.trim().toLocaleUpperCase("pt-BR");
  window.scrollTo({ top: 0, behavior: "smooth" });
  loadView(view).catch((error) => showToast(error.message, true));
}

async function loadView(view) {
  if (view === "dashboard") await renderDashboard();
  if (view === "clients") await renderClients();
  if (view === "products") await renderProducts();
  if (view === "sales") await renderSales();
  if (view === "users") await renderUsers();
}

async function renderDashboard() {
  const { data: summary } = await api("dashboard");
  $("#dashboard-recent-panel").hidden = !can("sales.view");
  $("#stat-today").textContent = money(summary.today.total);
  $("#stat-today-count").textContent = `${summary.today.count} ${summary.today.count === 1 ? "venda realizada" : "vendas realizadas"}`;
  $("#stat-clients").textContent = summary.clients;
  $("#stat-products").textContent = summary.products.stock;
  $("#stat-stock").textContent = `${summary.products.count} ${summary.products.count === 1 ? "produto cadastrado" : "produtos cadastrados"}`;
  $("#low-stock-count").textContent = `${summary.products.low_stock} ${summary.products.low_stock === 1 ? "produto" : "produtos"}`;
  $("#recent-sales").innerHTML = summary.recent_sales.map((sale) => `
    <tr><td class="cell-main">${escapeHtml(sale.client_name)}</td><td>${escapeHtml(sale.product_name)}</td><td>${dateLabel(sale.date)}</td><td class="align-right money">${money(sale.total)}</td></tr>
  `).join("");
  $("#sales-empty").classList.toggle("visible", summary.recent_sales.length === 0);
}

async function renderClients() {
  const { data } = await api("clients");
  clients = data.map((client) => ({ ...client, id: Number(client.id) }));
  const query = $("#client-search").value.trim().toLocaleLowerCase("pt-BR");
  const rows = clients.filter((client) => `${client.name} ${client.phone} ${client.email || ""}`.toLocaleLowerCase("pt-BR").includes(query));
  $("#client-count").textContent = `${clients.length} ${clients.length === 1 ? "cliente cadastrado" : "clientes cadastrados"}`;
  $("#clients-table").innerHTML = rows.map((client) => `
    <tr><td class="cell-main">${escapeHtml(client.name)}</td><td>${escapeHtml(client.phone)}</td><td>${escapeHtml(client.email || "—")}</td><td>${dateLabel(client.created_at)}</td><td class="align-right">${can("clients.manage") ? `<button class="row-action" data-edit-client="${client.id}" aria-label="Editar ${escapeHtml(client.name)}">Editar</button><button class="row-action" data-delete-client="${client.id}" aria-label="Excluir ${escapeHtml(client.name)}">Excluir</button>` : ""}</td></tr>
  `).join("");
  $("#clients-empty").classList.toggle("visible", rows.length === 0);
  $("#clients-empty").querySelector("strong").textContent = clients.length && !rows.length ? "Nenhum resultado encontrado" : "Nenhum cliente cadastrado";
  renderSaleOptions();
}

async function renderProducts() {
  const { data } = await api("products");
  products = data.map((product) => ({ ...product, id: Number(product.id), price: Number(product.price), discount_percent: Number(product.discount_percent || 0), stock: Number(product.stock) }));
  const query = $("#product-search").value.trim().toLocaleLowerCase("pt-BR");
  const rows = products.filter((product) => `${product.name} ${product.category}`.toLocaleLowerCase("pt-BR").includes(query));
  $("#product-count").textContent = `${products.length} ${products.length === 1 ? "produto cadastrado" : "produtos cadastrados"}`;
  $("#products-table").innerHTML = rows.map((product) => {
    const isService = product.item_type === "S";
    const status = isService ? "" : product.stock === 0 ? "out" : product.stock <= Number(product.low_stock_threshold) ? "low" : "";
    const label = isService ? "Serviço" : product.stock === 0 ? "Esgotado" : `${product.stock} em estoque`;
    return `<tr><td class="cell-main">${escapeHtml(product.name)}</td><td>${escapeHtml(product.category)}</td><td class="money">${money(product.price)}</td><td><span class="status ${status}">${label}</span></td><td class="align-right">${can("products.manage") ? `<button class="row-action" data-edit-product="${product.id}" aria-label="Editar ${escapeHtml(product.name)}">Editar</button><button class="row-action" data-delete-product="${product.id}" aria-label="Excluir ${escapeHtml(product.name)}">Excluir</button>` : ""}</td></tr>`;
  }).join("");
  $("#products-empty").classList.toggle("visible", rows.length === 0);
  $("#products-empty").querySelector("strong").textContent = products.length && !rows.length ? "Nenhum resultado encontrado" : "Seu catálogo está vazio";
  renderSaleOptions();
}

function renderSaleOptions() {
  const clientSelect = $("#sale-client");
  const productSelect = $("#sale-product");
  if (!clientSelect || !productSelect) return;
  const selectedClient = clientSelect.value;
  const selectedProduct = productSelect.value;
  clientSelect.innerHTML = `<option value="">Selecione um cliente</option>${clients.map((client) => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join("")}`;
  productSelect.innerHTML = `<option value="">Selecione um produto ou serviço</option>${products.filter((product) => product.item_type === "S" || product.stock > 0).map((product) => `<option value="${product.id}">${escapeHtml(product.name)} — ${money(product.price)} (${product.item_type === "S" ? "Serviço" : `${product.stock} em estoque`})</option>`).join("")}`;
  clientSelect.value = selectedClient;
  productSelect.value = selectedProduct;
  updateSaleTotal();
}

async function renderSales() {
  const data = can("sales.view") ? (await api("sales")).data : [];
  const rows = data.map((sale) => ({ ...sale, id: Number(sale.id), total: Number(sale.total), quantity: Number(sale.quantity) }));
  $("#sales-table").innerHTML = rows.map((sale) => `
    <tr><td class="cell-main">${escapeHtml(sale.client_name)}</td><td>${escapeHtml(sale.product_name)}</td><td>${sale.quantity}</td><td>${escapeHtml(sale.registered_by_name || "—")}</td><td>${money(Number(sale.commission_amount || 0))}</td><td>${dateLabel(sale.date)}</td><td class="align-right money">${money(sale.total)}</td></tr>
  `).join("");
  $("#history-empty").classList.toggle("visible", rows.length === 0);
  $("#history-panel").hidden = !can("sales.view");
  const canCreate = can("sales.create");
  $("#sale-form").hidden = !canCreate;
  if (canCreate) {
    const [clientResult, productResult] = await Promise.all([api("clients"), api("products")]);
    clients = clientResult.data.map((client) => ({ ...client, id: Number(client.id) }));
    products = productResult.data.map((product) => ({ ...product, id: Number(product.id), price: Number(product.price), discount_percent: Number(product.discount_percent || 0), stock: Number(product.stock) }));
    renderSaleOptions();
  }
}

async function renderUsers() {
  if (!permissionCatalog.length) {
    const { data } = await api("users/permissions");
    permissionCatalog = data;
  }
  const { data } = await api("users");
  $("#user-count").textContent = `${data.length} ${data.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}`;
  $("#users-table").innerHTML = data.map((user) => `
    <tr><td class="cell-main">${escapeHtml(user.name)}</td><td>${escapeHtml(user.email)}</td><td><span class="role-label ${user.is_admin ? "" : "normal"}">${user.is_admin ? "Administrador" : "Usuário normal"}</span></td><td>${Number(user.commission_percent || 0).toFixed(2)}%</td><td>${user.is_active ? '<span class="status">Ativo</span>' : '<span class="inactive-label">Inativo</span>'}</td><td class="align-right"><button class="row-action" data-edit-user="${user.id}" aria-label="Editar ${escapeHtml(user.name)}">Editar</button></td></tr>
  `).join("");
  $("#users-empty").classList.toggle("visible", data.length === 0);
}

function saleItemSubtotal(item) {
  const gross = item.price * item.quantity;
  return gross * (1 - item.discount_percent / 100);
}

function updateSaleTotal() {
  const product = products.find((item) => item.id === Number($("#sale-product").value));
  $("#sale-unit-price").textContent = product ? money(product.price) : money(0);
  const total = saleDraftItems.reduce((sum, item) => sum + saleItemSubtotal(item), 0);
  $("#sale-total").textContent = money(total);
}

function renderSaleDraft() {
  $("#sale-items").innerHTML = saleDraftItems.map((item, index) => `
    <tr><td class="cell-main">${escapeHtml(item.name)}</td><td>${item.quantity}</td>
    <td><input type="number" min="0" max="100" step="0.01" value="${item.discount_percent}" data-sale-item-discount="${index}" aria-label="Desconto de ${escapeHtml(item.name)}"></td>
    <td class="align-right money">${money(saleItemSubtotal(item))}</td>
    <td class="align-right"><button type="button" class="row-action" data-remove-sale-item="${index}">Remover</button></td></tr>
  `).join("");
  updateSaleTotal();
}

function openClientModal(client) {
  $("#client-form").reset();
  $("#client-id").value = client?.id || "";
  $("#client-modal-title").textContent = client ? "Editar cliente" : "Novo cliente";
  if (client) {
    $("#client-name").value = client.name;
    $("#client-phone").value = client.phone;
    $("#client-email").value = client.email || "";
  }
  $("#client-modal").showModal();
}

function toggleProductStock() {
  const isProduct = $("#product-type").checked;
  $("#product-type-label").textContent = isProduct ? "Produto" : "Serviço";
  $("#product-stock").disabled = !isProduct;
  $("#product-stock").required = isProduct;
  if (!isProduct) $("#product-stock").value = "0";
}

function openProductModal(product) {
  $("#product-form").reset();
  $("#product-id").value = product?.id || "";
  $("#product-modal-title").textContent = product ? "Editar cadastro" : "Novo cadastro";
  $("#product-type").checked = product ? product.item_type === "P" : true;
  if (product) {
    $("#product-name").value = product.name;
    $("#product-category").value = product.category;
    $("#product-price").value = product.price;
    $("#product-discount").value = product.discount_percent ?? 0;
    $("#product-stock").value = product.stock;
  }
  toggleProductStock();
  $("#product-modal").showModal();
}

function openUserModal(user) {
  $("#user-form").reset();
  $("#user-form-error").textContent = "";
  $("#user-id").value = user?.id || "";
  $("#user-modal-title").textContent = user ? "Editar usuário" : "Novo usuário";
  $("#user-password").required = !user;
  $("#password-hint").textContent = user ? "(deixe vazio para manter a senha atual)" : "(mínimo 12 caracteres)";
  $("#user-email").readOnly = Boolean(user && user.id === currentUser.id);
  $("#user-active-wrap").hidden = !user || user.id === currentUser.id;
  if (user) {
    $("#user-name").value = user.name;
    $("#user-email").value = user.email;
    $("#user-is-admin").checked = user.is_admin;
    $("#user-active").checked = user.is_active;
    $("#user-commission").value = user.commission_percent ?? 0;
  }
  const selected = new Set(user?.permissions || []);
  $("#permission-list").innerHTML = permissionCatalog.map((permission) => `
    <label class="permission-option"><input type="checkbox" value="${permission.id}" ${selected.has(permission.code) ? "checked" : ""}><span>${escapeHtml(permission.name)}<small>${escapeHtml(permission.description)}</small></span></label>
  `).join("");
  $("#permission-picker").hidden = $("#user-is-admin").checked;
  $("#user-modal").showModal();
}

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.view));
});
document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.go));
});
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
$("#new-client-button").addEventListener("click", () => openClientModal());
$("#new-product-button").addEventListener("click", () => openProductModal());
$("#new-user-button").addEventListener("click", () => openUserModal());
$("#client-search").addEventListener("input", () => renderClients().catch((error) => showToast(error.message, true)));
$("#product-search").addEventListener("input", () => renderProducts().catch((error) => showToast(error.message, true)));
$("#product-type").addEventListener("change", toggleProductStock);
$("#sale-product").addEventListener("change", () => {
  const product = products.find((item) => item.id === Number($("#sale-product").value));
  $("#sale-discount").value = product ? product.discount_percent ?? 0 : 0;
  updateSaleTotal();
});
$("#sale-quantity").addEventListener("input", updateSaleTotal);
$("#sale-add-item").addEventListener("click", () => {
  const productId = Number($("#sale-product").value);
  const quantity = Number($("#sale-quantity").value);
  const product = products.find((item) => item.id === productId);
  if (!product) return showToast("Selecione um produto ou serviço.", true);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return showToast("Informe uma quantidade válida.", true);
  if (product.item_type === "P" && product.stock < quantity) return showToast(`Estoque insuficiente. Disponível: ${product.stock}.`, true);
  const existingIndex = saleDraftItems.findIndex((item) => item.product_id === productId);
  if (existingIndex >= 0) saleDraftItems[existingIndex].quantity += quantity;
  else saleDraftItems.push({ product_id: productId, name: product.name, price: product.price, quantity, discount_percent: Number($("#sale-discount").value || 0) });
  renderSaleDraft();
});
$("#sale-items").addEventListener("change", (event) => {
  const input = event.target.closest("[data-sale-item-discount]");
  if (!input) return;
  const discount = Number(input.value);
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    input.value = saleDraftItems[Number(input.dataset.saleItemDiscount)].discount_percent;
    return showToast("O desconto deve estar entre 0% e 100%.", true);
  }
  saleDraftItems[Number(input.dataset.saleItemDiscount)].discount_percent = discount;
  renderSaleDraft();
});
$("#sale-items").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-sale-item]");
  if (!button) return;
  saleDraftItems.splice(Number(button.dataset.removeSaleItem), 1);
  renderSaleDraft();
});
$("#user-is-admin").addEventListener("change", () => {
  $("#permission-picker").hidden = $("#user-is-admin").checked;
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").textContent = "";
  const button = $("#login-form").querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { user, csrf_token: token } = await api("login", {
      method: "POST",
      body: { email: $("#login-email").value.trim(), password: $("#login-password").value },
    });
    showApplication(user, token);
  } catch (error) {
    $("#login-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#logout-button").addEventListener("click", async () => {
  try {
    await api("logout", { method: "POST", body: {} });
    currentUser = null;
    setCsrfToken("");
    showLogin();
  } catch (error) {
    showToast(error.message, true);
  }
});

$("#client-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#client-id").value;
  const body = {
    name: $("#client-name").value.trim(),
    phone: $("#client-phone").value.trim(),
    email: $("#client-email").value.trim(),
  };
  try {
    await api(id ? `clients/${id}` : "clients", { method: id ? "PUT" : "POST", body });
    $("#client-modal").close();
    await renderClients();
    showToast(id ? "Cliente atualizado com sucesso." : "Cliente cadastrado com sucesso.");
  } catch (error) {
    showToast(error.message, true);
  }
});

$("#product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#product-id").value;
  const body = {
    name: $("#product-name").value.trim(),
    category: $("#product-category").value.trim(),
    price: Number($("#product-price").value),
    discount_percent: Number($("#product-discount").value),
    stock: $("#product-type").checked ? Number($("#product-stock").value) : 0,
    item_type: $("#product-type").checked ? "P" : "S",
  };
  try {
    await api(id ? `products/${id}` : "products", { method: id ? "PUT" : "POST", body });
    $("#product-modal").close();
    await renderProducts();
    showToast(id ? "Produto atualizado com sucesso." : "Produto cadastrado com sucesso.");
  } catch (error) {
    showToast(error.message, true);
  }
});

$("#sale-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const clientId = Number($("#sale-client").value);
  const client = clients.find((item) => item.id === clientId);
  if (!client) return showToast("Selecione um cliente.", true);
  if (saleDraftItems.length === 0) return showToast("Adicione pelo menos um produto ou serviço.", true);
  const total = saleDraftItems.reduce((sum, item) => sum + saleItemSubtotal(item), 0);
  const commissionPercent = Number(currentUser.commission_percent || 0);
  $("#sale-summary-content").innerHTML = `
    <p><strong>Cliente:</strong> ${escapeHtml(client.name)}</p>
    <p><strong>Registrado por:</strong> ${escapeHtml(currentUser.name)}</p>
    <div class="table-wrap"><table><thead><tr><th>ITEM</th><th>QTD.</th><th>DESCONTO</th><th class="align-right">SUBTOTAL</th></tr></thead>
    <tbody>${saleDraftItems.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${item.discount_percent.toFixed ? item.discount_percent.toFixed(2) : item.discount_percent}%</td><td class="align-right money">${money(saleItemSubtotal(item))}</td></tr>`).join("")}</tbody></table></div>
    <p class="sale-total"><span>Total</span><strong>${money(total)}</strong></p>
    <p><strong>Comissão (${commissionPercent.toFixed(2)}%):</strong> ${money(total * commissionPercent / 100)}</p>`;
  $("#sale-summary-modal").showModal();
});

$("#sale-confirm-button").addEventListener("click", async () => {
  const body = {
    client_id: Number($("#sale-client").value),
    items: saleDraftItems.map((item) => ({ product_id: item.product_id, quantity: item.quantity, discount_percent: item.discount_percent })),
  };
  try {
    await api("sales", { method: "POST", body });
    $("#sale-summary-modal").close();
    $("#sale-form").reset();
    $("#sale-quantity").value = "1";
    saleDraftItems = [];
    renderSaleDraft();
    const refreshes = [renderSales()];
    if (can("products.view")) refreshes.push(renderProducts());
    if (can("dashboard.view")) refreshes.push(renderDashboard());
    await Promise.all(refreshes);
    showToast("Venda registrada com sucesso.");
  } catch (error) {
    showToast(error.message, true);
  }
});

$("#user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#user-form-error").textContent = "";
  const id = $("#user-id").value;
  const body = {
    name: $("#user-name").value.trim(),
    email: $("#user-email").value.trim(),
    password: $("#user-password").value,
    is_admin: $("#user-is-admin").checked,
    is_active: $("#user-active").checked,
    commission_percent: Number($("#user-commission").value),
    permission_ids: Array.from($("#permission-list").querySelectorAll('input[type="checkbox"]:checked'))
      .map((input) => Number(input.value)),
  };
  try {
    await api(id ? `users/${id}` : "users", { method: id ? "PUT" : "POST", body });
    $("#user-modal").close();
    await renderUsers();
    showToast(id ? "Usuário atualizado com sucesso." : "Usuário cadastrado com sucesso.");
    if (id === String(currentUser.id)) {
      const { user, csrf_token: token } = await api("session");
      showApplication(user, token);
    }
  } catch (error) {
    $("#user-form-error").textContent = error.message;
  }
});

$("#clients-table").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-client]");
  const deleteButton = event.target.closest("[data-delete-client]");
  if (editButton) {
    openClientModal(clients.find((client) => client.id === Number(editButton.dataset.editClient)));
  } else if (deleteButton) {
    const client = clients.find((item) => item.id === Number(deleteButton.dataset.deleteClient));
    if (client && window.confirm(`Excluir ${client.name} da lista? Clientes vinculados a vendas não podem ser excluídos.`)) {
      try {
        await api(`clients/${client.id}`, { method: "DELETE" });
        await renderClients();
        showToast("Cliente excluído.");
      } catch (error) {
        showToast(error.message, true);
      }
    }
  }
});

$("#products-table").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-product]");
  const deleteButton = event.target.closest("[data-delete-product]");
  if (editButton) {
    openProductModal(products.find((product) => product.id === Number(editButton.dataset.editProduct)));
  } else if (deleteButton) {
    const product = products.find((item) => item.id === Number(deleteButton.dataset.deleteProduct));
    if (product && window.confirm(`Desativar ${product.name} do catálogo? O histórico de vendas será mantido.`)) {
      try {
        await api(`products/${product.id}`, { method: "DELETE" });
        await renderProducts();
        showToast("Produto desativado.");
      } catch (error) {
        showToast(error.message, true);
      }
    }
  }
});

$("#users-table").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-user]");
  if (!button) return;
  try {
    const { data } = await api("users");
    const user = data.find((item) => item.id === Number(button.dataset.editUser));
    if (user) openUserModal(user);
  } catch (error) {
    showToast(error.message, true);
  }
});

$("#today-label").textContent = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short", day: "numeric", month: "short", year: "numeric",
}).format(new Date());

setUnauthorizedHandler(() => {
  currentUser = null;
  setCsrfToken("");
  showLogin();
});

async function initialize() {
  try {
    const response = await api("session");
    if (response.authenticated) {
      showApplication(response.user, response.csrf_token);
      return;
    }
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
  showLogin();
}

initialize();
