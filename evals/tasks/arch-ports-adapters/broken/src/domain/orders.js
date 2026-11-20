"use strict";
const path = require("node:path");

function createOrderService({ repository, clock }) {
  function need(id) {
    const order = repository.get(path.basename(id));
    if (!order) throw new Error("unknown order " + id);
    return order;
  }

  return {
    placeOrder({ customer, items }) {
      if (typeof customer !== "string" || customer === "") throw new Error("bad customer");
      if (!Array.isArray(items) || items.length === 0) throw new Error("bad items");
      for (const it of items) {
        if (!it || typeof it.sku !== "string" || it.sku === "") throw new Error("bad sku");
        if (!Number.isInteger(it.qty) || it.qty < 1) throw new Error("bad qty");
        if (!Number.isInteger(it.price) || it.price < 0) throw new Error("bad price");
      }
      const order = {
        id: "ord-" + (repository.list().length + 1),
        customer,
        items,
        discount: 0,
        createdAt: new Date(clock.now()).toISOString(),
      };
      repository.save(order);
      return order;
    },
    applyDiscount(id, percent) {
      if (typeof percent !== "number" || !(percent >= 0 && percent <= 100)) throw new Error("bad percent");
      const order = need(id);
      order.discount = percent;
      repository.save(order);
      return order;
    },
    total(id) {
      const order = need(id);
      const subtotal = order.items.reduce((s, it) => s + it.qty * it.price, 0);
      return Math.round((subtotal * (100 - order.discount)) / 100);
    },
    get(id) {
      return repository.get(id);
    },
  };
}

module.exports = { createOrderService };
