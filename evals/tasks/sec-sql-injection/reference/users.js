"use strict";

const COLUMNS = new Set(["id", "name", "email", "role"]);
const ORDERS = new Set(["ASC", "DESC"]);

function findUserByEmail(db, email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

function searchUsers(db, term) {
  const pattern = "%" + String(term).replace(/[\\%_]/g, "\\$&") + "%";
  return db
    .prepare("SELECT * FROM users WHERE name LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\' ORDER BY id")
    .all(pattern);
}

function listUsers(db, { sortBy = "id", order = "asc" } = {}) {
  const dir = typeof order === "string" ? order.toUpperCase() : "";
  if (typeof sortBy !== "string" || !COLUMNS.has(sortBy)) throw new RangeError("invalid sortBy: " + sortBy);
  if (!ORDERS.has(dir)) throw new RangeError("invalid order: " + order);
  return db.prepare(`SELECT * FROM users ORDER BY ${sortBy} ${dir}, id ASC`).all();
}

module.exports = { findUserByEmail, searchUsers, listUsers };
