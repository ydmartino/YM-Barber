import { api } from "../models/api.model.js";

const $ = (selector) => document.querySelector(selector);
const form = $("#booking-form");
const dateInput = $("#booking-date");
const serviceSelect = $("#booking-service");
const barberSelect = $("#booking-barber");
const timeSelect = $("#booking-time");
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function dateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setDefaultDate() {
  const today = new Date();
  const maximum = new Date(today);
  maximum.setDate(maximum.getDate() + 90);
  dateInput.min = dateValue(today);
  dateInput.max = dateValue(maximum);
  dateInput.value = dateInput.min;
}

async function loadAvailability() {
  timeSelect.disabled = true;
  timeSelect.innerHTML = '<option value="">Consultando horários…</option>';
  if (!serviceSelect.value || !barberSelect.value || !dateInput.value) {
    timeSelect.innerHTML = '<option value="">Selecione serviço, barbeiro e data</option>';
    return;
  }
  try {
    const result = await api("booking/availability", {
      query: {
        service_id: serviceSelect.value,
        barber_id: barberSelect.value,
        date: dateInput.value,
      },
    });
    timeSelect.innerHTML = result.slots.length
      ? `<option value="">Selecione um horário</option>${result.slots.map((slot) => `<option value="${slot.time}">${slot.time}</option>`).join("")}`
      : '<option value="">Não há horários livres nesta data</option>';
    timeSelect.disabled = result.slots.length === 0;
  } catch (error) {
    timeSelect.innerHTML = '<option value="">Não foi possível carregar os horários</option>';
    $("#booking-error").textContent = error.message;
  }
}

async function initialize() {
  setDefaultDate();
  try {
    const [services, barbers] = await Promise.all([
      api("booking/services"),
      api("booking/barbers"),
    ]);
    serviceSelect.innerHTML = `<option value="">Selecione um serviço</option>${services.map((service) => `<option value="${service.id}">${escapeHtml(service.name)} — ${service.duration_minutes} min</option>`).join("")}`;
    barberSelect.innerHTML = `<option value="">Selecione um barbeiro</option>${barbers.map((barber) => `<option value="${barber.id}">${escapeHtml(barber.name)}</option>`).join("")}`;
    if (!services.length || !barbers.length) {
      $("#booking-error").textContent = "No momento não há serviços ou barbeiros disponíveis para agendamento.";
    }
  } catch (error) {
    $("#booking-error").textContent = error.message;
  }
}

for (const input of [serviceSelect, barberSelect, dateInput]) {
  input.addEventListener("change", () => loadAvailability());
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#booking-error").textContent = "";
  const button = $("#booking-submit");
  button.disabled = true;
  const data = new FormData(form);
  try {
    const result = await api("booking", {
      method: "POST",
      body: {
        name: data.get("name"),
        phone: data.get("phone"),
        email: data.get("email"),
        consent: data.get("consent") === "on",
        service_id: Number(data.get("service_id")),
        barber_id: Number(data.get("barber_id")),
        date: data.get("date"),
        time: data.get("time"),
      },
    });
    $("#booking-success-detail").textContent =
      `${result.service_name} com ${result.barber_name} em ${result.start_at}.`;
    $("#booking-token").textContent = result.cancellation_token;
    $("#booking-success").hidden = false;
    form.reset();
    setDefaultDate();
    await loadAvailability();
    $("#booking-success").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    $("#booking-error").textContent = error.message;
    await loadAvailability();
  } finally {
    button.disabled = false;
  }
});

$("#cancel-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#cancel-error").textContent = "";
  const token = new FormData(event.currentTarget).get("cancellation_token");
  try {
    await api("booking/cancel", { method: "POST", body: { cancellation_token: token } });
    event.currentTarget.reset();
    $("#cancel-error").textContent = "Agendamento cancelado com sucesso.";
  } catch (error) {
    $("#cancel-error").textContent = error.message;
  }
});

initialize();
