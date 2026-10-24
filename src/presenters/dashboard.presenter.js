"use strict";

const dashboardModel = require("../models/dashboard.model");
const authPresenter = require("./auth.presenter");

async function getSummary(user) {
  authPresenter.requirePermission(user, "dashboard.view");
  return dashboardModel.getSummary({
    includeSales: authPresenter.can(user, "sales.view"),
  });
}

module.exports = { getSummary };
