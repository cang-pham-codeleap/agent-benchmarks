"use strict";

function createEmailHandler({ send }) {
  const seen = new Set();
  return function emailHandler(event) {
    if (seen.has(event.id)) return;
    const { order } = event.payload;
    send({ to: order.customer, subject: "Order " + order.id + " confirmed" });
    seen.add(event.id);
  };
}
module.exports = { createEmailHandler };
