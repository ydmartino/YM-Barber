import { api, setCsrfToken, setUnauthorizedHandler } from "../models/api.model.js";

let currentUser = null;
let products = [];
let clients = [];
let barbers = [];
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
  $("#sidebar-role").textContent = user.is_admin ? "Administrador" : user.role === "reception" ? "Recepção" : "Barbeiro";
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
  $("#commission-stat").hidden = !can("commissions.view");
  $("#working-hours-button").hidden = !can("appointments.manage");
  $("#new-appointment-button").hidden = !can("appointments.manage");
  $("#appointment-barber-wrap").hidden = user.role === "barber";
  $("#sale-form").hidden = !can("sales.create");
  const initialView = can("dashboard.view")
    ? "dashboard"
    : ["sales", "appointments", "commissions", "clients", "products", "users"].find((view) => view === "sales"
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
  if (view === "appointments") await renderAppointments();
  if (view === "commissions") await renderCommissions();
  if (view === "users") await renderUsers();
}

async function renderDashboard() {
  const { data: summary } = await api("dashboard");
  $("#dashboard-recent-panel").hidden = !can("sales.view");
  $("#stat-today").textContent = money(summary.today.total);
  $("#stat-today-count").textContent = `${summary.today.count} ${summary.today.count === 1 ? "venda realizada" : "vendas realizadas"}`;
  $("#stat-commission").textContent = money(summary.today.commission);
  $("#stat-clients").textContent = summary.clients;
  $("#stat-products").textContent = summary.products.stock;
  $("#stat-stock").textContent = `${summary.products.count} ${summary.products.count === 1 ? "produto cadastrado" : "produtos cadastrados"}`;
  $("#low-stock-count").textContent = `${summary.products.low_stock} ${summary.products.low_stock === 1 ? "produto" : "produtos"}`;
  $("#client-segments").innerHTML = `<p class="eyebrow">SEGMENTAÇÃO DE CLIENTES</p>${summary.client_segments.map((segment) => `<div class="segment-row"><span>${escapeHtml(segment.label)}</span><strong>${segment.client_count}</strong></div>`).join("")}`;
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
    <tr><td class="cell-main">${escapeHtml(client.name)}</td><td>${escapeHtml(client.phone)}</td><td>${escapeHtml(client.email || "—")}</td><td>${dateLabel(client.created_at)}</td><td class="align-right">${can("appointments.view") ? `<button class="row-action" data-client-history="${client.id}" aria-label="Histórico de ${escapeHtml(client.name)}">Histórico</button>` : ""}${can("clients.manage") ? `<button class="row-action" data-edit-client="${client.id}" aria-label="Editar ${escapeHtml(client.name)}">Editar</button><button class="row-action" data-delete-client="${client.id}" aria-label="Excluir ${escapeHtml(client.name)}">Excluir</button>` : ""}</td></tr>
  `).join("");
  $("#clients-empty").classList.toggle("visible", rows.length === 0);
  $("#clients-empty").querySelector("strong").textContent = clients.length && !rows.length ? "Nenhum resultado encontrado" : "Nenhum cliente cadastrado";
  renderSaleOptions();
}

async function renderProducts() {
  const { data } = await api("products");
  products = data.map((product) => ({ ...product, id: Number(product.id), price: Number(product.price), discount_percent: Number(product.discount_percent || 0), stock: Number(product.stock), low_stock_threshold: Number(product.low_stock_threshold), duration_minutes: Number(product.duration_minutes || 0) }));
  const query = $("#product-search").value.trim().toLocaleLowerCase("pt-BR");
  const rows = products.filter((product) => `${product.name} ${product.category}`.toLocaleLowerCase("pt-BR").includes(query));
  $("#product-count").textContent = `${products.length} ${products.length === 1 ? "produto cadastrado" : "produtos cadastrados"}`;
  $("#products-table").innerHTML = rows.map((product) => {
    const isService = product.item_type === "S";
    const status = isService ? "" : product.stock === 0 ? "out" : product.stock <= Number(product.low_stock_threshold) ? "low" : "";
    const label = isService
      ? `Serviço · ${product.duration_minutes} min`
      : product.stock === 0 ? "Esgotado" : `${product.stock} em estoque · mín. ${product.low_stock_threshold}`;
    const entryButton = !isService && can("stock.manage")
      ? `<button class="row-action" data-entry-stock="${product.id}" aria-label="Registrar reposição para ${escapeHtml(product.name)}">Entrada</button>`
      : "";
    return `<tr><td class="cell-main">${escapeHtml(product.name)}</td><td>${escapeHtml(product.category)}</td><td class="money">${money(product.price)}</td><td><span class="status ${status}">${label}</span></td><td class="align-right">${entryButton}${can("products.manage") ? `<button class="row-action" data-edit-product="${product.id}" aria-label="Editar ${escapeHtml(product.name)}">Editar</button><button class="row-action" data-delete-product="${product.id}" aria-label="Excluir ${escapeHtml(product.name)}">Excluir</button>` : ""}</td></tr>`;
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

async function renderClientSalesHistory() {
  if (!can("sales.view")) {
    $("#history-panel").hidden = true;
    return;
  }
  const clientId = Number($("#sale-client").value);
  if (!Number.isSafeInteger(clientId) || clientId < 1) {
    $("#sales-table").innerHTML = "";
    $("#history-empty").classList.add("visible");
    $("#history-empty strong").textContent = "Selecione um cliente";
    $("#history-empty p").textContent = "As últimas 5 vendas deste cliente aparecerão aqui.";
    return;
  }
  const { data } = await api(`sales/${clientId}`);
  const rows = data.map((sale) => ({ ...sale, id: Number(sale.id), total: Number(sale.total), quantity: Number(sale.quantity) }));
  $("#sales-table").innerHTML = rows.map((sale) => `
    <tr><td class="cell-main">${escapeHtml(sale.client_name)}</td><td>${escapeHtml(sale.product_name)}</td><td>${sale.quantity}</td><td>${escapeHtml(sale.registered_by_name || "—")}</td><td>${money(Number(sale.commission_amount || 0))}</td><td>${dateLabel(sale.date)}</td><td class="align-right money">${money(sale.total)}</td></tr>
  `).join("");
  $("#history-empty").classList.toggle("visible", rows.length === 0);
  $("#history-empty strong").textContent = "Nenhuma venda registrada";
  $("#history-empty p").textContent = "Não há vendas deste cliente no histórico recente.";
}

async function renderSales() {
  $("#history-panel").hidden = !can("sales.view");
  const canCreate = can("sales.create");
  $("#sale-form").hidden = !canCreate;
  if (canCreate) {
    const [clientResult, productResult] = await Promise.all([api("clients"), api("products")]);
    clients = clientResult.data.map((client) => ({ ...client, id: Number(client.id) }));
    products = productResult.data.map((product) => ({ ...product, id: Number(product.id), price: Number(product.price), discount_percent: Number(product.discount_percent || 0), stock: Number(product.stock) }));
    renderSaleOptions();
  }
  await renderClientSalesHistory();
}

async function renderUsers() {
  if (!permissionCatalog.length) {
    const { data } = await api("users/permissions");
    permissionCatalog = data;
  }
  const { data } = await api("users");
  $("#user-count").textContent = `${data.length} ${data.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}`;
  $("#users-table").innerHTML = data.map((user) => `
    <tr><td class="cell-main">${escapeHtml(user.name)}</td><td>${escapeHtml(user.email)}</td><td><span class="role-label ${user.is_admin ? "" : "normal"}">${user.is_admin ? "Administrador" : user.role === "reception" ? "Recepção" : "Barbeiro"}</span></td><td>${Number(user.commission_percent || 0).toFixed(2)}%</td><td>${user.is_active ? '<span class="status">Ativo</span>' : '<span class="inactive-label">Inativo</span>'}</td><td class="align-right"><button class="row-action" data-edit-user="${user.id}" aria-label="Editar ${escapeHtml(user.name)}">Editar</button></td></tr>
  `).join("");
  $("#users-empty").classList.toggle("visible", data.length === 0);
}

function todayInputValue() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function loadBarbers() {
  barbers = await api("booking/barbers");
  return barbers;
}

async function renderAppointments() {
  if (!$("#appointment-date").value) $("#appointment-date").value = todayInputValue();
  await loadBarbers();
  const barberSelect = $("#appointment-barber");
  const selectedBarber = barberSelect.value;
  barberSelect.innerHTML = `<option value="">Todos os barbeiros</option>${barbers.map((barber) => `<option value="${barber.id}">${escapeHtml(barber.name)}</option>`).join("")}`;
  barberSelect.value = selectedBarber;
  const query = { date: $("#appointment-date").value };
  if (barberSelect.value) query.barber_id = barberSelect.value;
  const { data } = await api("appointments", { query });
  const statusLabels = {
    scheduled: "Agendado",
    completed: "Concluído",
    cancelled: "Cancelado",
    no_show: "Faltou",
  };
  $("#appointments-table").innerHTML = data.map((appointment) => {
    const actions = can("appointments.manage") && appointment.status === "scheduled"
      ? `<button class="row-action" data-appointment-status="${appointment.id}:completed">Concluído</button><button class="row-action" data-appointment-status="${appointment.id}:no_show">Falta</button><button class="row-action" data-appointment-status="${appointment.id}:cancelled">Cancelar</button>`
      : "";
    return `<tr><td class="cell-main">${appointment.start_at.slice(11, 16)}</td><td>${escapeHtml(appointment.client_name)}</td><td>${escapeHtml(appointment.client_phone)}</td><td>${escapeHtml(appointment.service_name)}</td><td>${escapeHtml(appointment.barber_name)}</td><td><span class="status ${appointment.status === "cancelled" ? "out" : ""}">${statusLabels[appointment.status]}</span></td><td>${appointment.risk_high ? '<span class="risk-label">Alto</span>' : "—"}</td><td class="align-right">${actions}</td></tr>`;
  }).join("");
  $("#appointments-empty").classList.toggle("visible", data.length === 0);
}

async function loadAppointmentSlots() {
  const timeSelect = $("#appointment-time");
  timeSelect.disabled = true;
  const serviceId = $("#appointment-service").value;
  const barberId = $("#appointment-form-barber").value;
  const date = $("#appointment-form-date").value;
  if (!serviceId || !barberId || !date) {
    timeSelect.innerHTML = '<option value="">Selecione serviço, barbeiro e data</option>';
    return;
  }
  try {
    const result = await api("booking/availability", {
      query: { service_id: serviceId, barber_id: barberId, date },
    });
    timeSelect.innerHTML = result.slots.length
      ? `<option value="">Selecione um horário</option>${result.slots.map((slot) => `<option value="${slot.time}">${slot.time}</option>`).join("")}`
      : '<option value="">Não há horários livres nesta data</option>';
    timeSelect.disabled = result.slots.length === 0;
  } catch (error) {
    $("#appointment-form-error").textContent = error.message;
    timeSelect.innerHTML = '<option value="">Não foi possível carregar os horários</option>';
  }
}

async function openAppointmentModal() {
  $("#appointment-form-error").textContent = "";
  try {
    const [clientResult, services, availableBarbers] = await Promise.all([
      api("clients"),
      api("booking/services"),
      loadBarbers(),
    ]);
    clients = clientResult.data.map((client) => ({ ...client, id: Number(client.id) }));
    const selectableBarbers = currentUser.role === "barber"
      ? availableBarbers.filter((barber) => barber.id === currentUser.id)
      : availableBarbers;
    $("#appointment-client").innerHTML = `<option value="">Selecione um cliente</option>${clients.map((client) => `<option value="${client.id}">${escapeHtml(client.name)} — ${escapeHtml(client.phone)}</option>`).join("")}`;
    updateAppointmentConsent();
    $("#appointment-service").innerHTML = `<option value="">Selecione um serviço</option>${services.map((service) => `<option value="${service.id}">${escapeHtml(service.name)} — ${service.duration_minutes} min</option>`).join("")}`;
    $("#appointment-form-barber").innerHTML = `<option value="">Selecione um barbeiro</option>${selectableBarbers.map((barber) => `<option value="${barber.id}">${escapeHtml(barber.name)}</option>`).join("")}`;
    $("#appointment-form-date").value = $("#appointment-date").value || todayInputValue();
    const latest = new Date();
    latest.setDate(latest.getDate() + 90);
    $("#appointment-form-date").min = todayInputValue();
    $("#appointment-form-date").max = `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, "0")}-${String(latest.getDate()).padStart(2, "0")}`;
    if (!clients.length) {
      $("#appointment-form-error").textContent = "Cadastre um cliente antes de marcar o horário.";
    }
    $("#appointment-modal").showModal();
    await loadAppointmentSlots();
  } catch (error) {
    showToast(error.message, true);
  }
}

function updateAppointmentConsent() {
  const client = clients.find((item) => item.id === Number($("#appointment-client").value));
  const consentRequired = Boolean(client && !client.consent_at);
  $("#appointment-consent-wrap").hidden = !consentRequired;
  $("#appointment-consent").required = consentRequired;
  $("#appointment-consent").checked = false;
}

async function renderCommissions() {
  const today = todayInputValue();
  if (!$("#commission-to").value) $("#commission-to").value = today;
  if (!$("#commission-from").value) {
    const start = new Date();
    start.setDate(1);
    $("#commission-from").value = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  }
  const { data } = await api("commissions", {
    query: { from: $("#commission-from").value, to: $("#commission-to").value },
  });
  $("#commission-total").textContent = money(data.total);
  $("#commissions-table").innerHTML = data.sales.map((sale) => `
    <tr><td>${dateLabel(sale.sold_at)}</td><td class="cell-main">${escapeHtml(sale.client_name)}</td><td>${escapeHtml(sale.barber_name || "—")}</td><td>${money(sale.total)}</td><td>${sale.commission_percent.toFixed(2)}%</td><td class="align-right money">${money(sale.commission_amount)}</td></tr>
  `).join("");
  $("#commissions-empty").classList.toggle("visible", data.sales.length === 0);
}

function openWorkingHoursModal() {
  const days = [
    [1, "Segunda"], [2, "Terça"], [3, "Quarta"], [4, "Quinta"],
    [5, "Sexta"], [6, "Sábado"], [7, "Domingo"],
  ];
  const options = barbers.map((barber) => `<option value="${barber.id}">${escapeHtml(barber.name)}</option>`).join("");
  $("#hours-barber").innerHTML = options;
  $("#hours-barber").disabled = currentUser.role === "barber";
  if (currentUser.role === "barber") $("#hours-barber").value = String(currentUser.id);
  $("#working-hours-list").innerHTML = days.map(([weekday, label]) => `
    <div class="working-hours-row">
      <label><input type="checkbox" data-working-weekday="${weekday}"> ${label}</label>
      <input type="time" data-working-start="${weekday}" value="09:00" aria-label="Início ${label}">
      <input type="time" data-working-end="${weekday}" value="20:00" aria-label="Fim ${label}">
    </div>
  `).join("");
  $("#working-hours-error").textContent = "";
  $("#working-hours-modal").showModal();
  loadWorkingHours();
}

async function loadWorkingHours() {
  const barberId = $("#hours-barber").value;
  if (!barberId) return;
  try {
    const { data } = await api("appointments/hours", { query: { barber_id: barberId } });
    document.querySelectorAll("[data-working-weekday]").forEach((input) => {
      const saved = data.find((entry) => Number(entry.weekday) === Number(input.dataset.workingWeekday));
      input.checked = Boolean(saved);
      if (saved) {
        $(`[data-working-start="${input.dataset.workingWeekday}"]`).value = String(saved.start_time).slice(0, 5);
        $(`[data-working-end="${input.dataset.workingWeekday}"]`).value = String(saved.end_time).slice(0, 5);
      }
    });
  } catch (error) {
    $("#working-hours-error").textContent = error.message;
  }
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

function getSaleDiscountMaximum(productId) {
  const productIds = [...saleDraftItems.map((item) => item.product_id), Number(productId)];
  const limits = [...new Set(productIds)]
    .map((id) => products.find((item) => item.id === id))
    .filter(Boolean)
    .map((item) => Number(item.discount_percent || 0));
  return limits.length ? Math.min(...limits) : 0;
}

function renderSaleDraft() {
  $("#sale-items").innerHTML = saleDraftItems.map((item, index) => {
    const maximum = getSaleDiscountMaximum(item.product_id);
    return `
    <tr><td class="cell-main">${escapeHtml(item.name)}</td><td>${item.quantity}</td>
    <td><input type="number" min="0" max="${maximum}" step="0.01" value="${item.discount_percent}" data-sale-item-discount="${index}" aria-label="Desconto de ${escapeHtml(item.name)}"></td>
    <td class="align-right money">${money(saleItemSubtotal(item))}</td>
    <td class="align-right"><button type="button" class="row-action" data-remove-sale-item="${index}">Remover</button></td></tr>
  `;
  }).join("");
  updateSaleTotal();
}

function openClientModal(client) {
  $("#client-form").reset();
  $("#client-id").value = client?.id || "";
  $("#client-modal-title").textContent = client ? "Editar cliente" : "Novo cliente";
  $("#client-consent").checked = Boolean(client?.consent_at);
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
  $("#product-threshold").disabled = !isProduct;
  $("#product-threshold").required = isProduct;
  $("#product-duration-wrap").hidden = isProduct;
  $("#product-duration").required = !isProduct;
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
    $("#product-threshold").value = product.low_stock_threshold ?? 5;
    $("#product-duration").value = product.duration_minutes || 30;
  } else {
    $("#product-threshold").value = "5";
    $("#product-duration").value = "30";
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
  $("#user-role").value = user?.role === "reception" ? "reception" : "barber";
  $("#user-role").disabled = Boolean(user?.is_admin);
  $("#user-role").closest(".field").hidden = Boolean(user?.is_admin);
  $("#user-active-wrap").hidden = !user || user.id === currentUser.id;
  if (user) {
    $("#user-name").value = user.name;
    $("#user-email").value = user.email;
    $("#user-is-admin").checked = user.is_admin;
    $("#user-active").checked = user.is_active;
    $("#user-commission").value = user.commission_percent ?? 0;
  }
  const defaultPermissions = $("#user-role").value === "reception"
    ? ["dashboard.view", "clients.view", "clients.manage", "appointments.view", "appointments.manage"]
    : ["dashboard.view", "clients.view", "products.view", "sales.view", "sales.create", "appointments.view", "appointments.manage", "commissions.view"];
  const selected = new Set(user?.permissions || (user ? [] : defaultPermissions));
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
$("#working-hours-button").addEventListener("click", () => openWorkingHoursModal());
$("#new-appointment-button").addEventListener("click", () => openAppointmentModal());
$("#appointment-client").addEventListener("change", updateAppointmentConsent);
$("#appointment-date").addEventListener("change", () => renderAppointments().catch((error) => showToast(error.message, true)));
$("#appointment-barber").addEventListener("change", () => renderAppointments().catch((error) => showToast(error.message, true)));
$("#hours-barber").addEventListener("change", () => loadWorkingHours());
$("#commission-search").addEventListener("click", () => renderCommissions().catch((error) => showToast(error.message, true)));
for (const selector of ["#appointment-service", "#appointment-form-barber", "#appointment-form-date"]) {
  $(selector).addEventListener("change", () => loadAppointmentSlots());
}
$("#client-search").addEventListener("input", () => renderClients().catch((error) => showToast(error.message, true)));
$("#product-search").addEventListener("input", () => renderProducts().catch((error) => showToast(error.message, true)));
$("#product-type").addEventListener("change", toggleProductStock);
$("#sale-client").addEventListener("change", () => {
  renderClientSalesHistory().catch((error) => showToast(error.message, true));
});
$("#sale-product").addEventListener("change", () => {
  const product = products.find((item) => item.id === Number($("#sale-product").value));
  const maximum = product ? getSaleDiscountMaximum(product.id) : 0;
  $("#sale-discount").max = String(maximum);
  $("#sale-discount").value = product ? Math.min(Number(product.discount_percent || 0), maximum) : 0;
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
  const requestedDiscount = Number($("#sale-discount").value || 0);
  const maximum = getSaleDiscountMaximum(productId);
  if (saleDraftItems.some((item) => Number(item.discount_percent) > maximum)) {
    return showToast(`Reduza os descontos existentes para até ${maximum.toFixed(2)}% antes de adicionar este item.`, true);
  }
  if (!Number.isFinite(requestedDiscount) || requestedDiscount < 0 || requestedDiscount > maximum) {
    return showToast(`O desconto máximo permitido para este item é ${maximum.toFixed(2)}%.`, true);
  }
  const existingIndex = saleDraftItems.findIndex((item) => item.product_id === productId);
  if (existingIndex >= 0) {
    if (Number(saleDraftItems[existingIndex].discount_percent) !== requestedDiscount) {
      return showToast("Para alterar o desconto deste item, edite diretamente na tabela da venda.", true);
    }
    saleDraftItems[existingIndex].quantity += quantity;
  } else {
    saleDraftItems.push({ product_id: productId, name: product.name, price: product.price, quantity, discount_percent: requestedDiscount });
  }
  renderSaleDraft();
});
$("#sale-items").addEventListener("change", (event) => {
  const input = event.target.closest("[data-sale-item-discount]");
  if (!input) return;
  const index = Number(input.dataset.saleItemDiscount);
  const discount = Number(input.value);
  const item = saleDraftItems[index];
  const maximum = getSaleDiscountMaximum(item.product_id);
  if (!Number.isFinite(discount) || discount < 0 || discount > maximum) {
    input.value = item.discount_percent;
    return showToast(`O desconto máximo permitido é ${maximum.toFixed(2)}%.`, true);
  }
  item.discount_percent = discount;
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
  $("#user-role").closest(".field").hidden = $("#user-is-admin").checked;
});
$("#user-role").addEventListener("change", () => {
  if ($("#user-id").value) return;
  const defaults = $("#user-role").value === "reception"
    ? ["dashboard.view", "clients.view", "clients.manage", "appointments.view", "appointments.manage"]
    : ["dashboard.view", "clients.view", "products.view", "sales.view", "sales.create", "appointments.view", "appointments.manage", "commissions.view"];
  document.querySelectorAll("#permission-list input[type=checkbox]").forEach((input) => {
    const permission = permissionCatalog.find((item) => item.id === Number(input.value));
    input.checked = defaults.includes(permission?.code);
  });
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
    consent: $("#client-consent").checked,
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
    low_stock_threshold: $("#product-type").checked ? Number($("#product-threshold").value) : 0,
    item_type: $("#product-type").checked ? "P" : "S",
    duration_minutes: $("#product-type").checked ? null : Number($("#product-duration").value),
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

async function submitSale(discountAuthorization = null) {
  const body = {
    client_id: Number($("#sale-client").value),
    items: saleDraftItems.map((item) => ({ product_id: item.product_id, quantity: item.quantity, discount_percent: item.discount_percent })),
  };
  if (discountAuthorization) body.discount_authorization = discountAuthorization;
  try {
    await api("sales", { method: "POST", body });
    $("#discount-auth-modal").close();
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
    if (discountAuthorization) $("#discount-auth-error").textContent = error.message;
    else showToast(error.message, true);
  }
}

$("#sale-confirm-button").addEventListener("click", () => {
  if (saleDraftItems.some((item) => Number(item.discount_percent) > 15)) {
    $("#discount-auth-error").textContent = "";
    $("#discount-auth-modal").showModal();
    return;
  }
  submitSale();
});

$("#discount-auth-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitSale({
    email: $("#discount-admin-email").value.trim(),
    password: $("#discount-admin-password").value,
  });
});
$("#discount-auth-modal").addEventListener("close", () => $("#discount-auth-form").reset());

$("#working-hours-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#working-hours-error").textContent = "";
  const hours = Array.from(document.querySelectorAll("[data-working-weekday]:checked")).map((input) => ({
    weekday: Number(input.dataset.workingWeekday),
    start_time: $(`[data-working-start="${input.dataset.workingWeekday}"]`).value,
    end_time: $(`[data-working-end="${input.dataset.workingWeekday}"]`).value,
  }));
  try {
    await api("appointments/hours", {
      method: "PUT",
      body: { barber_id: Number($("#hours-barber").value), hours },
    });
    $("#working-hours-modal").close();
    await renderAppointments();
    showToast("Expediente semanal atualizado.");
  } catch (error) {
    $("#working-hours-error").textContent = error.message;
  }
});

$("#appointment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#appointment-form-error").textContent = "";
  try {
    await api("appointments", {
      method: "POST",
      body: {
        client_id: Number($("#appointment-client").value),
        service_id: Number($("#appointment-service").value),
        barber_id: Number($("#appointment-form-barber").value),
        date: $("#appointment-form-date").value,
        time: $("#appointment-time").value,
        consent: $("#appointment-consent").checked,
      },
    });
    $("#appointment-modal").close();
    $("#appointment-date").value = $("#appointment-form-date").value;
    await renderAppointments();
    showToast("Agendamento criado.");
  } catch (error) {
    $("#appointment-form-error").textContent = error.message;
    await loadAppointmentSlots();
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
    role: $("#user-role").value,
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
  const historyButton = event.target.closest("[data-client-history]");
  if (historyButton) {
    try {
      const { data } = await api(`appointments/${historyButton.dataset.clientHistory}`);
      const labels = { scheduled: "Agendado", completed: "Concluído", cancelled: "Cancelado", no_show: "Faltou" };
      $("#client-history-table").innerHTML = data.map((appointment) => `
        <tr><td>${dateLabel(appointment.start_at)}</td><td>${escapeHtml(appointment.service_name)}</td><td>${escapeHtml(appointment.barber_name)}</td><td>${labels[appointment.status]}</td></tr>
      `).join("");
      $("#client-history-empty").classList.toggle("visible", data.length === 0);
      $("#client-history-modal").showModal();
    } catch (error) {
      showToast(error.message, true);
    }
  } else if (editButton) {
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
  const entryButton = event.target.closest("[data-entry-stock]");
  if (editButton) {
    openProductModal(products.find((product) => product.id === Number(editButton.dataset.editProduct)));
  } else if (entryButton) {
    const product = products.find((item) => item.id === Number(entryButton.dataset.entryStock));
    const quantity = Number(window.prompt(`Quantidade para repor em ${product.name}:`, "1"));
    if (!Number.isSafeInteger(quantity) || quantity < 1) return;
    try {
      await api("stock/entry", {
        method: "POST",
        body: { product_id: product.id, quantity },
      });
      await renderProducts();
      if (can("dashboard.view")) await renderDashboard();
      showToast("Entrada de estoque registrada.");
    } catch (error) {
      showToast(error.message, true);
    }
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

$("#appointments-table").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-appointment-status]");
  if (!button) return;
  const [id, status] = button.dataset.appointmentStatus.split(":");
  try {
    await api(`appointments/${id}`, { method: "PUT", body: { status } });
    await renderAppointments();
    showToast("Agendamento atualizado.");
  } catch (error) {
    showToast(error.message, true);
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
