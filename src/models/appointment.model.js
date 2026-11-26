"use strict";

const crypto = require("node:crypto");
const { pool, transaction } = require("./database.model");
const { fail } = require("./errors");

const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || "America/Sao_Paulo";
const zonedDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(date) {
  return Object.fromEntries(zonedDateTime.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
}

function localDate(value = new Date()) {
  const parts = zonedParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localTime(value = new Date()) {
  const parts = zonedParts(value);
  return `${parts.hour}:${parts.minute}`;
}

function localDateTimeToUtc(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes, seconds = 0] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  let timestamp = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(timestamp));
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const adjusted = desired - (represented - timestamp);
    if (adjusted === timestamp) break;
    timestamp = adjusted;
  }
  return new Date(timestamp).toISOString().slice(0, 19).replace("T", " ");
}

function utcDateTimeToLocal(value) {
  const date = value instanceof Date
    ? value
    : new Date(`${String(value).replace(" ", "T")}Z`);
  const parts = zonedParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function nextDate(date) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + 1);
  return result.toISOString().slice(0, 10);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isoWeekday(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day || 7;
}

function asDateTime(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace("T", " ");
  return String(value).replace("T", " ").slice(0, 19);
}

function minutesOfDay(value) {
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
}

function addMinutes(date, time, duration) {
  const total = minutesOfDay(time) + duration;
  const dayOffset = Math.floor(total / 1440);
  const dateValue = new Date(`${date}T00:00:00Z`);
  dateValue.setUTCDate(dateValue.getUTCDate() + dayOffset);
  const hours = String(Math.floor((total % 1440) / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${dateValue.toISOString().slice(0, 10)} ${hours}:${minutes}:00`;
}

function validateBookingDate(date) {
  if (!validDate(date)) fail(422, "Informe uma data válida.");
  const today = localDate();
  const latest = new Date(`${today}T00:00:00Z`);
  latest.setUTCDate(latest.getUTCDate() + 90);
  if (date < today || date > latest.toISOString().slice(0, 10)) {
    fail(422, "A agenda permite reservas de hoje até os próximos 90 dias.");
  }
}

async function findService(connection, serviceId) {
  const [rows] = await connection.execute(
    `SELECT id, name, price, duration_minutes
     FROM products WHERE id = ? AND is_active = 1 AND item_type = 'S'`,
    [serviceId]
  );
  if (!rows.length) fail(422, "O serviço selecionado não está disponível.");
  return rows[0];
}

async function findBarber(connection, barberId, lock = false) {
  const [rows] = await connection.execute(
    `SELECT id, name FROM users
     WHERE id = ? AND role = 'barber' AND is_active = 1${lock ? " FOR UPDATE" : ""}`,
    [barberId]
  );
  if (!rows.length) fail(422, "O barbeiro selecionado não está disponível.");
  return rows[0];
}

async function getFreeSlots(connection, { date, barberId, serviceId, lockAppointments = false }) {
  validateBookingDate(date);
  const barber = await findBarber(connection, barberId);
  const service = await findService(connection, serviceId);
  const [hours] = await connection.execute(
    "SELECT start_time, end_time FROM working_hours WHERE barber_id = ? AND weekday = ?",
    [barberId, isoWeekday(date)]
  );
  if (!hours.length) return { barber, service, slots: [] };
  const dateStartUtc = localDateTimeToUtc(date, "00:00:00");
  const nextDateStartUtc = localDateTimeToUtc(nextDate(date), "00:00:00");
  const [booked] = await connection.execute(
    `SELECT start_at, end_at FROM appointments
     WHERE barber_id = ? AND status = 'scheduled'
       AND start_at < ? AND end_at > ?${lockAppointments ? " FOR UPDATE" : ""}`,
    [barberId, nextDateStartUtc, dateStartUtc]
  );
  const opening = minutesOfDay(hours[0].start_time);
  const closing = minutesOfDay(hours[0].end_time);
  const duration = Number(service.duration_minutes);
  const occupied = booked.map((appointment) => ({
    start: asDateTime(appointment.start_at),
    end: asDateTime(appointment.end_at),
  }));
  const slots = [];
  const now = new Date();
  const today = localDate(now);
  const currentMinute = minutesOfDay(localTime(now));
  for (let start = opening; start + duration <= closing; start += 15) {
    if (date === today && start <= currentMinute) continue;
    const time = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
    const localStart = `${date} ${time}:00`;
    const localEnd = addMinutes(date, time, duration);
    const startAt = localDateTimeToUtc(date, `${time}:00`);
    const endAt = localDateTimeToUtc(localEnd.slice(0, 10), localEnd.slice(11));
    if (occupied.some((range) => range.start < endAt && range.end > startAt)) continue;
    slots.push({ start_at: startAt, end_at: endAt, local_start_at: localStart, time });
  }
  return { barber, service, slots };
}

async function listServices() {
  const [rows] = await pool.query(
    `SELECT id, name, price, duration_minutes FROM products
     WHERE is_active = 1 AND item_type = 'S' ORDER BY name`
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), price: Number(row.price) }));
}

async function listBarbers() {
  const [rows] = await pool.query(
    `SELECT id, name FROM users
     WHERE role = 'barber' AND is_active = 1 ORDER BY name`
  );
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

async function availability(input) {
  const date = input.date;
  const barberId = Number(input.barber_id);
  const serviceId = Number(input.service_id);
  if (!Number.isSafeInteger(barberId) || barberId < 1 ||
      !Number.isSafeInteger(serviceId) || serviceId < 1) {
    fail(422, "Selecione um serviço e um barbeiro válidos.");
  }
  return getFreeSlots(pool, { date, barberId, serviceId });
}

async function createPublic({ name, phone, email, consent, date, time, barberId, serviceId }) {
  if (consent !== true) fail(422, "O consentimento para o tratamento dos dados é obrigatório.");
  const normalizedName = String(name || "").trim();
  const normalizedPhone = String(phone || "").trim();
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (!normalizedName || [...normalizedName].length > 120 ||
      !normalizedPhone || [...normalizedPhone].length > 30) {
    fail(422, "Informe nome e telefone válidos.");
  }
  if (normalizedEmail && (normalizedEmail.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) {
    fail(422, "Informe um e-mail válido.");
  }
  if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    fail(422, "Selecione um horário válido.");
  }
  validateBookingDate(date);

  return transaction(async (connection) => {
    const barber = await findBarber(connection, Number(barberId), true);
    const service = await findService(connection, Number(serviceId));
    const [existingClients] = await connection.execute(
      "SELECT id, consent_at FROM clients WHERE phone = ? ORDER BY id LIMIT 2 FOR UPDATE",
      [normalizedPhone]
    );
    if (existingClients.length > 1) {
      fail(409, "Não foi possível identificar este telefone. Entre em contato com a recepção.");
    }

    let clientId;
    if (existingClients.length) {
      clientId = existingClients[0].id;
      if (!existingClients[0].consent_at) {
        await connection.execute(
          "UPDATE clients SET consent_at = UTC_TIMESTAMP() WHERE id = ?",
          [clientId]
        );
      }
    } else {
      const [client] = await connection.execute(
        "INSERT INTO clients (name, phone, email, consent_at) VALUES (?, ?, ?, UTC_TIMESTAMP())",
        [normalizedName, normalizedPhone, normalizedEmail]
      );
      clientId = client.insertId;
    }

    const [misses] = await connection.execute(
      `SELECT COUNT(*) AS count FROM appointments
       WHERE client_id = ? AND status = 'no_show'
         AND start_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 DAY)`,
      [clientId]
    );
    if (Number(misses[0].count) >= 2) {
      fail(403, "Para realizar uma nova reserva, entre em contato com a recepção.");
    }

    const schedule = await getFreeSlots(connection, {
      date,
      barberId: Number(barberId),
      serviceId: Number(serviceId),
      lockAppointments: true,
    });
    const slot = schedule.slots.find((item) => item.time === time);
    if (!slot) fail(409, "Este horário não está mais disponível. Atualize os horários e escolha outro.");

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const localEnd = addMinutes(date, time, Number(service.duration_minutes));
    const endAt = localDateTimeToUtc(localEnd.slice(0, 10), localEnd.slice(11));
    const [appointment] = await connection.execute(
      `INSERT INTO appointments
       (client_id, barber_id, service_id, start_at, end_at, cancellation_token_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [clientId, barber.id, service.id, slot.start_at, endAt, tokenHash]
    );
    return {
      id: Number(appointment.insertId),
      cancellation_token: token,
      start_at: slot.local_start_at,
      service_name: service.name,
      barber_name: barber.name,
    };
  });
}

