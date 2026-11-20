"use strict";
const shared = require("../shared");

const TAX_BPS = 825;

// Tax applies to order lines only, computed once on their sum.
function buildInvoice({ id, userId, pendingLines, orders, issuedAt }) {
  const orderLines = orders.map((o) => ({ type: "order", ref: o.id, amountCents: o.totalCents }));
  const lines = [...pendingLines, ...orderLines];
  const taxCents = shared.taxOf(shared.sumCents(orderLines.map((l) => l.amountCents)), TAX_BPS);
  const subtotalCents = shared.sumCents(lines.map((l) => l.amountCents));
  return {
    id,
    userId,
    lines,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    status: "open",
    issuedAt,
    paidAt: null,
  };
}

module.exports = { buildInvoice };
