"use strict";
const db = require("../shared/db");

const insert = (order) => {
  db.orders.push(order);
  return order;
};
const get = (id) => db.orders.find((o) => o.id === id) || null;
const forUser = (userId) => db.orders.filter((o) => o.userId === userId);

module.exports = { insert, get, forUser };
