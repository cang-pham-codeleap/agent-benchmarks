"use strict";
function trackOrder(order, track) {
  track("order_placed", { orderId: order.id, total: order.total, items: order.items.length });
}
module.exports = { trackOrder };
