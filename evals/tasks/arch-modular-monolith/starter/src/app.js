"use strict";
const db = require("./shared/db");
const users = require("./users/service");
const orders = require("./orders/service");
const billing = require("./billing/service");

function createIds() {
  const counters = {};
  return { next: (prefix) => `${prefix}-${(counters[prefix] = (counters[prefix] || 0) + 1)}` };
}

// "Wiring" is just pointing the global store at this app's clock and ids.
function createApp({ clock = { now: () => Date.now() }, ids = createIds() } = {}) {
  db.reset();
  db.clock = clock;
  db.ids = ids;
  return {
    signup: users.signup,
    getUser: users.get,
    upgradePlan: billing.upgrade,
    placeOrder: orders.place,
    getOrder: orders.get,
    listOrders: orders.listByUser,
    cancelOrder: orders.cancel,
    creditStatus: orders.creditStatus,
    generateInvoice: billing.generateInvoice,
    payInvoice: billing.payInvoice,
    getInvoice: billing.getInvoice,
    listInvoices: billing.listInvoices,
  };
}

module.exports = { createApp };
