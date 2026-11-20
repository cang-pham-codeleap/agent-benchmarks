"use strict";

/** Parse a Cookie request header into a name -> value object. */
function parseCookies(header) {
  const out = {};
  for (const pair of String(header || "").split(";")) {
    const [name, value] = pair.split("=");
    if (name && value !== undefined) out[name.trim()] = decodeURIComponent(value.trim());
  }
  return out;
}

/**
 * Build a Set-Cookie header value.
 * options: { httpOnly, maxAgeMs }
 */
function serializeCookie(name, value, { httpOnly = false, maxAgeMs } = {}) {
  let out = `${name}=${value}; Path=/`;
  if (maxAgeMs !== undefined) out += `; Max-Age=${maxAgeMs / 1000}`;
  if (httpOnly) out += "; HttpOnly";
  return out;
}

module.exports = { parseCookies, serializeCookie };
