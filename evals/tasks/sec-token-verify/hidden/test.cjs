"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
const ws = process.env.ACH_WORKSPACE || process.cwd();
let failed = 0;
function t(name, fn) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.message ? e.message : String(e))); }
}
process.on("exit", () => { if (failed > 0) process.exitCode = 1; });

const { sign, verify } = require(path.join(ws, "token.js"));
const KEYS = { k1: "secret-one", k2: "secret-two" };
const NOW = 1_000_000;
const b = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
const mac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("base64url");
function forge(header, payload, { secret = "secret-one", rawPayload } = {}) {
  const h = typeof header === "string" ? header : b(header);
  const p = rawPayload !== undefined ? rawPayload : b(payload);
  return h + "." + p + "." + mac(secret, h + "." + p);
}
const H = { alg: "HS256", typ: "JWT", kid: "k1" };
const v = (tok, extra = {}) => verify(tok, { keys: KEYS, now: NOW, ...extra });
const reason = (tok, extra, want) => { const r = v(tok, extra); assert.equal(r.ok, false, "accepted: " + JSON.stringify(r)); assert.equal(r.reason, want); };
const good = (tok, extra) => { const r = v(tok, extra); assert.equal(r.ok, true, "rejected: " + JSON.stringify(r)); return r.payload; };

