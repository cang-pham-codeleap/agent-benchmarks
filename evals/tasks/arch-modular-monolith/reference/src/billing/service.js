"use strict";
const shared = require("../shared");
const { createBillingRepository } = require("./repository");
const { prorate } = require("./proration");
const { buildInvoice } = require("./invoice");

const copy = (v) => structuredClone(v);

function createBillingService({ clock, ids, users, orders }) {
  const repo = createBillingRepository();

  function loadInvoice(id) {
    const inv = repo.getInvoice(id);
    if (!inv) throw shared.notFound("invoice", id);
    return inv;
  }

  return {
    startSubscription(userId) {
      const user = users.get(userId);
      const plan = users.planInfo(user.plan);
      if (plan.priceCents > 0) {
        repo.addPending(userId, { type: "subscription", ref: plan.name, amountCents: plan.priceCents });
      }
    },
    upgrade(userId, newPlan) {
      const user = users.get(userId);
      const from = users.planInfo(user.plan);
      const to = users.planInfo(newPlan);
      if (to.rank <= from.rank) throw shared.validation(`${newPlan} is not an upgrade from ${from.name}`);
      const { remainingDays } = shared.periodPosition(Date.parse(user.createdAt), clock.now());
      const p = prorate(from, to, remainingDays);
      const updated = users.changePlan(userId, newPlan);
      if (p.netCents > 0) {
        repo.addPending(userId, { type: "adjustment", ref: `${from.name}->${to.name}`, amountCents: p.netCents });
      }
      return {
        user: updated,
        fromPlan: from.name,
        toPlan: to.name,
        remainingDays,
        creditCents: p.creditCents,
        chargeCents: p.chargeCents,
        netCents: p.netCents,
      };
    },
    generateInvoice(userId) {
      users.get(userId);
      const due = orders.pendingFor(userId);
      if (repo.peekPending(userId).length === 0 && due.length === 0) throw shared.conflict("nothing to invoice");
      const invoice = buildInvoice({
        id: ids.next("inv"),
        userId,
        pendingLines: repo.peekPending(userId),
        orders: due,
        issuedAt: shared.iso(clock.now()),
      });
      orders.markInvoiced(due.map((o) => o.id), invoice.id);
      repo.takePending(userId);
      repo.insertInvoice(invoice);
      return copy(invoice);
    },
    payInvoice(invoiceId) {
      const invoice = loadInvoice(invoiceId);
      if (invoice.status !== "open") throw shared.conflict(`invoice ${invoiceId} is ${invoice.status}`);
      orders.markPaid(invoice.lines.filter((l) => l.type === "order").map((l) => l.ref));
      invoice.status = "paid";
      invoice.paidAt = shared.iso(clock.now());
      return copy(invoice);
    },
    getInvoice: (id) => copy(loadInvoice(id)),
    listInvoices(userId) {
      users.get(userId);
      return copy(repo.invoicesFor(userId));
    },
  };
}

module.exports = { createBillingService };
