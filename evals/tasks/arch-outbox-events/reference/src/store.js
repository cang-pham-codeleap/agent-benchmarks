"use strict";
// In-memory stand-in for a database. Do not change its contract.
function createStore() {
  const orders = new Map();
  const events = new Map();
  return {
    // Atomic: validates everything first, then applies; throws and applies
    // nothing if any order or event id already exists.
    commit({ orders: newOrders = [], events: newEvents = [] } = {}) {
      const seenO = new Set();
      const seenE = new Set();
      for (const o of newOrders) {
        if (orders.has(o.id) || seenO.has(o.id)) throw new Error("duplicate order " + o.id);
        seenO.add(o.id);
      }
      for (const e of newEvents) {
        if (events.has(e.id) || seenE.has(e.id)) throw new Error("duplicate event " + e.id);
        seenE.add(e.id);
      }
      for (const o of newOrders) orders.set(o.id, structuredClone(o));
      for (const e of newEvents) events.set(e.id, structuredClone(e));
    },
    getOrder(id) {
      return orders.has(id) ? structuredClone(orders.get(id)) : null;
    },
    countOrders() {
      return orders.size;
    },
    getEvent(id) {
      return events.has(id) ? structuredClone(events.get(id)) : null;
    },
    // Events in insertion order.
    listEvents() {
      return [...events.values()].map((e) => structuredClone(e));
    },
    // Shallow-merges `patch` into the stored event.
    updateEvent(id, patch) {
      if (!events.has(id)) throw new Error("unknown event " + id);
      events.set(id, { ...events.get(id), ...structuredClone(patch) });
    },
  };
}
module.exports = { createStore };
