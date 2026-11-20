"use strict";
const crypto = require("node:crypto");
const { sha256Hex } = require("./store");

/**
 * Session manager. Tokens are 32 random bytes (base64url). Only the sha256 hex of a
 * token is ever stored, as the key of store.sessions. A session is
 * { userId, createdAt, lastSeenAt } (milliseconds from `now`).
 */
function createSessions({ store, now = Date.now, idleMs = 30 * 60 * 1000, absoluteMs = 12 * 60 * 60 * 1000 } = {}) {
  function insert(userId, createdAt) {
    const token = crypto.randomBytes(32).toString("base64url");
    store.sessions.set(sha256Hex(token), { userId, createdAt, lastSeenAt: now() });
    return token;
  }

  // Returns the live session record, deleting it first if it has expired.
  function lookup(token) {
    if (typeof token !== "string") return null;
    const key = sha256Hex(token);
    const rec = store.sessions.get(key);
    if (!rec) return null;
    const t = now();
    if (t - rec.lastSeenAt >= idleMs || t - rec.createdAt >= absoluteMs) {
      store.sessions.delete(key);
      return null;
    }
    return { key, rec };
  }

  function create(userId) {
    return insert(userId, now());
  }

  function validate(token) {
    const hit = lookup(token);
    if (!hit) return null;
    hit.rec.lastSeenAt = now();
    return { userId: hit.rec.userId, createdAt: hit.rec.createdAt, lastSeenAt: hit.rec.lastSeenAt };
  }

  // The new session inherits createdAt, so rotating never extends the absolute lifetime.
  function rotate(token) {
    const hit = lookup(token);
    if (!hit) return null;
    store.sessions.delete(hit.key);
    return insert(hit.rec.userId, hit.rec.createdAt);
  }

  function destroy(token) {
    if (typeof token === "string") store.sessions.delete(sha256Hex(token));
  }

  function destroyAllForUser(userId, exceptToken) {
    const keep = typeof exceptToken === "string" ? sha256Hex(exceptToken) : null;
    let count = 0;
    for (const [key, rec] of store.sessions) {
      if (rec.userId === userId && key !== keep) {
        store.sessions.delete(key);
        count++;
      }
    }
    return count;
  }

  return { create, validate, rotate, destroy, destroyAllForUser };
}

module.exports = { createSessions };
