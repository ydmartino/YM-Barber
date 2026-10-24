const STORAGE_KEY = "navalha-barbearia-v1";
const emptyData = { clients: [], products: [], sales: [] };
let data = loadData();
let toastTimeout;

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const dateLabel = (value) => new Intl.DateTimeFormat("pt-BR").format(new Date(value));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(emptyData);
    const parsed = JSON.parse(saved);
    if (!parsed || !Array.isArray(parsed.clients) || !Array.isArray(parsed.products) || !Array.isArray(parsed.sales)) {
      throw new Error("Os dados salvos estão em um formato inválido.");
    }
    return parsed;
  } catch (error) {
    console.error("Não foi possível carregar os dados da barbearia.", error);
    return structuredClone(emptyData);
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("Não foi possível salvar os dados da barbearia.", error);
    showToast("Não foi possível salvar. Verifique o espaço disponível no navegador.", true);
    return false;
  }
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 3200);
}

function render() {
  renderDashboard();
  renderClients();
  renderProducts();
  renderSaleOptions();
  renderSales();
}

function renderDashboard() {
  const today = new Date().toDateString();
  const todaySales = data.sales.filter((sale) => new Date(sale.date).toDateString() === today);
  $("#stat-today").textContent = money(todaySales.reduce((sum, sale) => sum + sale.total, 0));
  $("#stat-today-count").textContent = `${todaySales.length} ${todaySales.length === 1 ? "venda realizada" : "vendas realizadas"}`;
  $("#stat-clients").textContent = data.clients.length;
  $("#stat-products").textContent = data.products.reduce((sum, product) => sum + product.stock, 0);
  $("#stat-stock").textContent = `${data.products.length} ${data.products.length === 1 ? "produto cadastrado" : "produtos cadastrados"}`;
  const lowStock = data.products.filter((product) => product.stock <= 5).length;
  $("#low-stock-count").textContent = `${lowStock} ${lowStock === 1 ? "produto" : "produtos"}`;
  const recent = data.sales.slice().reverse().slice(0, 5);
  $("#recent-sales").innerHTML = recent.map((sale) => `
    <tr><td class="cell-main">${escapeHtml(sale.clientName)}</td><td>${escapeHtml(sale.productName)}<span class="cell-sub">${sale.quantity} ${sale.quantity === 1 ? "unidade" : "unidades"}</span></td><td>${dateLabel(sale.date)}</td><td class="align-right money">${money(sale.total)}</td></tr>
  `).join("");
  $("#sales-empty").classList.toggle("visible", recent.length === 0);
}

function renderClients() {
  const query = $("#client-search").value.trim().toLocaleLowerCase("pt-BR");
  const clients = data.clients.filter((client) => `${client.name} ${client.phone} ${client.email}`.toLocaleLowerCase("pt-BR").includes(query));
  $("#client-count").textContent = `${data.clients.length} ${data.clients.length === 1 ? "cliente cadastrado" : "clientes cadastrados"}`;
  $("#clients-table").innerHTML = clients.map((client) => `
    <tr><td class="cell-main">${escapeHtml(client.name)}</td><td>${escapeHtml(client.phone)}</td><td>${escapeHtml(client.email || "—")}</td><td>${dateLabel(client.createdAt)}</td><td class="align-right"><button class="row-action" data-edit-client="${escapeHtml(client.id)}" aria-label="Editar ${escapeHtml(client.name)}">Editar</button><button class="row-action" data-delete-client="${escapeHtml(client.id)}" aria-label="Excluir ${escapeHtml(client.name)}">Excluir</button></td></tr>
  `).join("");
  $("#clients-empty").classList.toggle("visible", clients.length === 0);
  $("#clients-empty").querySelector("strong").textContent = data.clients.length && !clients.length ? "Nenhum resultado encontrado" : "Nenhum cliente cadastrado";
}

