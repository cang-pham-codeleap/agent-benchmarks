"use strict";
const crypto = require("node:crypto");

// Current scrypt parameters. Hash format: scrypt$N$r$p$saltHex$hashHex
const N = 16384;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const HEX = /^(?:[0-9a-f]{2})+$/i;
const LEGACY = /^[0-9a-f]{64}$/i;

function derive(password, salt, n, r, p, length) {
  return crypto.scryptSync(password, salt, length, { N: n, r, p, maxmem: 256 * 1024 * 1024 });
}

/** Hash a password for storage with a fresh random salt. */
function hashPassword(password) {
  if (typeof password !== "string") throw new TypeError("password must be a string");
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = derive(password, salt, N, R, P, KEY_BYTES);
  return ["scrypt", N, R, P, salt.toString("hex"), key.toString("hex")].join("$");
}

// Strict parser: anything malformed or outside the accepted parameter range is rejected.
function parse(stored) {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  if (!parts.slice(1, 4).every((s) => /^[1-9][0-9]*$/.test(s))) return null;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (n < 1024 || n > 65536 || (n & (n - 1)) !== 0 || r > 16 || p > 4) return null;
  if (!HEX.test(parts[4]) || !HEX.test(parts[5])) return null;
  const salt = Buffer.from(parts[4], "hex");
  const hash = Buffer.from(parts[5], "hex");
  if (salt.length < 8 || salt.length > 64 || hash.length < 16 || hash.length > 64) return null;
  return { n, r, p, salt, hash };
}

/** Constant-time check of a password against a stored scrypt or legacy sha256 hash. */
function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  if (LEGACY.test(stored)) {
    const digest = crypto.createHash("sha256").update(password, "utf8").digest();
    return crypto.timingSafeEqual(digest, Buffer.from(stored, "hex"));
  }
  const parsed = parse(stored);
  if (!parsed) return false;
  const key = derive(password, parsed.salt, parsed.n, parsed.r, parsed.p, parsed.hash.length);
  return crypto.timingSafeEqual(key, parsed.hash);
}

/** True when the stored hash is legacy, malformed, or uses parameters other than the current ones. */
function needsRehash(stored) {
  const parsed = parse(stored);
  return !parsed || parsed.n !== N || parsed.r !== R || parsed.p !== P || parsed.hash.length !== KEY_BYTES;
}

module.exports = { hashPassword, verifyPassword, needsRehash };
