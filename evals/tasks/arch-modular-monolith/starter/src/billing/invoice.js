"use strict";
const db = require("../shared/db");
const money = require("../shared/money");
const { iso } = require("../shared/time");
const ordersRepo = require("../orders/repository");
const repo = require("./repository");

const TAX_BPS = 825;

// Tax applies to order lines only, computed once on their sum.
function createInvoiceFor(userId) {
  const due = ordersRepo.forUser(userId).filter((o) => o.status === "placed");
  const pendingLines = repo.pendingFor(userId);
  if (pendingLines.length === 0 && due.length === 0) return null;
  const id = db.ids.next("inv");
  const orderLines = due.map((o) => ({ type: "order", ref: o.id, amountCents: o.totalCents }));
  const lines = [...pendingLines, ...orderLines];
  const taxCents = money.taxOf(money.sumCents(orderLines.map((l) => l.amountCents)), TAX_BPS);
  const subtotalCents = money.sumCents(lines.map((l) => l.amountCents));
  for (const o of due) {
    o.status = "invoiced";
    o.invoiceId = id;
  }
  repo.clearPending(userId);
  return repo.insertInvoice({
    id,
    userId,
    lines,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    status: "open",
    issuedAt: iso(db.clock.now()),
    paidAt: null,
  });
}

function settle(invoice) {
  for (const line of invoice.lines) {
    if (line.type !== "order") continue;
    const order = ordersRepo.get(line.ref);
    order.status = "paid";
  }
  invoice.status = "paid";
  invoice.paidAt = iso(db.clock.now());
  return invoice;
}

module.exports = { createInvoiceFor, settle };
