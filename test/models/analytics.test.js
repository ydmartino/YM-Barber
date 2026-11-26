"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { clusterClients } = require("../../src/models/analytics.model");

test("K-means assigns every client to one of at most three segments", () => {
  const segments = clusterClients([
    { sale_count: 1, revenue: 30, no_show_count: 0 },
    { sale_count: 2, revenue: 70, no_show_count: 0 },
    { sale_count: 3, revenue: 120, no_show_count: 1 },
    { sale_count: 12, revenue: 900, no_show_count: 0 },
    { sale_count: 18, revenue: 1500, no_show_count: 0 },
  ]);
  assert.equal(segments.reduce((total, segment) => total + segment.client_count, 0), 5);
  assert.ok(segments.length <= 3);
  assert.equal(clusterClients([]).length, 0);
});
