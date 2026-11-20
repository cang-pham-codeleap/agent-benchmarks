"use strict";
const fs = require("node:fs");
const store = require("../infra/file-store");

function placeOrder(dir, { customer, items }) {
  if (typeof customer !== "string" || customer === "") throw new Error("bad customer");
  if (!Array.isArray(items) || items.length === 0) throw new Error("bad items");
  for (const it of items) {
    if (!it || typeof it.sku !== "string" || it.sku === "") throw new Error("bad sku");
    if (!Number.isInteger(it.qty) || it.qty < 1) throw new Error("bad qty");
    if (!Number.isInteger(it.price) || it.price < 0) throw new Error("bad price");
  }
  const n = fs.existsSync(dir) ? store.all(dir).length : 0;
  const order = {
    id: "ord-" + (n + 1),
    customer,
    items,
    discount: 0,
    createdAt: new Date(Date.now()).toISOString(),
  };
  store.save(dir, order);
  return order;
}

function applyDiscount(dir, id, percent) {
  if (typeof percent !== "number" || !(percent >= 0 && percent <= 100)) throw new Error("bad percent");
  const order = store.load(dir, id);
  if (!order) throw new Error("unknown order " + id);
  order.discount = percent;
  store.save(dir, order);
  return order;
}

function total(dir, id) {
  const order = store.load(dir, id);
  if (!order) throw new Error("unknown order " + id);
  const subtotal = order.items.reduce((s, it) => s + it.qty * it.price, 0);
  return Math.round((subtotal * (100 - order.discount)) / 100);
}

function get(dir, id) {
  return store.load(dir, id);
}

module.exports = { placeOrder, applyDiscount, total, get };
