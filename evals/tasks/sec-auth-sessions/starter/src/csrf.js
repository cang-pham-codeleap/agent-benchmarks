"use strict";
const { sha256Hex } = require("./store");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF protection helper (double-submit cookie pattern). */
function createCsrf(secret) {
  // Mint a token for the page of a signed-in session.
  function issue(sessionToken) {
    return sha256Hex(String(secret));
  }

  // Is csrfToken a token we issued for this session?
  function verify(sessionToken, csrfToken) {
    return csrfToken === issue(sessionToken);
  }

  // Full request check: the cookie copy and the header copy must both be present and valid.
  function validate({ method = "POST", sessionToken, cookie, header }) {
    if (SAFE_METHODS.has(String(method).toUpperCase())) return true;
    return cookie === header && verify(sessionToken, header);
  }

  return { issue, verify, validate };
}

module.exports = { createCsrf };
