"use strict";

function createUserRepository() {
  const byId = new Map();
  return {
    insert: (user) => void byId.set(user.id, user),
    get: (id) => byId.get(id) || null,
    findByEmail: (email) => [...byId.values()].find((u) => u.email === email) || null,
  };
}

module.exports = { createUserRepository };
