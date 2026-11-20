"use strict";
const { sha256Hex } = require("./store");

/**
 * Session manager. Sessions live in store.sessions.
 * A session is { userId, createdAt, lastSeenAt } (milliseconds from `now`).
 */
function createSessions({ store, now = Date.now, idleMs = 30 * 60 * 1000, absoluteMs = 12 * 60 * 60 * 1000 } = {}) {
  // Opaque identifier handed to the client as the session token.
  function newId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function create(userId) {
    const token = newId();
    store.sessions.set(token, { userId, createdAt: now(), lastSeenAt: now() });
    return token;
  }

  // Look a token up and mark the session as used.
  function validate(token) {
    const rec = store.sessions.get(token);
    if (!rec) return null;
    rec.lastSeenAt = now();
    return { userId: rec.userId, createdAt: rec.createdAt, lastSeenAt: rec.lastSeenAt };
  }

  // Swap a session for a fresh token for the same user.
  function rotate(token) {
    const rec = store.sessions.get(token);
    if (!rec) return null;
    return create(rec.userId);
  }

  function destroy(token) {
    store.sessions.delete(token);
  }

  // Remove every session that belongs to userId; returns how many were removed.
  function destroyAllForUser(userId) {
    let count = 0;
    for (const [key, rec] of store.sessions) {
      if (rec.userId === userId) {
        store.sessions.delete(key);
        count++;
      }
    }
    return count;
  }

  return { create, validate, rotate, destroy, destroyAllForUser };
}

module.exports = { createSessions };