t("sign output verifies, payload returned", () => {
  const tok = sign({ sub: "u1", n: 1 }, KEYS, "k2");
  assert.deepEqual(good(tok), { sub: "u1", n: 1 });
  assert.deepEqual(JSON.parse(Buffer.from(tok.split(".")[0], "base64url")), { alg: "HS256", typ: "JWT", kid: "k2" });
});
t("sign throws on unknown kid / inherited kid", () => {
  assert.throws(() => sign({}, KEYS, "nope"));
  assert.throws(() => sign({}, KEYS, "toString"));
});
t("rotation: tokens from both kids verify", () => {
  good(forge({ ...H, kid: "k1" }, { a: 1 }));
  good(forge({ ...H, kid: "k2" }, { a: 1 }, { secret: "secret-two" }));
});
t("never throws and returns typed result on non-strings", () => {
  for (const x of [undefined, null, 5, {}, [], Buffer.from("a.b.c")]) reason(x, {}, "malformed");
});
t("alg none with empty signature", () => {
  reason(b({ alg: "none", kid: "k1" }) + "." + b({ a: 1 }) + ".", {}, "malformed");
});
t("alg none with a signature segment", () => {
  reason(forge({ alg: "none", kid: "k1" }, { a: 1 }), {}, "bad_alg");
});
t("alg case variants rejected", () => {
  for (const alg of ["hs256", "Hs256", "HS256 ", " HS256", "HS256\n", "NONE", "None"]) {
    reason(forge({ ...H, alg }, { a: 1 }), {}, "bad_alg");
  }
});
t("other algs / wrong alg types rejected", () => {
  for (const alg of ["HS512", "RS256", "ES256", "", null, 256, ["HS256"], { a: 1 }, true]) {
    reason(forge({ ...H, alg }, { a: 1 }), {}, "bad_alg");
  }
  reason(forge({ typ: "JWT", kid: "k1" }, { a: 1 }), {}, "bad_alg");
});
t("missing / non-string / unknown kid", () => {
  reason(forge({ alg: "HS256" }, { a: 1 }), {}, "unknown_kid");
  reason(forge({ ...H, kid: "k3" }, { a: 1 }), {}, "unknown_kid");
  for (const kid of [1, null, ["k1"], { k1: 1 }, true]) reason(forge({ ...H, kid }, { a: 1 }), {}, "unknown_kid");
});
t("kid cannot resolve prototype properties", () => {
  for (const kid of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    reason(forge({ ...H, kid }, { a: 1 }, { secret: "x" }), {}, "unknown_kid");
  }
});
t("kid with unknown alg ordering: bad_alg before unknown_kid", () => {
  reason(forge({ alg: "none", kid: "zzz" }, { a: 1 }), {}, "bad_alg");
});
t("signature made with the other key is rejected (kid confusion)", () => {
  reason(forge({ ...H, kid: "k1" }, { a: 1 }, { secret: "secret-two" }), {}, "bad_signature");
});
t("tampered payload rejected", () => {
  const tok = sign({ sub: "u1", admin: false }, KEYS, "k1").split(".");
  reason(tok[0] + "." + b({ sub: "u1", admin: true }) + "." + tok[2], {}, "bad_signature");
});
t("tampered signature rejected (first and middle chars)", () => {
  const [h, p, s] = sign({ a: 1 }, KEYS, "k1").split(".");
  const flip = (str, i) => str.slice(0, i) + (str[i] === "A" ? "B" : "A") + str.slice(i + 1);
  reason([h, p, flip(s, 0)].join("."), {}, "bad_signature");
  reason([h, p, flip(s, 20)].join("."), {}, "bad_signature");
});
t("wrong-length but well-formed signatures", () => {
  const [h, p] = sign({ a: 1 }, KEYS, "k1").split(".");
  const full = Buffer.from(mac("secret-one", h + "." + p), "base64url");
  reason(h + "." + p + "." + b(full.subarray(0, 31)), {}, "bad_signature");
  reason(h + "." + p + "." + b(Buffer.concat([full, Buffer.from([0])])), {}, "bad_signature");
  reason(h + "." + p + "." + b("x"), {}, "bad_signature");
});
t("non-canonical signature encoding (trailing bits) is malformed", () => {
  const [h, p, s] = sign({ a: 1 }, KEYS, "k1").split(".");
  assert.equal(s.length, 43);
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const i = alpha.indexOf(s[42]);
  const alt = alpha[(i & 0x3c) | ((i + 1) & 3)];
  assert.notEqual(alt, s[42]);
  assert.deepEqual(Buffer.from(s.slice(0, 42) + alt, "base64url"), Buffer.from(s, "base64url"), "test premise");
  reason([h, p, s.slice(0, 42) + alt].join("."), {}, "malformed");
});
t("padding rejected in any segment", () => {
  const [h, p, s] = sign({ a: 1 }, KEYS, "k1").split(".");
  reason([h, p, s + "="].join("."), {}, "malformed");
  reason([h + "==", p, s].join("."), {}, "malformed");
  const p2 = b({ ab: 1 });
  assert.ok(p2.length % 4 !== 0);
  const padded = p2 + "=".repeat(4 - (p2.length % 4));
  reason(forge(H, null, { rawPayload: padded }), {}, "malformed");
});
t("standard base64 alphabet / whitespace rejected", () => {
  const [h, p, s] = sign({ a: "???>>>" }, KEYS, "k1").split(".");
  const std = Buffer.from(JSON.stringify({ a: "???>>>" })).toString("base64").replace(/=+$/, "");
  assert.ok(/[+/]/.test(std), "premise");
  reason(forge(H, null, { rawPayload: std }), {}, "malformed");
  reason([h, p, s + "\n"].join("."), {}, "malformed");
  reason([" " + h, p, s].join("."), {}, "malformed");
  reason([h, p.slice(0, 2) + " " + p.slice(2), s].join("."), {}, "malformed");
});
t("impossible base64url length (len % 4 == 1) rejected", () => {
  const [h, p, s] = sign({ a: 1 }, KEYS, "k1").split(".");
  reason([h, p, s + "AA"].join("."), {}, "malformed");
  reason(forge(H, null, { rawPayload: "A" }), {}, "malformed");
});
t("segment count must be exactly 3", () => {
  const tok = sign({ a: 1 }, KEYS, "k1");
  const [h, p, s] = tok.split(".");
  reason(tok + ".", {}, "malformed");
  reason(tok + ".AAAA", {}, "malformed");
  reason(h + "." + p, {}, "malformed");
  reason(h, {}, "malformed");
  reason("", {}, "malformed");
  reason(".." , {}, "malformed");
  reason(h + ".." + s, {}, "malformed");
  reason("." + p + "." + s, {}, "malformed");
});
t("header not a JSON object / not JSON / not UTF-8", () => {
  for (const hdr of ["[]", "null", "42", '"HS256"', "true", "{not json", ""]) {
    if (hdr === "") continue;
    reason(forge(b(hdr), { a: 1 }), {}, "malformed");
  }
  reason(forge(Buffer.from([0xff, 0xfe, 0x7b, 0x7d]).toString("base64url"), { a: 1 }), {}, "malformed");
});
t("signed non-object payloads rejected as malformed", () => {
  for (const raw of ["[1,2]", "null", "123", '"str"', "true", "{broken"]) {
    reason(forge(H, null, { rawPayload: b(raw) }), {}, "malformed");
  }
  reason(forge(H, null, { rawPayload: Buffer.from([0xc3, 0x28]).toString("base64url") }), {}, "malformed");
});
t("unsigned non-object payload reports bad_signature (order)", () => {
  const [h, , s] = sign({ a: 1 }, KEYS, "k1").split(".");
  reason([h, b("[1]"), s].join("."), {}, "bad_signature");
});
t("exp boundary and past/future", () => {
  good(forge(H, { exp: NOW + 1 }));
  reason(forge(H, { exp: NOW }), {}, "expired");
  reason(forge(H, { exp: NOW - 1 }), {}, "expired");
});
t("exp with clock skew", () => {
  good(forge(H, { exp: NOW - 5 }), { clockSkewSec: 10 });
  good(forge(H, { exp: NOW - 10 + 1 }), { clockSkewSec: 10 });
  reason(forge(H, { exp: NOW - 10 }), { clockSkewSec: 10 }, "expired");
  reason(forge(H, { exp: NOW - 11 }), { clockSkewSec: 10 }, "expired");
});
t("nbf boundary and skew", () => {
  good(forge(H, { nbf: NOW }));
  reason(forge(H, { nbf: NOW + 1 }), {}, "not_yet_valid");
  good(forge(H, { nbf: NOW + 10 }), { clockSkewSec: 10 });
  reason(forge(H, { nbf: NOW + 11 }), { clockSkewSec: 10 }, "not_yet_valid");
});
t("iat in the future / skew", () => {
  good(forge(H, { iat: NOW }));
  reason(forge(H, { iat: NOW + 1 }), {}, "not_yet_valid");
  good(forge(H, { iat: NOW + 5 }), { clockSkewSec: 5 });
  reason(forge(H, { iat: NOW + 6 }), { clockSkewSec: 5 }, "not_yet_valid");
});
t("invalid claim types", () => {
  for (const claim of ["exp", "nbf", "iat"]) {
    for (const val of ["99999999", null, true, [], {}, "NaN"]) {
      reason(forge(H, { [claim]: val }), {}, "invalid_claim");
    }
  }
  reason(forge(H, null, { rawPayload: b('{"exp":1e999}') }), {}, "invalid_claim");
});
t("invalid_claim precedes expired/not_yet_valid", () => {
  reason(forge(H, { exp: NOW - 100, nbf: "x" }), {}, "invalid_claim");
  reason(forge(H, { exp: NOW - 100, nbf: NOW + 100 }), {}, "expired");
});
t("fractional and negative numeric claims", () => {
  reason(forge(H, { exp: NOW - 0.5 }), {}, "expired");
  good(forge(H, { exp: NOW + 0.5 }));
  good(forge(H, { nbf: -5, iat: 0 }));
});
t("issuer check", () => {
  good(forge(H, { iss: "me" }), { issuer: "me" });
  reason(forge(H, { iss: "other" }), { issuer: "me" }, "bad_issuer");
  reason(forge(H, { a: 1 }), { issuer: "me" }, "bad_issuer");
  reason(forge(H, { iss: ["me"] }), { issuer: "me" }, "bad_issuer");
  reason(forge(H, { iss: "ME" }), { issuer: "me" }, "bad_issuer");
  good(forge(H, { iss: "anything" }));
});
t("audience as string", () => {
  good(forge(H, { aud: "api" }), { audience: "api" });
  reason(forge(H, { aud: "web" }), { audience: "api" }, "bad_audience");
  reason(forge(H, { a: 1 }), { audience: "api" }, "bad_audience");
});
t("audience as array", () => {
  good(forge(H, { aud: ["web", "api"] }), { audience: "api" });
  reason(forge(H, { aud: ["web", "app"] }), { audience: "api" }, "bad_audience");
  reason(forge(H, { aud: [] }), { audience: "api" }, "bad_audience");
  reason(forge(H, { aud: ["api", 5] }), { audience: "api" }, "bad_audience");
  reason(forge(H, { aud: 5 }), { audience: "api" }, "bad_audience");
  reason(forge(H, { aud: { api: 1 } }), { audience: "api" }, "bad_audience");
  good(forge(H, { aud: ["x"] }));
});
t("claim check order: expired before issuer/audience", () => {
  reason(forge(H, { exp: NOW - 1, iss: "bad", aud: "bad" }), { issuer: "me", audience: "api" }, "expired");
  reason(forge(H, { iss: "bad", aud: "bad" }), { issuer: "me", audience: "api" }, "bad_issuer");
});
t("full valid token with all checks", () => {
  const p = { iss: "me", aud: ["api"], exp: NOW + 60, nbf: NOW - 60, iat: NOW - 60, sub: "u" };
  assert.deepEqual(good(forge(H, p), { issuer: "me", audience: "api", clockSkewSec: 3 }), p);
});
t("payload keys like __proto__ do not break claims", () => {
  const raw = '{"__proto__":{"exp":1},"a":1}';
  good(forge(H, null, { rawPayload: b(raw) }));
});
t("timing-safe comparison used", () => {
  const src = require("node:fs").readFileSync(path.join(ws, "token.js"), "utf8");
  assert.ok(/timingSafeEqual/.test(src), "token.js must use crypto.timingSafeEqual");
});

if (failed > 0) console.log(failed + " case(s) failed");