function renderProducts() {
  const query = $("#product-search").value.trim().toLocaleLowerCase("pt-BR");
  const products = data.products.filter((product) => `${product.name} ${product.category}`.toLocaleLowerCase("pt-BR").includes(query));
  $("#product-count").textContent = `${data.products.length} ${data.products.length === 1 ? "produto cadastrado" : "produtos cadastrados"}`;
  $("#products-table").innerHTML = products.map((product) => {
    const status = product.stock === 0 ? "out" : product.stock <= 5 ? "low" : "";
    const label = product.stock === 0 ? "Esgotado" : product.stock <= 5 ? `${product.stock} em estoque` : `${product.stock} em estoque`;
    return `<tr><td class="cell-main">${escapeHtml(product.name)}</td><td>${escapeHtml(product.category)}</td><td class="money">${money(product.price)}</td><td><span class="status ${status}">${label}</span></td><td class="align-right"><button class="row-action" data-edit-product="${escapeHtml(product.id)}" aria-label="Editar ${escapeHtml(product.name)}">Editar</button><button class="row-action" data-delete-product="${escapeHtml(product.id)}" aria-label="Excluir ${escapeHtml(product.name)}">Excluir</button></td></tr>`;
  }).join("");
  $("#products-empty").classList.toggle("visible", products.length === 0);
  $("#products-empty").querySelector("strong").textContent = data.products.length && !products.length ? "Nenhum resultado encontrado" : "Seu catálogo está vazio";
}

function renderSaleOptions() {
  const clientSelect = $("#sale-client");
  const productSelect = $("#sale-product");
  const selectedClient = clientSelect.value;
  const selectedProduct = productSelect.value;
  clientSelect.innerHTML = `<option value="">Selecione um cliente</option>${data.clients.map((client) => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`).join("")}`;
  productSelect.innerHTML = `<option value="">Selecione um produto</option>${data.products.filter((product) => product.stock > 0).map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} — ${money(product.price)} (${product.stock} em estoque)</option>`).join("")}`;
  clientSelect.value = selectedClient;
  productSelect.value = selectedProduct;
  updateSaleTotal();
}

function renderSales() {
  const rows = data.sales.slice().reverse();
  $("#sales-table").innerHTML = rows.map((sale) => `
    <tr><td class="cell-main">${escapeHtml(sale.clientName)}</td><td>${escapeHtml(sale.productName)}</td><td>${sale.quantity}</td><td>${dateLabel(sale.date)}</td><td class="align-right money">${money(sale.total)}</td></tr>
  `).join("");
  $("#history-empty").classList.toggle("visible", rows.length === 0);
}

function updateSaleTotal() {
  const product = data.products.find((item) => item.id === $("#sale-product").value);
  const quantity = Math.max(1, Number($("#sale-quantity").value) || 1);
  $("#sale-unit-price").textContent = product ? money(product.price) : money(0);
  $("#sale-total").textContent = product ? money(product.price * quantity) : money(0);
}

function openClientModal(client) {
  $("#client-form").reset();
  $("#client-id").value = client?.id || "";
  $("#client-modal-title").textContent = client ? "Editar cliente" : "Novo cliente";
  if (client) {
    $("#client-name").value = client.name;
    $("#client-phone").value = client.phone;
    $("#client-email").value = client.email;
  }
  $("#client-modal").showModal();
}

