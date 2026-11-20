"use strict";
const crypto = require("node:crypto");

/**
 * In-memory data store shared by every module.
 *   users:    Map<normalizedUsername, { id, username, passwordHash, role }>
 *   sessions: Map<sessionKey, { userId, createdAt, lastSeenAt }>
 *   attempts: Map<attemptKey, { failures, lastFailureAt, lockedUntil }>
 */
function createStore() {
  return { users: new Map(), sessions: new Map(), attempts: new Map() };
}

/** Usernames are case-insensitive and ignore surrounding whitespace. */
function normalizeUsername(name) {
  return String(name).trim().toLowerCase();
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

module.exports = { createStore, normalizeUsername, sha256Hex };
