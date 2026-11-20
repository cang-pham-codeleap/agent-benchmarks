"use strict";
// One process-wide mutable store. Every module reads and writes it directly.
const db = {
  users: [],
  orders: [],
  invoices: [],
  pending: {}, // userId -> billing lines waiting for the next invoice
  clock: null,
  ids: null,
  reset() {
    db.users = [];
    db.orders = [];
    db.invoices = [];
    db.pending = {};
  },
};

module.exports = db;
