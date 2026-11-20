"use strict";
const crypto = require("node:crypto");
const { normalizeUsername } = require("./store");
const { hashPassword, verifyPassword, needsRehash } = require("./passwords");
const { createSessions } = require("./sessions");
const { createCsrf } = require("./csrf");

const ROLES = ["user", "moderator", "admin"];

function createAuth({ store, now = Date.now, csrfSecret = crypto.randomBytes(32), idleMs, absoluteMs, lockout = {}, onEvent = () => {} } = {}) {
  if (!store) throw new TypeError("store is required");
  const sessions = createSessions({ store, now, idleMs, absoluteMs });
  const csrf = createCsrf(csrfSecret);

  const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, passwordHash: u.passwordHash });

  function findUserById(id) {
    for (const u of store.users.values()) if (u.id === id) return u;
    return undefined;
  }

  /**
  * Create a user. The username is normalized with normalizeUsername.
  * Returns the public user view.
  */
  function register(username, password, { role = "user" } = {}) {
    const name = normalizeUsername(username);
    if (!name) throw new TypeError("username required");
    if (store.users.has(name)) throw new Error("username taken");
    const user = { id: crypto.randomUUID(), username: name, passwordHash: hashPassword(password), role };
    store.users.set(name, user);
    return publicUser(user);
  }

  /**
  * Authenticate a user and open a session.
  * ip identifies the client; token is the caller's current session token, if any.
  * Returns { ok, token, csrfToken, user } on success or { ok: false, error }.
  */
  function login(username, password, { ip, token } = {}) {
    const user = store.users.get(normalizeUsername(username));
    if (!user) return { ok: false, error: "no_such_user" };
    if (!verifyPassword(password, user.passwordHash)) {
      onEvent({ type: "login_failure", username, password, ip });
      return { ok: false, error: "bad_password" };
    }
    const newToken = sessions.create(user.id);
    onEvent({ type: "login_success", username: user.username, ip, token: newToken });
    return { ok: true, token: newToken, csrfToken: csrf.issue(newToken), user: publicUser(user) };
  }

  /** Resolve a session token to the live public user, or null. */
  function authenticate(token) {
    const s = sessions.validate(token);
    if (!s) return null;
    const user = findUserById(s.userId);
    if (!user) return null;
    return { id: user.id, username: user.username, role: user.role };
  }

  /** End the session identified by token. Returns whether a live session was ended. */
  function logout(token) {
    const s = sessions.validate(token);
    if (!s) return false;
    sessions.destroy(token);
    onEvent({ type: "logout", token });
    return true;
  }

  /** Change a user's role. token is the caller's session, if any. */
  function setRole(username, role, { token } = {}) {
    const user = store.users.get(normalizeUsername(username));
    if (!user) return { ok: false, error: "no_such_user" };
    user.role = role;
    return { ok: true, token: token || null, csrfToken: token ? csrf.issue(token) : null };
  }

  /** Replace a user's password after checking the old one. */
  function changePassword(username, oldPassword, newPassword) {
    const user = store.users.get(normalizeUsername(username));
    if (!user) return { ok: false, error: "no_such_user" };
    if (!verifyPassword(oldPassword, user.passwordHash)) return { ok: false, error: "bad_password" };
    user.passwordHash = hashPassword(newPassword);
    return { ok: true };
  }

  return { register, login, authenticate, logout, setRole, changePassword, sessions, csrf };
}

module.exports = { createAuth, ROLES };
