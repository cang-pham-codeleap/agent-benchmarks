"use strict";
const { createUsersModule } = require("./users");
const { createOrdersModule } = require("./orders");
const { createBillingModule } = require("./billing");

function createIds() {
  const counters = {};
  return { next: (prefix) => `${prefix}-${(counters[prefix] = (counters[prefix] || 0) + 1)}` };
}

// Composition root: all state lives in the modules created here.
function createApp({ clock = { now: () => Date.now() }, ids = createIds() } = {}) {
  const users = createUsersModule({ clock, ids });
  const orders = createOrdersModule({ clock, ids, users });
  const billing = createBillingModule({ clock, ids, users, orders });
  return {
    signup(input) {
      const user = users.signup(input);
      billing.startSubscription(user.id);
      return user;
    },
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