function openProductModal(product) {
  $("#product-form").reset();
  $("#product-id").value = product?.id || "";
  $("#product-modal-title").textContent = product ? "Editar produto" : "Novo produto";
  if (product) {
    $("#product-name").value = product.name;
    $("#product-category").value = product.category;
    $("#product-price").value = product.price;
    $("#product-stock").value = product.stock;
  }
  $("#product-modal").showModal();
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
$("#client-search").addEventListener("input", renderClients);
$("#product-search").addEventListener("input", renderProducts);
$("#sale-product").addEventListener("change", updateSaleTotal);
$("#sale-quantity").addEventListener("input", updateSaleTotal);

function navigate(view) {
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === `view-${view}`));
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const active = document.querySelector(`.nav-link[data-view="${view}"]`);
  $("#breadcrumb-current").textContent = active.textContent.trim().toLocaleUpperCase("pt-BR");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#client-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = $("#client-id").value;
  const existing = data.clients.find((client) => client.id === id);
  const client = {
    id: id || crypto.randomUUID(),
    name: $("#client-name").value.trim(),
    phone: $("#client-phone").value.trim(),
    email: $("#client-email").value.trim(),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  if (!client.name || !client.phone) return;
  if (existing) data.clients = data.clients.map((item) => item.id === id ? client : item);
  else data.clients.push(client);
  if (!saveData()) return;
  $("#client-modal").close();
  render();
  showToast(existing ? "Cliente atualizado com sucesso." : "Cliente cadastrado com sucesso.");
});

$("#product-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = $("#product-id").value;
  const existing = data.products.find((product) => product.id === id);
  const product = {
    id: id || crypto.randomUUID(),
    name: $("#product-name").value.trim(),
    category: $("#product-category").value.trim(),
    price: Number($("#product-price").value),
    stock: Number($("#product-stock").value),
  };
  if (!product.name || !product.category || !Number.isFinite(product.price) || product.price <= 0 || !Number.isInteger(product.stock) || product.stock < 0) {
    showToast("Informe um preço maior que zero e um estoque válido.", true);
    return;
  }
  if (existing) data.products = data.products.map((item) => item.id === id ? product : item);
  else data.products.push(product);
  if (!saveData()) return;
  $("#product-modal").close();
  render();
  showToast(existing ? "Produto atualizado com sucesso." : "Produto cadastrado com sucesso.");
});

$("#sale-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const client = data.clients.find((item) => item.id === $("#sale-client").value);
  const product = data.products.find((item) => item.id === $("#sale-product").value);
  const quantity = Number($("#sale-quantity").value);
  if (!client || !product || !Number.isInteger(quantity) || quantity < 1) {
    showToast("Selecione um cliente, produto e quantidade válida.", true);
    return;
  }
  if (quantity > product.stock) {
    showToast("Estoque insuficiente para essa quantidade.", true);
    return;
  }
  const previousData = JSON.stringify(data);
  product.stock -= quantity;
  data.sales.push({
    id: crypto.randomUUID(),
    clientId: client.id,
    clientName: client.name,
    productId: product.id,
    productName: product.name,
    quantity,
    unitPrice: product.price,
    total: product.price * quantity,
    date: new Date().toISOString(),
  });
  if (!saveData()) {
    data = JSON.parse(previousData);
    return;
  }
  $("#sale-form").reset();
  $("#sale-quantity").value = "1";
  render();
  showToast("Venda registrada e estoque atualizado.");
});

$("#clients-table").addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-client]");
  const deleteButton = event.target.closest("[data-delete-client]");
  if (editButton) {
    openClientModal(data.clients.find((client) => client.id === editButton.dataset.editClient));
  } else if (deleteButton) {
    const client = data.clients.find((item) => item.id === deleteButton.dataset.deleteClient);
    if (client && window.confirm(`Excluir ${client.name} da lista de clientes? O histórico de vendas será mantido.`)) {
      data.clients = data.clients.filter((item) => item.id !== client.id);
      if (saveData()) { render(); showToast("Cliente excluído."); }
    }
  }
});

$("#products-table").addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-product]");
  const deleteButton = event.target.closest("[data-delete-product]");
  if (editButton) {
    openProductModal(data.products.find((product) => product.id === editButton.dataset.editProduct));
  } else if (deleteButton) {
    const product = data.products.find((item) => item.id === deleteButton.dataset.deleteProduct);
    if (product && window.confirm(`Excluir ${product.name} do catálogo? O histórico de vendas será mantido.`)) {
      data.products = data.products.filter((item) => item.id !== product.id);
      if (saveData()) { render(); showToast("Produto excluído."); }
    }
  }
});

$("#today-label").textContent = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date());
render();
