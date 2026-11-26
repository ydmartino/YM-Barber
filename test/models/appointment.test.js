"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addMinutes,
  isoWeekday,
  localDateTimeToUtc,
  utcDateTimeToLocal,
  validDate,
} = require("../../src/models/appointment.model");

test("appointment dates are validated and use ISO weekdays", () => {
  assert.equal(validDate("2026-11-17"), true);
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(isoWeekday("2026-11-17"), 2);
});

test("appointment times preserve local business time in UTC storage", () => {
  const utc = localDateTimeToUtc("2026-11-17", "09:15:00");
  assert.equal(utcDateTimeToLocal(utc), "2026-11-17 09:15:00");
  assert.equal(addMinutes("2026-11-17", "09:15", 45), "2026-11-17 10:00:00");
});
