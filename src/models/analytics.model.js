"use strict";

const { pool } = require("./database.model");

const SEGMENT_NAMES = ["Clientes VIP", "Clientes recorrentes", "Clientes ocasionais"];

function clusterClients(records, clusterCount = 3) {
  if (!records.length) return [];
  const count = Math.min(clusterCount, records.length);
  const features = records.map((record) => [
    Number(record.sale_count),
    Number(record.revenue),
    Number(record.no_show_count),
  ]);
  const scales = features[0].map((_, index) =>
    features.reduce((maximum, feature) => Math.max(maximum, feature[index]), 1)
  );
  const normalized = features.map((feature) => feature.map((value, index) => value / scales[index]));
  const revenueOrder = normalized.map((feature, index) => ({ index, revenue: feature[1] }))
    .sort((left, right) => left.revenue - right.revenue);
  let centers = Array.from({ length: count }, (_, cluster) => {
    const position = Math.round(cluster * (revenueOrder.length - 1) / Math.max(1, count - 1));
    return [...normalized[revenueOrder[position].index]];
  });
  let assignments = Array(records.length).fill(-1);

  for (let iteration = 0; iteration < 25; iteration += 1) {
    const nextAssignments = normalized.map((feature) => {
      let nearest = 0;
      let nearestDistance = Infinity;
      centers.forEach((center, index) => {
        const distance = feature.reduce((sum, value, axis) => sum + (value - center[axis]) ** 2, 0);
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      });
      return nearest;
    });
    const nextCenters = centers.map((center, index) => {
      const members = normalized.filter((_, position) => nextAssignments[position] === index);
      if (!members.length) return center;
      return center.map((_, axis) =>
        members.reduce((sum, member) => sum + member[axis], 0) / members.length
      );
    });
    if (nextAssignments.every((assignment, index) => assignment === assignments[index])) {
      assignments = nextAssignments;
      centers = nextCenters;
      break;
    }
    assignments = nextAssignments;
    centers = nextCenters;
  }

  const rankedClusters = centers.map((center, index) => ({ index, value: center[1] + center[0] }))
    .sort((left, right) => right.value - left.value);
  const labelByCluster = new Map(rankedClusters.map((cluster, rank) => [
    cluster.index,
    SEGMENT_NAMES[rank] || `Grupo ${rank + 1}`,
  ]));
  const counts = new Map();
  for (const assignment of assignments) {
    const label = labelByCluster.get(assignment);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].map(([label, client_count]) => ({ label, client_count }));
}

async function getClientSegments() {
  const [records] = await pool.query(
    `SELECT c.id, COALESCE(s.sale_count, 0) AS sale_count,
            COALESCE(s.revenue, 0) AS revenue,
            COALESCE(a.no_show_count, 0) AS no_show_count
     FROM clients c
     LEFT JOIN (
       SELECT client_id, COUNT(*) AS sale_count, SUM(total) AS revenue
       FROM sales WHERE status = 'completed' GROUP BY client_id
     ) s ON s.client_id = c.id
     LEFT JOIN (
       SELECT client_id, COUNT(*) AS no_show_count
       FROM appointments
       WHERE status = 'no_show' AND start_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 DAY)
       GROUP BY client_id
     ) a ON a.client_id = c.id`
  );
  return clusterClients(records);
}

module.exports = { clusterClients, getClientSegments };
