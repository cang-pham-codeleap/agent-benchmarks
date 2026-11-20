"use strict";

const NAME = /^[A-Za-z0-9_-]+$/;

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse a Cookie request header into a prototype-less name -> value object. First occurrence wins. */
function parseCookies(header) {
  const out = Object.create(null);
  if (typeof header !== "string") return out;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name || name in out) continue;
    out[name] = decode(pair.slice(eq + 1).trim());
  }
  return out;
}

/** Build a Set-Cookie value: always Path=/, Secure, SameSite=Strict; HttpOnly on request. */
function serializeCookie(name, value, { httpOnly = false, maxAgeMs } = {}) {
  if (typeof name !== "string" || !NAME.test(name)) throw new TypeError("invalid cookie name");
  const parts = [`${name}=${encodeURIComponent(String(value))}`, "Path=/", "Secure", "SameSite=Strict"];
  if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`);
  if (httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

module.exports = { parseCookies, serializeCookie };
