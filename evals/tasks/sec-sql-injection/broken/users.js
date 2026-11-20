"use strict";

const COLUMNS = new Set(["id", "name", "email", "role"]);
const ORDERS = new Set(["ASC", "DESC"]);
const q = (s) => String(s).replace(/'/g, "''");

function findUserByEmail(db, email) {
  return db.prepare("SELECT * FROM users WHERE email = '" + q(email) + "'").get();
}

function searchUsers(db, term) {
  const t = q(term);
  return db
    .prepare("SELECT * FROM users WHERE name LIKE '%" + t + "%' OR email LIKE '%" + t + "%' ORDER BY id")
    .all();
}

function listUsers(db, { sortBy = "id", order = "asc" } = {}) {
  const dir = typeof order === "string" ? order.toUpperCase() : "";
  if (typeof sortBy !== "string" || !COLUMNS.has(sortBy)) throw new RangeError("invalid sortBy: " + sortBy);
  if (!ORDERS.has(dir)) throw new RangeError("invalid order: " + order);
  return db.prepare(`SELECT * FROM users ORDER BY ${sortBy} ${dir}, id ASC`).all();
}

module.exports = { findUserByEmail, searchUsers, listUsers };
