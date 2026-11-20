"use strict";
// `stock` is a plain object: sku -> units on hand.
function reserve(order, stock) {
  for (const { sku, qty } of order.items) {
    if ((stock[sku] || 0) < qty) throw new Error("insufficient stock for " + sku);
  }
  for (const { sku, qty } of order.items) stock[sku] -= qty;
}
module.exports = { reserve };
