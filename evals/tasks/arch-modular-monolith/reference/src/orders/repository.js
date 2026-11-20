"use strict";

function createOrderRepository() {
  const byId = new Map();
  return {
    insert: (order) => void byId.set(order.id, order),
    get: (id) => byId.get(id) || null,
    forUser: (userId) => [...byId.values()].filter((o) => o.userId === userId),
  };
}

module.exports = { createOrderRepository };
