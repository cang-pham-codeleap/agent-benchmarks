"use strict";
const crypto = require("node:crypto");
const { normalizeUsername } = require("./store");
const { hashPassword, verifyPassword, needsRehash } = require("./passwords");
const { createSessions } = require("./sessions");
const { createCsrf } = require("./csrf");

const ROLES = ["user", "moderator", "admin"];
const MIN_PASSWORD = 8;

function createAuth({ store, now = Date.now, csrfSecret = crypto.randomBytes(32), idleMs, absoluteMs, lockout = {}, onEvent = () => {} } = {}) {
  if (!store) throw new TypeError("store is required");
  const cfg = { threshold: 5, baseMs: 1000, maxMs: 15 * 60 * 1000, resetMs: 60 * 60 * 1000, ...lockout };
  const sessions = createSessions({ store, now, idleMs, absoluteMs });
  const csrf = createCsrf(csrfSecret);
  // Verified against when the account does not exist, so both paths do one scrypt.
  const dummyHash = hashPassword(crypto.randomBytes(16).toString("hex"));

  const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role });
  const invalid = () => ({ ok: false, error: "invalid_credentials" });
  // JSON key: a delimiter-joined string could collide for usernames containing the delimiter.
  const attemptKey = (username, ip) => JSON.stringify([normalizeUsername(username), ipOf(ip)]);

  const ipOf = (ip) => (typeof ip === "string" && ip ? ip : "unknown");

  function findUserById(id) {
    for (const u of store.users.values()) if (u.id === id) return u;
    return undefined;
  }

  function register(username, password, { role = "user" } = {}) {
    const name = typeof username === "string" ? normalizeUsername(username) : "";
    if (!name) throw new TypeError("username required");
    if (typeof password !== "string" || password.length < MIN_PASSWORD) throw new RangeError("password too short");
    if (!ROLES.includes(role)) throw new RangeError("unknown role");
    if (store.users.has(name)) throw new Error("username taken");
    const user = { id: crypto.randomUUID(), username: name, passwordHash: hashPassword(password), role };
    store.users.set(name, user);
    return publicUser(user);
  }

  function recordFailure(key, t) {
    const prev = store.attempts.get(key);
    const failures = prev && t - prev.lastFailureAt < cfg.resetMs ? prev.failures + 1 : 1;
    const lockedUntil =
      failures >= cfg.threshold ? t + Math.min(cfg.baseMs * 2 ** (failures - cfg.threshold), cfg.maxMs) : 0;
    store.attempts.set(key, { failures, lastFailureAt: t, lockedUntil });
  }

  function login(username, password, { ip, token } = {}) {
    if (typeof username !== "string" || typeof password !== "string") return invalid();
    const key = attemptKey(username, ip);
    const t = now();
    const prev = store.attempts.get(key);
    if (prev && prev.lockedUntil > t) {
      onEvent({ type: "login_locked", username: normalizeUsername(username), ip: ipOf(ip) });
      return { ok: false, error: "locked", retryAfterMs: prev.lockedUntil - t };
    }

    const user = store.users.get(normalizeUsername(username));
    const matches = verifyPassword(password, user ? user.passwordHash : dummyHash);
    if (!user || !matches) {
      recordFailure(key, t);
      onEvent({ type: "login_failure", username: normalizeUsername(username), ip: ipOf(ip) });
      return invalid();
    }

    store.attempts.delete(key);
    if (needsRehash(user.passwordHash)) user.passwordHash = hashPassword(password);
    sessions.destroy(token);
    const newToken = sessions.create(user.id);
    onEvent({ type: "login_success", username: user.username, ip: ipOf(ip) });
    return { ok: true, token: newToken, csrfToken: csrf.issue(newToken), user: publicUser(user) };
  }

  function authenticate(token) {
    const s = sessions.validate(token);
    if (!s) return null;
    const user = findUserById(s.userId);
    if (!user) {
      sessions.destroy(token);
      return null;
    }
    return publicUser(user);
  }

  function logout(token) {
    const s = sessions.validate(token);
    if (!s) return false;
    sessions.destroyAllForUser(s.userId);
    const user = findUserById(s.userId);
    if (user) onEvent({ type: "logout", username: user.username });
    return true;
  }

  function setRole(username, role, { token } = {}) {
    if (!ROLES.includes(role)) throw new RangeError("unknown role");
    const user = typeof username === "string" ? store.users.get(normalizeUsername(username)) : undefined;
    if (!user) return { ok: false, error: "no_such_user" };
    user.role = role;
    const s = sessions.validate(token);
    const newToken = s && s.userId === user.id ? sessions.rotate(token) : null;
    sessions.destroyAllForUser(user.id, newToken);
    onEvent({ type: "role_changed", username: user.username, role });
    return { ok: true, token: newToken, csrfToken: newToken ? csrf.issue(newToken) : null };
  }

  function changePassword(username, oldPassword, newPassword) {
    if (typeof username !== "string" || typeof oldPassword !== "string" || typeof newPassword !== "string") return invalid();
    const user = store.users.get(normalizeUsername(username));
    const matches = verifyPassword(oldPassword, user ? user.passwordHash : dummyHash);
    if (!user || !matches) return invalid();
    if (newPassword.length < MIN_PASSWORD) return { ok: false, error: "weak_password" };
    user.passwordHash = hashPassword(newPassword);
    sessions.destroyAllForUser(user.id);
    onEvent({ type: "password_changed", username: user.username });
    return { ok: true };
  }

  return { register, login, authenticate, logout, setRole, changePassword, sessions, csrf };
}

module.exports = { createAuth, ROLES };
