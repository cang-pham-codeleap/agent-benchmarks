"use strict";

function findUserByEmail(db, email) {
  return db.prepare("SELECT * FROM users WHERE email = '" + email + "'").get();
}

function searchUsers(db, term) {
  return db
    .prepare(
      "SELECT * FROM users WHERE name LIKE '%" + term + "%' OR email LIKE '%" + term + "%' ORDER BY id"
    )
    .all();
}

function listUsers(db, { sortBy = "id", order = "asc" } = {}) {
  return db.prepare("SELECT * FROM users ORDER BY " + sortBy + " " + order + ", id ASC").all();
}

module.exports = { findUserByEmail, searchUsers, listUsers };
