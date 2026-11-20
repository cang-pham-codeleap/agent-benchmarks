"use strict";
const orders = require("./domain/orders");

function createApp(dir) {
  return {
    placeOrder: (input) => orders.placeOrder(dir, input),
    applyDiscount: (id, percent) => orders.applyDiscount(dir, id, percent),
    total: (id) => orders.total(dir, id),
    get: (id) => orders.get(dir, id),
  };
}

module.exports = { createApp };
