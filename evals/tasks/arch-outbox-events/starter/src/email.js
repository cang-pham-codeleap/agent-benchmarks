"use strict";
function sendConfirmation(order, send) {
  send({ to: order.customer, subject: "Order " + order.id + " confirmed" });
}
module.exports = { sendConfirmation };
