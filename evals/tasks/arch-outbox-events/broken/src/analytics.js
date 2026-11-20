"use strict";

function createAnalyticsHandler({ track }) {
  const seen = new Set();
  return function analyticsHandler(event) {
    if (seen.has(event.id)) return;
    const { order } = event.payload;
    track("order_placed", { orderId: order.id, total: order.total, items: order.items.length });
    seen.add(event.id);
  };
}
module.exports = { createAnalyticsHandler };
