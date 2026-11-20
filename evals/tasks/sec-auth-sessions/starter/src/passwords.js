"use strict";
const crypto = require("node:crypto");

/*
 * Password storage.
 *
 * Stored hashes live in user.passwordHash. Accounts created by older releases
 * hold a bare sha256 hex digest of the password; those accounts must keep
 * working until their owners log in again.
 *
 * Callers:
 *   - login.register / login.changePassword call hashPassword
 *   - login.login calls verifyPassword, then needsRehash on success
 */

/** Hash a password for storage. */
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

/** Check a password against a stored hash. */
function verifyPassword(password, stored) {
  return hashPassword(password) === stored;
}

/** Should the stored hash be upgraded to the current format? */
function needsRehash(stored) {
  return false;
}

module.exports = { hashPassword, verifyPassword, needsRehash };
