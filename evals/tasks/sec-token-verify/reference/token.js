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

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = (reason) => ({ ok: false, reason });

function decodeSeg(seg) {
  if (!/^[A-Za-z0-9_-]+$/.test(seg)) return null;
  const buf = Buffer.from(seg, "base64url");
  return buf.toString("base64url") === seg ? buf : null;
}

function parseObject(buf) {
  try {
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buf));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function verify(token, { keys, now, issuer, audience, clockSkewSec = 0 } = {}) {
  if (typeof token !== "string") return fail("malformed");
  const segs = token.split(".");
  if (segs.length !== 3) return fail("malformed");
  const [h, p, s] = segs;
  const hb = decodeSeg(h), pb = decodeSeg(p), sb = decodeSeg(s);
  if (!hb || !pb || !sb) return fail("malformed");
  const header = parseObject(hb);
  if (!header) return fail("malformed");
  if (header.alg !== "HS256") return fail("bad_alg");
  if (typeof header.kid !== "string" || !has(keys, header.kid)) return fail("unknown_kid");
  const expect = crypto.createHmac("sha256", keys[header.kid]).update(h + "." + p).digest();
  if (sb.length !== expect.length || !crypto.timingSafeEqual(sb, expect)) return fail("bad_signature");
  const payload = parseObject(pb);
  if (!payload) return fail("malformed");
  for (const c of ["exp", "nbf", "iat"]) {
    if (c in payload && !(typeof payload[c] === "number" && Number.isFinite(payload[c]))) return fail("invalid_claim");
  }
  if ("exp" in payload && now >= payload.exp + clockSkewSec) return fail("expired");
  if ("nbf" in payload && now < payload.nbf - clockSkewSec) return fail("not_yet_valid");
  if ("iat" in payload && now < payload.iat - clockSkewSec) return fail("not_yet_valid");
  if (issuer !== undefined && payload.iss !== issuer) return fail("bad_issuer");
  if (audience !== undefined) {
    const a = payload.aud;
    if (!(a === audience || (Array.isArray(a) && a.every((x) => typeof x === "string") && a.includes(audience)))) {
      return fail("bad_audience");
    }
  }
  return { ok: true, payload };
}

module.exports = { sign, verify };
