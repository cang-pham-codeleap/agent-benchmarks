"use strict";
const db = require("../shared/db");

const insertInvoice = (inv) => {
  db.invoices.push(inv);
  return inv;
};
const getInvoice = (id) => db.invoices.find((i) => i.id === id) || null;
const invoicesFor = (userId) => db.invoices.filter((i) => i.userId === userId);
const addPending = (userId, line) => {
  (db.pending[userId] = db.pending[userId] || []).push(line);
};
const pendingFor = (userId) => db.pending[userId] || [];
const clearPending = (userId) => {
  delete db.pending[userId];
};

module.exports = { insertInvoice, getInvoice, invoicesFor, addPending, pendingFor, clearPending };
