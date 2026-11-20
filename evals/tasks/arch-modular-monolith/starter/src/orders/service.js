"use strict";
const db = require("../shared/db");
const shared = require("../shared/errors");
const money = require("../shared/money");
const { iso } = require("../shared/time");
const users = require("../users");
const repo = require("./repository");
const pricing = require("./pricing");

const OPEN = new Set(["placed", "invoiced"]);

function load(id) {
  const order = repo.get(id);
  if (!order) throw shared.notFound("order", id);
  return order;
}

function creditStatus(userId) {
  users.get(userId);
  const plan = pricing.planOf(userId);
  const usedCents = money.sumCents(repo.forUser(userId).filter((o) => OPEN.has(o.status)).map((o) => o.totalCents));
  return {
    limitCents: plan.creditLimitCents,
    usedCents,
    availableCents: Math.max(0, plan.creditLimitCents - usedCents),
  };
}

function place(userId, rawItems) {
  const user = users.get(userId);
  const items = pricing.validateItems(rawItems);
  const plan = pricing.planOf(user.id);
  const subtotalCents = pricing.subtotalOf(items);
  const totalCents = money.applyDiscount(subtotalCents, plan.discountPct);
  const status = creditStatus(userId);
  if (status.usedCents + totalCents > status.limitCents) {
    throw shared.creditLimit(`credit limit exceeded: ${status.usedCents} + ${totalCents} > ${status.limitCents}`);
  }
  return repo.insert({
    id: db.ids.next("ord"),
    userId,
    items,
    subtotalCents,
    discountPct: plan.discountPct,
    totalCents,
    status: "placed",
    placedAt: iso(db.clock.now()),
    invoiceId: null,
  });
}

function get(id) {
  return load(id);
}

function listByUser(userId) {
  users.get(userId);
  return repo.forUser(userId);
}

function cancel(id) {
  const order = load(id);
  if (order.status !== "placed") throw shared.conflict(`order ${id} is ${order.status}, cannot cancel`);
  order.status = "cancelled";
  return order;
}

module.exports = { place, get, listByUser, cancel, creditStatus };
