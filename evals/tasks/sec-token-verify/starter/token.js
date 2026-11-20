"use strict";
const crypto = require("node:crypto");

const b64u = (buf) => Buffer.from(buf).toString("base64url");

function sign(payload, keys, kid) {
  if (!Object.prototype.hasOwnProperty.call(keys, kid)) throw new Error("unknown kid");
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT", kid }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", keys[kid]).update(head + "." + body).digest();
  return head + "." + body + "." + b64u(sig);
}

// Naive: trusts the header, falls back to any key, lenient decoding, no claim checks.
function verify(token, { keys, now, issuer, audience, clockSkewSec = 0 } = {}) {
  try {
    const [h, p, s] = token.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    if (header.alg !== "none") {
      const secret = keys[header.kid] || Object.values(keys)[0];
      const expect = crypto.createHmac("sha256", secret).update(h + "." + p).digest("base64url");
      if (expect != s) return { ok: false, reason: "bad_signature" };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

module.exports = { sign, verify };
