"use strict";
const crypto = require("node:crypto");
const { sha256Hex } = require("./store");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function safeEqual(a, b) {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** CSRF tokens: `nonce.hmac`, where hmac = HMAC-SHA256(secret, sha256(sessionToken) + "." + nonce). */
function createCsrf(secret) {
  if (!(typeof secret === "string" || Buffer.isBuffer(secret)) || secret.length === 0) {
    throw new TypeError("csrf secret required");
  }

  const mac = (sessionToken, nonce) =>
    crypto.createHmac("sha256", secret).update(`${sha256Hex(sessionToken)}.${nonce}`).digest("base64url");

  function issue(sessionToken) {
    if (typeof sessionToken !== "string" || !sessionToken) throw new TypeError("session token required");
    const nonce = crypto.randomBytes(16).toString("base64url");
    return `${nonce}.${mac(sessionToken, nonce)}`;
  }

  function verify(sessionToken, csrfToken) {
    if (typeof sessionToken !== "string" || !sessionToken || typeof csrfToken !== "string") return false;
    const parts = csrfToken.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    return safeEqual(mac(sessionToken, parts[0]), parts[1]);
  }

  function validate({ method = "POST", sessionToken, cookie, header } = {}) {
    if (SAFE_METHODS.has(String(method).toUpperCase())) return true;
    if (typeof cookie !== "string" || typeof header !== "string") return false;
    return safeEqual(cookie, header) && verify(sessionToken, header);
  }

  return { issue, verify, validate };
}

module.exports = { createCsrf };