async function createStaff({ clientId, barberId, serviceId, date, time, consent, userId }) {
  if (!Number.isSafeInteger(clientId) || clientId < 1 ||
      !Number.isSafeInteger(barberId) || barberId < 1 ||
      !Number.isSafeInteger(serviceId) || serviceId < 1) {
    fail(422, "Selecione cliente, barbeiro e serviço válidos.");
  }
  if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    fail(422, "Selecione um horário válido.");
  }
  validateBookingDate(date);

  return transaction(async (connection) => {
    const barber = await findBarber(connection, barberId, true);
    const service = await findService(connection, serviceId);
    const [clients] = await connection.execute(
      "SELECT id, consent_at FROM clients WHERE id = ? FOR UPDATE",
      [clientId]
    );
    if (!clients.length) fail(422, "O cliente selecionado não existe.");
    if (!clients[0].consent_at) {
      if (consent !== true) {
        fail(422, "Confirme o consentimento do cliente antes de marcar o horário.");
      }
      await connection.execute(
        "UPDATE clients SET consent_at = UTC_TIMESTAMP() WHERE id = ?",
        [clientId]
      );
    }
    const schedule = await getFreeSlots(connection, {
      date,
      barberId,
      serviceId,
      lockAppointments: true,
    });
    const slot = schedule.slots.find((item) => item.time === time);
    if (!slot) fail(409, "Este horário não está mais disponível. Atualize os horários e escolha outro.");
    const localEnd = addMinutes(date, time, Number(service.duration_minutes));
    const endAt = localDateTimeToUtc(localEnd.slice(0, 10), localEnd.slice(11));
    const [appointment] = await connection.execute(
      `INSERT INTO appointments
       (client_id, barber_id, service_id, start_at, end_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [clientId, barber.id, service.id, slot.start_at, endAt, userId]
    );
    return {
      id: Number(appointment.insertId),
      start_at: slot.local_start_at,
      service_name: service.name,
      barber_name: barber.name,
    };
  });
}

async function cancelPublic(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    fail(422, "O código de cancelamento é inválido.");
  }
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const [result] = await pool.execute(
    `UPDATE appointments SET status = 'cancelled', cancellation_token_hash = NULL
     WHERE cancellation_token_hash = ? AND status = 'scheduled'
       AND start_at >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR)`,
    [hash]
  );
  if (!result.affectedRows) fail(409, "O agendamento não existe, já foi cancelado ou está a menos de 2 horas do início.");
  return { cancelled: true };
}

async function listDay(date, requestedBarberId, user) {
  if (!validDate(date)) fail(422, "Informe uma data válida.");
  const barberId = user.role === "barber" ? user.id : requestedBarberId ? Number(requestedBarberId) : null;
  if (user.role === "barber" && requestedBarberId && Number(requestedBarberId) !== user.id) {
    fail(403, "Barbeiros só podem consultar a própria agenda.");
  }
  if (barberId !== null && (!Number.isSafeInteger(barberId) || barberId < 1)) {
    fail(422, "Barbeiro inválido.");
  }
  const barberCondition = barberId ? " AND a.barber_id = ?" : "";
  const [rows] = await pool.execute(
    `SELECT a.id, a.client_id, a.barber_id, a.service_id, a.start_at, a.end_at, a.status,
            c.name AS client_name, c.phone AS client_phone,
            p.name AS service_name, u.name AS barber_name,
            COALESCE(no_shows.count, 0) AS recent_no_shows
     FROM appointments a
     INNER JOIN clients c ON c.id = a.client_id
     INNER JOIN products p ON p.id = a.service_id
     INNER JOIN users u ON u.id = a.barber_id
     LEFT JOIN (
       SELECT client_id, COUNT(*) AS count FROM appointments
       WHERE status = 'no_show' AND start_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 DAY)
       GROUP BY client_id
     ) no_shows ON no_shows.client_id = a.client_id
     WHERE a.start_at >= ? AND a.start_at < ?${barberCondition}
     ORDER BY a.start_at`,
    [
      localDateTimeToUtc(date, "00:00:00"),
      localDateTimeToUtc(nextDate(date), "00:00:00"),
      ...(barberId ? [barberId] : []),
    ]
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    client_id: Number(row.client_id),
    barber_id: Number(row.barber_id),
    service_id: Number(row.service_id),
    recent_no_shows: Number(row.recent_no_shows),
    risk_high: Number(row.recent_no_shows) > 0,
    start_at: utcDateTimeToLocal(row.start_at),
    end_at: utcDateTimeToLocal(row.end_at),
  }));
}

async function clientHistory(clientId) {
  const [rows] = await pool.execute(
    `SELECT a.id, a.start_at, a.end_at, a.status, p.name AS service_name,
            u.name AS barber_name
     FROM appointments a
     INNER JOIN products p ON p.id = a.service_id
     INNER JOIN users u ON u.id = a.barber_id
     WHERE a.client_id = ? ORDER BY a.start_at DESC LIMIT 100`,
    [clientId]
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    start_at: utcDateTimeToLocal(row.start_at),
    end_at: utcDateTimeToLocal(row.end_at),
  }));
}

async function updateStatus(id, status, user) {
  if (!["completed", "cancelled", "no_show"].includes(status)) {
    fail(422, "Informe um status válido para o agendamento.");
  }
  const conditions = ["id = ?", "status = 'scheduled'"];
  const values = [status, id];
  if (user.role === "barber") {
    conditions.push("barber_id = ?");
    values.push(user.id);
  }
  if (status === "cancelled") {
    conditions.push("start_at >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR)");
  }
  if (status === "no_show") conditions.push("start_at <= UTC_TIMESTAMP()");
  const [result] = await pool.execute(
    `UPDATE appointments SET status = ?, cancellation_token_hash = NULL WHERE ${conditions.join(" AND ")}`,
    values
  );
  if (!result.affectedRows) {
    if (status === "cancelled") fail(409, "O cancelamento só é permitido até 2 horas antes do horário.");
    if (status === "no_show") fail(409, "A falta só pode ser registrada após o horário do agendamento.");
    fail(404, "Agendamento não encontrado ou já atualizado.");
  }
  return { updated: true };
}

async function listWorkingHours(barberId) {
  const id = Number(barberId);
  if (!Number.isSafeInteger(id) || id < 1) fail(422, "Barbeiro inválido.");
  const [rows] = await pool.execute(
    "SELECT weekday, start_time, end_time FROM working_hours WHERE barber_id = ? ORDER BY weekday",
    [id]
  );
  return rows;
}

async function saveWorkingHours(barberId, hours) {
  const id = Number(barberId);
  if (!Number.isSafeInteger(id) || id < 1 || !Array.isArray(hours) || hours.length > 7) {
    fail(422, "A agenda semanal informada é inválida.");
  }
  const normalized = hours.map((entry) => {
    const weekday = Number(entry.weekday);
    const start = entry.start_time;
    const end = entry.end_time;
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 ||
        typeof start !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
        typeof end !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
        start >= end) {
      fail(422, "Cada expediente precisa de dia, início e fim válidos.");
    }
    return { weekday, start, end };
  });
  if (new Set(normalized.map((entry) => entry.weekday)).size !== normalized.length) {
    fail(422, "Não repita dias da semana no expediente.");
  }
  return transaction(async (connection) => {
    await findBarber(connection, id, true);
    const [appointments] = await connection.execute(
      `SELECT start_at, end_at
       FROM appointments WHERE barber_id = ? AND status = 'scheduled' AND start_at >= UTC_TIMESTAMP()`,
      [id]
    );
    for (const appointment of appointments) {
      const localStart = utcDateTimeToLocal(appointment.start_at);
      const localEnd = utcDateTimeToLocal(appointment.end_at);
      const weekday = isoWeekday(localStart.slice(0, 10));
      const newHours = normalized.find((entry) => entry.weekday === weekday);
      const start = localStart.slice(11, 16);
      const end = localEnd.slice(11, 16);
      if (!newHours || start < newHours.start || end > newHours.end) {
        fail(409, "O expediente não pode ser alterado enquanto houver agendamentos fora do novo horário.");
      }
    }
    await connection.execute("DELETE FROM working_hours WHERE barber_id = ?", [id]);
    for (const entry of normalized) {
      await connection.execute(
        "INSERT INTO working_hours (barber_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)",
        [id, entry.weekday, entry.start, entry.end]
      );
    }
    return { updated: true };
  });
}

module.exports = {
  availability,
  cancelPublic,
  clientHistory,
  createPublic,
  createStaff,
  listBarbers,
  listDay,
  listServices,
  listWorkingHours,
  saveWorkingHours,
  updateStatus,
  validDate,
  addMinutes,
  isoWeekday,
  localDateTimeToUtc,
  utcDateTimeToLocal,
};
