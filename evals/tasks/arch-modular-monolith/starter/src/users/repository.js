"use strict";
const db = require("../shared/db");

// Hands out the live records: callers are expected to be careful.
function insert(user) {
  db.users.push(user);
  return user;
}
const get = (id) => db.users.find((u) => u.id === id) || null;
const findByEmail = (email) => db.users.find((u) => u.email === email) || null;
const all = () => db.users;

module.exports = { insert, get, findByEmail, all };
