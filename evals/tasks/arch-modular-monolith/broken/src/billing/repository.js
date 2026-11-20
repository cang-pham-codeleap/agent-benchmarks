"use strict";

function createBillingRepository() {
  const invoices = new Map();
  const pendingLines = new Map();
  return {
    insertInvoice: (inv) => void invoices.set(inv.id, inv),
    getInvoice: (id) => invoices.get(id) || null,
    invoicesFor: (userId) => [...invoices.values()].filter((i) => i.userId === userId),
    addPending(userId, line) {
      pendingLines.set(userId, [...(pendingLines.get(userId) || []), line]);
    },
    takePending(userId) {
      const lines = pendingLines.get(userId) || [];
      pendingLines.delete(userId);
      return lines;
    },
    peekPending: (userId) => pendingLines.get(userId) || [],
  };
}

module.exports = { createBillingRepository };
