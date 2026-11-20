"use strict";
const db = require("../shared/db");
const shared = require("../shared/errors");
const { periodPosition, iso } = require("../shared/time");
const usersRepo = require("../users/repository");
const plans = require("./plans");
const repo = require("./repository");
const { prorate } = require("./proration");
const invoices = require("./invoice");

function loadUser(id) {
  const user = usersRepo.get(id);
  if (!user) throw shared.notFound("user", id);
  return user;
}

function startSubscription(userId) {
  const plan = plans.get(loadUser(userId).plan);
  if (plan.priceCents > 0) {
    repo.addPending(userId, { type: "subscription", ref: plan.name, amountCents: plan.priceCents });
  }
}

function upgrade(userId, newPlan) {
  const user = loadUser(userId);
  const from = plans.get(user.plan);
  const to = plans.get(newPlan);
  if (to.rank <= from.rank) throw shared.validation(`${newPlan} is not an upgrade from ${from.name}`);
  const { remainingDays } = periodPosition(Date.parse(user.createdAt), db.clock.now());
  const p = prorate(from, to, remainingDays);
  user.plan = newPlan;
  user.planChangedAt = iso(db.clock.now());
  if (p.netCents > 0) {
    repo.addPending(userId, { type: "adjustment", ref: `${from.name}->${to.name}`, amountCents: p.netCents });
  }
  return {
    user,
    fromPlan: from.name,
    toPlan: to.name,
    remainingDays,
    creditCents: p.creditCents,
    chargeCents: p.chargeCents,
    netCents: p.netCents,
  };
}

function generateInvoice(userId) {
  loadUser(userId);
  const invoice = invoices.createInvoiceFor(userId);
  if (!invoice) throw shared.conflict("nothing to invoice");
  return invoice;
}

function getInvoice(id) {
  const invoice = repo.getInvoice(id);
  if (!invoice) throw shared.notFound("invoice", id);
  return invoice;
}

function payInvoice(id) {
  const invoice = getInvoice(id);
  if (invoice.status !== "open") throw shared.conflict(`invoice ${id} is ${invoice.status}`);
  return invoices.settle(invoice);
}

function listInvoices(userId) {
  loadUser(userId);
  return repo.invoicesFor(userId);
}

module.exports = { startSubscription, upgrade, generateInvoice, getInvoice, payInvoice, listInvoices };
