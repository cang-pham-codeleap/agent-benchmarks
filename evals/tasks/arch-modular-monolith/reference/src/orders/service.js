"use strict";
const shared = require("../shared");
const { createOrderRepository } = require("./repository");
const { validateItems, subtotalOf } = require("./pricing");

const copy = (v) => structuredClone(v);
const OPEN = new Set(["placed", "invoiced"]);

function createOrdersService({ clock, ids, users }) {
  const repo = createOrderRepository();

  function load(id) {
    const order = repo.get(id);
    if (!order) throw shared.notFound("order", id);
    return order;
  }

  function creditStatus(userId) {
    const plan = users.planInfo(users.get(userId).plan);
    const usedCents = shared.sumCents(repo.forUser(userId).filter((o) => OPEN.has(o.status)).map((o) => o.totalCents));
    return {
      limitCents: plan.creditLimitCents,
      usedCents,
      availableCents: Math.max(0, plan.creditLimitCents - usedCents),
    };
  }

  function requireAll(orderIds, status) {
    const orders = orderIds.map(load);
    for (const o of orders) {
      if (o.status !== status) throw shared.conflict(`order ${o.id} is ${o.status}, expected ${status}`);
    }
    return orders;
  }

  return {
    place(userId, rawItems) {
      const user = users.get(userId);
      const items = validateItems(rawItems);
      const plan = users.planInfo(user.plan);
      const subtotalCents = subtotalOf(items);
      const totalCents = shared.applyDiscount(subtotalCents, plan.discountPct);
      const status = creditStatus(userId);
      if (status.usedCents + totalCents > status.limitCents) {
        throw shared.creditLimit(`credit limit exceeded: ${status.usedCents} + ${totalCents} > ${status.limitCents}`);
      }
      const order = {
        id: ids.next("ord"),
        userId,
        items,
        subtotalCents,
        discountPct: plan.discountPct,
        totalCents,
        status: "placed",
        placedAt: shared.iso(clock.now()),
        invoiceId: null,
      };
      repo.insert(order);
      return copy(order);
    },
    get: (id) => copy(load(id)),
    listByUser(userId) {
      users.get(userId);
      return copy(repo.forUser(userId));
    },
    cancel(id) {
      const order = load(id);
      if (order.status !== "placed") throw shared.conflict(`order ${id} is ${order.status}, cannot cancel`);
      order.status = "cancelled";
      return copy(order);
    },
    creditStatus,
    pendingFor: (userId) => copy(repo.forUser(userId).filter((o) => o.status === "placed")),
    markInvoiced(orderIds, invoiceId) {
      for (const o of requireAll(orderIds, "placed")) {
        o.status = "invoiced";
        o.invoiceId = invoiceId;
      }
    },
    markPaid(orderIds) {
      for (const o of requireAll(orderIds, "invoiced")) o.status = "paid";
    },
  };
}

module.exports = { createOrdersService };
