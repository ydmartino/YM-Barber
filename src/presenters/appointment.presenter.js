"use strict";

const appointmentModel = require("../models/appointment.model");
const authPresenter = require("./auth.presenter");
const { fail, positiveInteger } = require("../models/errors");

async function handlePublic({ method, id, body, url }) {
  if (method === "GET" && id === "services") return appointmentModel.listServices();
  if (method === "GET" && id === "barbers") return appointmentModel.listBarbers();
  if (method === "GET" && id === "availability") {
    return appointmentModel.availability({
      date: url.searchParams.get("date"),
      barber_id: url.searchParams.get("barber_id"),
      service_id: url.searchParams.get("service_id"),
    });
  }
  if (method === "POST" && !id) {
    return appointmentModel.createPublic({
      name: body.name,
      phone: body.phone,
      email: body.email,
      consent: body.consent,
      date: body.date,
      time: body.time,
      barberId: positiveInteger(body.barber_id, "Selecione um barbeiro válido."),
      serviceId: positiveInteger(body.service_id, "Selecione um serviço válido."),
    });
  }
  if (method === "POST" && id === "cancel") {
    return appointmentModel.cancelPublic(body.cancellation_token);
  }
  fail(405, "Método não permitido.");
}

async function handle({ user, method, id, body, url }) {
  if (method === "GET" && !id) {
    authPresenter.requirePermission(user, "appointments.view");
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    return appointmentModel.listDay(date, url.searchParams.get("barber_id"), user);
  }
  if (method === "GET" && id === "hours") {
    authPresenter.requirePermission(user, "appointments.view");
    const barberId = user.role === "barber"
      ? user.id
      : positiveInteger(url.searchParams.get("barber_id"), "Selecione um barbeiro.");
    if (user.role === "barber" && url.searchParams.has("barber_id") &&
        Number(url.searchParams.get("barber_id")) !== user.id) {
      fail(403, "Barbeiros só podem consultar o próprio expediente.");
    }
    return appointmentModel.listWorkingHours(barberId);
  }
  if (method === "GET" && id) {
    authPresenter.requireAnyPermission(user, ["appointments.view", "clients.view"]);
    return appointmentModel.clientHistory(positiveInteger(id, "Cliente não encontrado."));
  }
  if (method === "PUT" && id === "hours") {
    authPresenter.requirePermission(user, "appointments.manage");
    const barberId = positiveInteger(body.barber_id, "Selecione um barbeiro.");
    if (user.role === "barber" && barberId !== user.id) {
      fail(403, "Barbeiros só podem alterar o próprio expediente.");
    }
    return appointmentModel.saveWorkingHours(
      barberId,
      body.hours
    );
  }
  if (method === "POST" && !id) {
    authPresenter.requirePermission(user, "appointments.manage");
    const barberId = positiveInteger(body.barber_id, "Selecione um barbeiro válido.");
    if (user.role === "barber" && barberId !== user.id) {
      fail(403, "Barbeiros só podem criar agendamentos para a própria agenda.");
    }
    return appointmentModel.createStaff({
      clientId: positiveInteger(body.client_id, "Selecione um cliente válido."),
      barberId,
      serviceId: positiveInteger(body.service_id, "Selecione um serviço válido."),
      date: body.date,
      time: body.time,
      consent: body.consent,
      userId: user.id,
    });
  }
  if (method === "PUT" && id) {
    authPresenter.requirePermission(user, "appointments.manage");
    return appointmentModel.updateStatus(
      positiveInteger(id, "Agendamento não encontrado."),
      body.status,
      user
    );
  }
  fail(405, "Método não permitido.");
}

module.exports = { handle, handlePublic };
