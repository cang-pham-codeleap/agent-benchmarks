"use strict";

function createInventoryHandler({ stock }) {
  const seen = new Set();
  return function inventoryHandler(event) {
    if (seen.has(event.id)) return;
    const { order } = event.payload;
    for (const { sku, qty } of order.items) {
      if ((stock[sku] || 0) < qty) throw new Error("insufficient stock for " + sku);
    }
    for (const { sku, qty } of order.items) stock[sku] -= qty;
    seen.add(event.id);
  };
}
module.exports = { createInventoryHandler };
