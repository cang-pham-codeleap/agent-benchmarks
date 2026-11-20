"use strict";

function createCheckout({ store, now }) {
  function placeOrder({ customer, items }) {
    if (typeof customer !== "string" || customer === "") throw new Error("invalid customer");
    if (!Array.isArray(items) || items.length === 0) throw new Error("invalid items");
    for (const it of items) {
      if (!it || typeof it.sku !== "string" || it.sku === "") throw new Error("invalid sku");
      if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error("invalid qty");
      if (!Number.isInteger(it.price) || it.price < 0) throw new Error("invalid price");
    }
    const total = items.reduce((s, it) => s + it.qty * it.price, 0);
    const order = {
      id: "ord-" + (store.countOrders() + 1),
      customer,
      items: items.map(({ sku, qty, price }) => ({ sku, qty, price })),
      total,
      createdAt: new Date(now()).toISOString(),
    };
    const event = {
      id: "evt-" + order.id,
      type: "OrderPlaced",
      payload: { order },
      createdAt: now(),
      status: "pending",
      delivered: [],
      dead: [],
      attempts: {},
      nextAttemptAt: {},
    };
    store.commit({ orders: [order], events: [event] });
    return order;
  }
  return { placeOrder };
}
module.exports = { createCheckout };
