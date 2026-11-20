"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

// Count constant-time comparisons: installed before the workspace modules load.
const origTSE = crypto.timingSafeEqual;
let tseCalls = 0;
crypto.timingSafeEqual = (a, b) => {
  tseCalls++;
  return origTSE(a, b);
};

const ws = path.resolve(process.env.ACH_WORKSPACE || process.cwd());
const load = (f) => require(path.join(ws, "src", f));
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + ": " + (e && e.message ? e.message.split("\n")[0] : String(e)));
  }
}
process.on("exit", () => {
  if (failed > 0) process.exitCode = 1;
});

const { createStore, sha256Hex } = load("store.js");
const { hashPassword, verifyPassword, needsRehash } = load("passwords.js");
const { createSessions } = load("sessions.js");
const { createCsrf } = load("csrf.js");
const { createAuth } = load("login.js");
const { createGuard } = load("guard.js");
const { parseCookies, serializeCookie } = load("cookies.js");
const { createApp } = load("index.js");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const PW = "correct horse battery";
const SEED_HASH = hashPassword(PW); // one scrypt, reused for seeded users
const sha = (pw) => crypto.createHash("sha256").update(pw).digest("hex");
const mkScrypt = (n, r, p, saltHex, hashHex) => `scrypt$${n}$${r}$${p}$${saltHex}$${hashHex}`;
const attrs = (cookie) => new Set(cookie.split("; ").slice(1));

function setup(opts = {}) {
  const clock = { t: 1_700_000_000_000, now() { return this.t; } };
  const store = createStore();
  const events = [];
  const auth = createAuth({ store, now: () => clock.now(), csrfSecret: "test-secret", onEvent: (e) => events.push(e), ...opts });
  let n = 0;
  for (const name of ["alice", "bob"]) {
    store.users.set(name, { id: "u" + ++n, username: name, passwordHash: SEED_HASH, role: "user" });
  }
  return { clock, store, auth, events };
}
const wrong = (auth, user, ip, n = 1) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(auth.login(user, "nope-nope-nope", { ip }));
  return out;
};
const INVALID = { ok: false, error: "invalid_credentials" };

// ---------------------------------------------------------------- passwords
t("passwords: hashPassword format and real scrypt", () => {
  const h = hashPassword("pässword-1");
  assert.match(h, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  const [, , , , salt, hash] = h.split("$");
  const expected = crypto.scryptSync("pässword-1", Buffer.from(salt, "hex"), 32, { N: 16384, r: 8, p: 1 }).toString("hex");
  assert.equal(hash, expected);
});
t("passwords: per-call random salt", () => {
  const a = hashPassword("same-password");
  const b = hashPassword("same-password");
  assert.notEqual(a, b);
  assert.ok(verifyPassword("same-password", a) && verifyPassword("same-password", b));
});
t("passwords: hashPassword rejects non-strings", () => {
  assert.throws(() => hashPassword(12345678), TypeError);
  assert.throws(() => hashPassword(undefined), TypeError);
});
t("passwords: verify scrypt right and wrong", () => {
  assert.equal(verifyPassword(PW, SEED_HASH), true);
  assert.equal(verifyPassword(PW + "x", SEED_HASH), false);
  assert.equal(verifyPassword("", SEED_HASH), false);
});
t("passwords: verify legacy sha256 (lower and upper case hex)", () => {
  assert.equal(verifyPassword("old-pass", sha("old-pass")), true);
  assert.equal(verifyPassword("old-pass", sha("old-pass").toUpperCase()), true);
  assert.equal(verifyPassword("old-pasS", sha("old-pass")), false);
  assert.equal(verifyPassword("old-pass", sha("old-pass").slice(1)), false);
});
t("passwords: malformed stored values are false, never throw", () => {
  const salt = "00112233445566778899aabbccddeeff";
  const hash = "ab".repeat(32);
  const bad = [
    undefined, null, 42, "", "scrypt", "scrypt$16384$8$1$" + salt, "bcrypt$16384$8$1$" + salt + "$" + hash,
    mkScrypt(16384, 8, 1, salt + "0", hash), mkScrypt(16384, 8, 1, salt, hash.slice(0, 63)),
    mkScrypt(16384, 8, 1, salt, hash.slice(0, 62) + "zz"), mkScrypt(16384, 8, 1, "zz".repeat(16), hash),
    mkScrypt(16384, 8, 1, "0011223344556677".slice(0, 12), hash), mkScrypt(16384, 8, 1, salt, "ab".repeat(8)),
    mkScrypt(16384, 8, 1, salt, "ab".repeat(65)), mkScrypt(16384, 8, 1, "aa".repeat(65), hash),
    mkScrypt("16384x", 8, 1, salt, hash), mkScrypt(-16384, 8, 1, salt, hash), mkScrypt("1".repeat(400), 8, 1, salt, hash),
  ];
  for (const stored of bad) assert.equal(verifyPassword(PW, stored), false, String(stored).slice(0, 60));
  assert.equal(verifyPassword(undefined, SEED_HASH), false);
  assert.equal(verifyPassword(null, sha("x")), false);
});
t("passwords: out-of-range parameters rejected", () => {
  const salt = "00112233445566778899aabbccddeeff";
  const hash = "ab".repeat(32);
  for (const [n, r, p] of [[1048576, 8, 1], [512, 8, 1], [1000, 8, 1], [16384, 17, 1], [16384, 0, 1], [16384, 8, 5], [16384, 8, 0], [131072, 8, 1]]) {
    assert.equal(verifyPassword(PW, mkScrypt(n, r, p, salt, hash)), false, `${n}/${r}/${p}`);
  }
});
t("passwords: foreign in-range parameters verify (N=1024 and N=65536)", () => {
  for (const [n, r, p, len] of [[1024, 8, 1, 32], [65536, 8, 1, 32], [4096, 4, 2, 64], [2048, 8, 1, 16]]) {
    const salt = crypto.randomBytes(12);
    const key = crypto.scryptSync("foreign-pw", salt, len, { N: n, r, p, maxmem: 256 << 20 });
    const stored = mkScrypt(n, r, p, salt.toString("hex"), key.toString("hex"));
    assert.equal(verifyPassword("foreign-pw", stored), true, `${n}/${r}/${p}/${len}`);
    assert.equal(verifyPassword("foreign-pW", stored), false);
  }
});
t("passwords: needsRehash", () => {
  assert.equal(needsRehash(SEED_HASH), false);
  assert.equal(needsRehash(sha("x")), true);
  assert.equal(needsRehash(""), true);
  assert.equal(needsRehash(undefined), true);
  assert.equal(needsRehash("scrypt$garbage"), true);
  const salt = crypto.randomBytes(16);
  const k = (n, r, p, len) => crypto.scryptSync("x", salt, len, { N: n, r, p }).toString("hex");
  assert.equal(needsRehash(mkScrypt(1024, 8, 1, salt.toString("hex"), k(1024, 8, 1, 32))), true);
  assert.equal(needsRehash(mkScrypt(16384, 8, 2, salt.toString("hex"), k(16384, 8, 2, 32))), true);
  assert.equal(needsRehash(mkScrypt(16384, 8, 1, salt.toString("hex"), k(16384, 8, 1, 64))), true);
});
t("passwords: comparisons go through crypto.timingSafeEqual", () => {
  let before = tseCalls;
  verifyPassword("old-pass", sha("old-pass"));
  assert.ok(tseCalls > before, "legacy compare");
  before = tseCalls;
  verifyPassword(PW, SEED_HASH);
  assert.ok(tseCalls > before, "scrypt compare");
});

// ---------------------------------------------------------------- sessions
function mkSessions(opts = {}) {
  const clock = { t: 5_000_000 };
  const store = createStore();
  const s = createSessions({ store, now: () => clock.t, ...opts });
  return { clock, store, s };
}
t("sessions: token format, uniqueness, stored only as sha256 key", () => {
  const { store, s } = mkSessions();
  const tokens = Array.from({ length: 50 }, () => s.create("u1"));
  assert.equal(new Set(tokens).size, 50);
  for (const tok of tokens) {
    assert.match(tok, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(store.sessions.has(sha256Hex(tok)), "keyed by sha256");
    assert.ok(!store.sessions.has(tok), "no plaintext key");
  }
  const dump = JSON.stringify([...store.sessions]);
  for (const tok of tokens) assert.ok(!dump.includes(tok), "token material in store");
  for (const k of store.sessions.keys()) assert.match(k, /^[0-9a-f]{64}$/);
});
t("sessions: validate returns record, rejects junk", () => {
  const { clock, s } = mkSessions();
  const tok = s.create("u1");
  clock.t += 1000;
  assert.deepEqual(s.validate(tok), { userId: "u1", createdAt: 5_000_000, lastSeenAt: 5_001_000 });
  for (const bad of [undefined, null, 5, {}, "", "nope", tok + "x", tok.slice(1)]) assert.equal(s.validate(bad), null);
});
t("sessions: idle expiry boundary and sliding window", () => {
  const { clock, store, s } = mkSessions();
  const tok = s.create("u1");
  clock.t += 30 * MIN - 1;
  assert.ok(s.validate(tok), "just inside idle");
  clock.t += 30 * MIN - 1;
  assert.ok(s.validate(tok), "idle window slid");
  clock.t += 30 * MIN;
  assert.equal(s.validate(tok), null, "exactly idleMs");
  assert.equal(store.sessions.size, 0, "expired session deleted");
});
t("sessions: absolute expiry beats activity", () => {
  const { clock, store, s } = mkSessions();
  const tok = s.create("u1");
  const start = clock.t;
  for (let i = 0; i < 29; i++) {
    clock.t += 24 * MIN;
    assert.ok(s.validate(tok), "alive at +" + (i + 1) * 24 + "min");
  }
  clock.t = start + 12 * HOUR - 1;
  assert.ok(s.validate(tok), "1ms before absolute limit");
  clock.t = start + 12 * HOUR;
  assert.equal(s.validate(tok), null);
  assert.equal(store.sessions.size, 0);
});
t("sessions: custom idleMs/absoluteMs honored", () => {
  const { clock, s } = mkSessions({ idleMs: 1000, absoluteMs: 5000 });
  const tok = s.create("u1");
  clock.t += 999;
  assert.ok(s.validate(tok));
  clock.t += 1000;
  assert.equal(s.validate(tok), null);
});
t("sessions: rotate swaps token and keeps createdAt", () => {
  const { clock, s } = mkSessions();
  const old = s.create("u1");
  const start = clock.t;
  for (let i = 0; i < 24; i++) { clock.t = start + (i + 1) * 25 * MIN; s.validate(old); }
  const created = s.validate(old).createdAt;
  const fresh = s.rotate(old);
  assert.ok(fresh && fresh !== old);
  assert.equal(s.validate(old), null);
  assert.equal(s.validate(fresh).createdAt, created);
  clock.t = start + 12 * HOUR;
  assert.equal(s.validate(fresh), null, "rotation must not extend the absolute lifetime");
  assert.equal(s.rotate(fresh), null);
  assert.equal(s.rotate("junk"), null);
  assert.equal(s.rotate(undefined), null);
});
t("sessions: destroy and destroyAllForUser", () => {
  const { s, store } = mkSessions();
  const a1 = s.create("a"), a2 = s.create("a"), a3 = s.create("a"), b1 = s.create("b");
  s.destroy(a1);
  s.destroy("garbage");
  s.destroy(undefined);
  assert.equal(s.validate(a1), null);
  assert.equal(s.destroyAllForUser("a", a3), 1);
  assert.equal(s.validate(a2), null);
  assert.ok(s.validate(a3) && s.validate(b1));
  assert.equal(s.destroyAllForUser("a"), 1);
  assert.equal(store.sessions.size, 1);
});

// ---------------------------------------------------------------- csrf
t("csrf: secret validation", () => {
  for (const bad of [undefined, null, "", 12, Buffer.alloc(0), {}]) assert.throws(() => createCsrf(bad), TypeError);
  assert.doesNotThrow(() => createCsrf(Buffer.from("k")));
});
t("csrf: issued tokens are random, session- and secret-bound", () => {
  const c = createCsrf("s1");
  const a = c.issue("sess-A"), a2 = c.issue("sess-A");
  assert.notEqual(a, a2);
  assert.ok(c.verify("sess-A", a) && c.verify("sess-A", a2));
  assert.equal(c.verify("sess-B", a), false, "other session");
  assert.equal(createCsrf("s2").verify("sess-A", a), false, "other secret");
  assert.equal(c.verify("sess-A", sha256Hex("sess-A")), false);
  assert.throws(() => c.issue(undefined), TypeError);
  assert.throws(() => c.issue(""), TypeError);
});
t("csrf: tampered and garbage tokens rejected without throwing", () => {
  const c = createCsrf("s1");
  const tok = c.issue("sess-A");
  const flip = tok.slice(0, -1) + (tok.endsWith("A") ? "B" : "A");
  const [nonce, mac] = tok.split(".");
  for (const bad of [flip, tok.slice(0, -2), nonce, "." + mac, nonce + ".", nonce + "." + mac + ".x", "x" + nonce + "." + mac, "", ".", "a.b", undefined, null, 7, {}]) {
    assert.equal(c.verify("sess-A", bad), false, String(bad));
  }
  assert.equal(c.verify(undefined, tok), false);
  assert.equal(c.verify("", tok), false);
});
t("csrf: validate double-submit rules", () => {
  const c = createCsrf("s1");
  const a = c.issue("S"), b = c.issue("S"), other = c.issue("T");
  assert.equal(c.validate({ method: "POST", sessionToken: "S", cookie: a, header: a }), true);
  assert.equal(c.validate({ sessionToken: "S", cookie: a, header: a }), true, "default method POST");
  assert.equal(c.validate({ method: "POST", sessionToken: "S", cookie: a, header: b }), false, "two different valid tokens");
  assert.equal(c.validate({ method: "POST", sessionToken: "S", cookie: other, header: other }), false, "other session");
  assert.equal(c.validate({ method: "DELETE", sessionToken: "S", cookie: a }), false);
  assert.equal(c.validate({ method: "PUT", sessionToken: "S", header: a }), false);
  assert.equal(c.validate({ method: "POST", sessionToken: "S", cookie: undefined, header: undefined }), false);
  assert.equal(c.validate({ method: "POST", sessionToken: "S", cookie: "x", header: "x" }), false);
  for (const m of ["GET", "head", "Options"]) assert.equal(c.validate({ method: m, sessionToken: "S" }), true, m);
  assert.equal(c.validate({ method: "post", sessionToken: "S" }), false);
});
t("csrf: comparisons go through crypto.timingSafeEqual", () => {
  const c = createCsrf("s1");
  const a = c.issue("S");
  const before = tseCalls;
  c.validate({ method: "POST", sessionToken: "S", cookie: a, header: a });
  assert.ok(tseCalls - before >= 2, "cookie==header and mac compare");
});

// ---------------------------------------------------------------- cookies
t("cookies: parseCookies", () => {
  const c = parseCookies("sid=abc; csrf=x%20y;  theme = dark ; novalue; =orphan; sid=second; eq=a=b=c; bad=%E0%A4%A; __proto__=p");
  assert.equal(Object.getPrototypeOf(c), null);
  assert.equal(c.sid, "abc");
  assert.equal(c.csrf, "x y");
  assert.equal(c.theme, "dark");
  assert.equal(c.eq, "a=b=c");
  assert.equal(c.bad, "%E0%A4%A");
  assert.equal(Object.hasOwn(c, "novalue"), false);
  assert.equal(Object.hasOwn(c, ""), false);
  assert.equal(Object.getPrototypeOf(c), null);
  for (const h of [undefined, null, 5, "", ";;"]) assert.deepEqual(Object.keys(parseCookies(h)), []);
});
t("cookies: serializeCookie attributes and encoding", () => {
  const s = serializeCookie("sid", "tok", { httpOnly: true, maxAgeMs: 1999 });
  assert.ok(s.startsWith("sid=tok; "));
  assert.deepEqual(attrs(s), new Set(["Path=/", "Secure", "SameSite=Strict", "Max-Age=1", "HttpOnly"]));
  const c = serializeCookie("csrf", "v", {});
  assert.deepEqual(attrs(c), new Set(["Path=/", "Secure", "SameSite=Strict"]));
  assert.deepEqual(attrs(serializeCookie("x", "v", { maxAgeMs: -500 })), new Set(["Path=/", "Secure", "SameSite=Strict", "Max-Age=0"]));
  const evil = serializeCookie("x", "a; Max-Age=999\r\nSet-Cookie: y=1", { httpOnly: true });
  assert.ok(!/[\r\n]/.test(evil));
  assert.equal(evil.split("; ").length, 5, "value must not inject attributes");
  for (const bad of ["a b", "a;b", "", "a=b", "é", undefined]) assert.throws(() => serializeCookie(bad, "v"), TypeError, String(bad));
});

// ---------------------------------------------------------------- register / login basics
t("register: validation and public view", () => {
  const { auth, store } = setup();
  const u = auth.register("  Carol ", "longenough1");
  assert.deepEqual(Object.keys(u).sort(), ["id", "role", "username"]);
  assert.equal(u.username, "carol");
  assert.match(store.users.get("carol").passwordHash, /^scrypt\$16384\$8\$1\$/);
  assert.throws(() => auth.register("CAROL", "longenough1"), (e) => e instanceof Error && !(e instanceof TypeError) && !(e instanceof RangeError));
  assert.throws(() => auth.register("dave", "short"), RangeError);
  assert.throws(() => auth.register("dave", "longenough1", { role: "root" }), RangeError);
  assert.throws(() => auth.register("   ", "longenough1"), TypeError);
  assert.equal(auth.register("erin", "longenough1", { role: "admin" }).role, "admin");
});
t("login: success shape, no hash leak, case-insensitive", () => {
  const { auth } = setup();
  const r = auth.login(" ALICE", PW, { ip: "1.1.1.1" });
  assert.equal(r.ok, true);
  assert.match(r.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(auth.csrf.verify(r.token, r.csrfToken), true);
  assert.deepEqual(r.user, { id: "u1", username: "alice", role: "user" });
  assert.ok(!JSON.stringify(r).includes("scrypt$"), "hash leaked");
  assert.deepEqual(auth.authenticate(r.token), { id: "u1", username: "alice", role: "user" });
  assert.equal(auth.authenticate("nope"), null);
});
t("login: unknown user and wrong password are indistinguishable", () => {
  const { auth } = setup();
  assert.deepEqual(auth.login("alice", "nope-nope", { ip: "a" }), INVALID);
  assert.deepEqual(auth.login("ghost", "nope-nope", { ip: "b" }), INVALID);
  assert.deepEqual(auth.login("ghost", PW, { ip: "c" }), INVALID);
});
t("login: unknown user still pays for a password verification", () => {
  const { auth } = setup();
  const med = (user) => {
    const xs = [];
    for (let i = 0; i < 4; i++) {
      const t0 = process.hrtime.bigint();
      auth.login(user, "nope-nope-nope", { ip: "ip" + user + i });
      xs.push(Number(process.hrtime.bigint() - t0));
    }
    return xs.sort((x, y) => x - y)[1];
  };
  const known = med("alice");
  const unknown = med("ghost");
  assert.ok(unknown >= known * 0.3, `unknown ${unknown}ns vs known ${known}ns`);
});
t("login: non-string arguments are plain invalid credentials", () => {
  const { auth, events } = setup();
  for (const [u, p] of [[null, PW], ["alice", undefined], [{}, {}], [42, "x"], ["alice", ["a"]]]) {
    assert.deepEqual(auth.login(u, p, { ip: "z" }), INVALID);
  }
  assert.deepEqual(events, []);
});
t("login: each login opens a distinct session; no fixation", () => {
  const { auth, store } = setup();
  const a = auth.login("alice", PW, { ip: "i" });
  const b = auth.login("alice", PW, { ip: "i", token: a.token });
  assert.notEqual(a.token, b.token);
  assert.equal(auth.authenticate(a.token), null, "old token destroyed");
  assert.ok(auth.authenticate(b.token));
  const c = auth.login("alice", PW, { ip: "i" });
  assert.ok(auth.authenticate(b.token) && auth.authenticate(c.token), "plain login keeps other sessions");
  const other = auth.login("bob", PW, { ip: "i" });
  auth.login("alice", PW, { ip: "i", token: other.token });
  assert.equal(auth.authenticate(other.token), null, "any passed token is destroyed");
  assert.equal(store.sessions.size, 3);
});
t("login: failed login with a token leaves that session alone", () => {
  const { auth } = setup();
  const a = auth.login("alice", PW, { ip: "i" });
  auth.login("alice", "nope-nope", { ip: "i", token: a.token });
  assert.ok(auth.authenticate(a.token));
});

// ---------------------------------------------------------------- rehash
t("rehash: legacy sha256 upgraded after a successful login only", () => {
  const { auth, store } = setup();
  store.users.set("legacy", { id: "u9", username: "legacy", passwordHash: sha("old-pass-1"), role: "user" });
  assert.equal(auth.login("legacy", "wrong-wrong", { ip: "i" }).ok, false);
  assert.equal(store.users.get("legacy").passwordHash, sha("old-pass-1"), "failed login must not rehash");
  assert.equal(auth.login("legacy", "old-pass-1", { ip: "i" }).ok, true);
  const upgraded = store.users.get("legacy").passwordHash;
  assert.match(upgraded, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(verifyPassword("old-pass-1", upgraded));
  assert.equal(auth.login("legacy", "old-pass-1", { ip: "i" }).ok, true);
  assert.equal(store.users.get("legacy").passwordHash, upgraded, "current hashes are not re-hashed");
});
t("rehash: outdated scrypt parameters upgraded", () => {
  const { auth, store } = setup();
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync("old-pass-2", salt, 32, { N: 1024, r: 8, p: 1 });
  store.users.set("weak", { id: "u8", username: "weak", passwordHash: mkScrypt(1024, 8, 1, salt.toString("hex"), key.toString("hex")), role: "user" });
  assert.equal(auth.login("weak", "old-pass-2", { ip: "i" }).ok, true);
  assert.match(store.users.get("weak").passwordHash, /^scrypt\$16384\$8\$1\$/);
});
t("rehash: locked correct-password attempt does not rehash", () => {
  const { auth, store } = setup();
  store.users.set("legacy", { id: "u9", username: "legacy", passwordHash: sha("old-pass-1"), role: "user" });
  wrong(auth, "legacy", "i", 5);
  assert.equal(auth.login("legacy", "old-pass-1", { ip: "i" }).error, "locked");
  assert.equal(store.users.get("legacy").passwordHash, sha("old-pass-1"));
});

// ---------------------------------------------------------------- lockout
t("lockout: locks on the threshold-th failure, retryAfterMs exact", () => {
  const { auth, clock } = setup();
  const r = wrong(auth, "alice", "ip1", 5);
  for (const x of r) assert.deepEqual(x, INVALID);
  assert.deepEqual(auth.login("alice", "nope", { ip: "ip1" }), { ok: false, error: "locked", retryAfterMs: 1000 });
  clock.t += 999;
  assert.deepEqual(auth.login("alice", PW, { ip: "ip1" }), { ok: false, error: "locked", retryAfterMs: 1 });
  clock.t += 1;
  assert.equal(auth.login("alice", PW, { ip: "ip1" }).ok, true);
});
t("lockout: 4 failures do not lock", () => {
  const { auth } = setup();
  wrong(auth, "alice", "ip1", 4);
  assert.equal(auth.login("alice", PW, { ip: "ip1" }).ok, true);
});
t("lockout: attempts while locked neither extend nor count", () => {
  const { auth, clock } = setup();
  wrong(auth, "alice", "ip1", 5);
  for (let i = 0; i < 4; i++) {
    clock.t += 200;
    assert.equal(auth.login("alice", "nope", { ip: "ip1" }).error, "locked");
  }
  assert.deepEqual(auth.login("alice", "nope", { ip: "ip1" }), { ok: false, error: "locked", retryAfterMs: 200 });
  clock.t += 200;
  assert.deepEqual(auth.login("alice", "nope", { ip: "ip1" }), INVALID, "6th real failure");
  assert.deepEqual(auth.login("alice", "nope", { ip: "ip1" }), { ok: false, error: "locked", retryAfterMs: 2000 });
});
t("lockout: exponential backoff up to the cap", () => {
  const { auth, clock } = setup({ lockout: { resetMs: 1e12 } });
  wrong(auth, "alice", "ip1", 4);
  for (let n = 5; n <= 18; n++) {
    assert.deepEqual(wrong(auth, "alice", "ip1", 1)[0], INVALID, "failure #" + n);
    const expected = Math.min(1000 * 2 ** (n - 5), 900000);
    const r = auth.login("alice", PW, { ip: "ip1" });
    assert.deepEqual(r, { ok: false, error: "locked", retryAfterMs: expected }, "failure #" + n);
    clock.t += expected;
  }
});
t("lockout: per account and per IP", () => {
  const { auth } = setup();
  wrong(auth, "alice", "ip1", 5);
  assert.equal(auth.login("alice", "x", { ip: "ip1" }).error, "locked");
  assert.equal(auth.login("alice", PW, { ip: "ip2" }).ok, true, "other IP unaffected");
  assert.equal(auth.login("bob", PW, { ip: "ip1" }).ok, true, "other account unaffected");
  assert.equal(auth.login("alice", "x", { ip: undefined }).error, "invalid_credentials", "missing ip is its own bucket");
});
t("lockout: username normalized, missing ip shared", () => {
  const { auth } = setup();
  wrong(auth, "Alice", undefined, 2);
  wrong(auth, "ALICE ", "unknown", 2);
  wrong(auth, " alice", undefined, 1);
  assert.equal(auth.login("alice", PW).error, "locked");
});
t("lockout: unknown accounts behave exactly like real ones", () => {
  const real = setup();
  const ghost = setup();
  for (let i = 0; i < 8; i++) {
    const a = real.auth.login("alice", "nope-nope", { ip: "ip1" });
    const b = ghost.auth.login("ghost", "nope-nope", { ip: "ip1" });
    assert.deepEqual(a, b, "attempt " + (i + 1));
    real.clock.t += 700;
    ghost.clock.t += 700;
  }
  assert.equal(ghost.store.users.has("ghost"), false);
});
t("lockout: keys cannot collide through delimiters", () => {
  for (const d of ["|", ":", "/", ",", "\u0000", "@"]) {
    const { auth, store } = setup();
    store.users.set("a", { id: "ua", username: "a", passwordHash: SEED_HASH, role: "user" });
    wrong(auth, "a" + d + "b", "c", 5);
    assert.equal(auth.login("a" + d + "b", "x", { ip: "c" }).error, "locked");
    assert.equal(auth.login("a", PW, { ip: "b" + d + "c" }).ok, true, "delimiter " + JSON.stringify(d));
  }
});
t("lockout: success clears the counter", () => {
  const { auth } = setup();
  wrong(auth, "alice", "ip1", 4);
  assert.equal(auth.login("alice", PW, { ip: "ip1" }).ok, true);
  wrong(auth, "alice", "ip1", 4);
  assert.equal(auth.login("alice", PW, { ip: "ip1" }).ok, true, "4+4 failures with a success between");
});
t("lockout: counter restarts after resetMs of quiet", () => {
  const a = setup();
  wrong(a.auth, "alice", "ip1", 4);
  a.clock.t += 3600000 - 1;
  wrong(a.auth, "alice", "ip1", 1);
  assert.equal(a.auth.login("alice", PW, { ip: "ip1" }).error, "locked", "just inside reset window: 5th failure");
  const b = setup();
  wrong(b.auth, "alice", "ip1", 4);
  b.clock.t += 3600000;
  wrong(b.auth, "alice", "ip1", 4);
  assert.equal(b.auth.login("alice", PW, { ip: "ip1" }).ok, true, "reset window passed: fresh count");
});
t("lockout: config overrides", () => {
  const { auth, clock } = setup({ lockout: { threshold: 2, baseMs: 50, maxMs: 120 } });
  wrong(auth, "alice", "i", 2);
  assert.deepEqual(auth.login("alice", PW, { ip: "i" }), { ok: false, error: "locked", retryAfterMs: 50 });
  clock.t += 50;
  wrong(auth, "alice", "i", 1);
  assert.equal(auth.login("alice", PW, { ip: "i" }).retryAfterMs, 100);
  clock.t += 100;
  wrong(auth, "alice", "i", 1);
  assert.equal(auth.login("alice", PW, { ip: "i" }).retryAfterMs, 120, "capped");
});

// ---------------------------------------------------------------- sessions through auth
t("auth: idle and absolute expiry via injected clock", () => {
  const { auth, clock, store } = setup();
  const r = auth.login("alice", PW, { ip: "i" });
  clock.t += 29 * MIN;
  assert.ok(auth.authenticate(r.token));
  clock.t += 30 * MIN;
  assert.equal(auth.authenticate(r.token), null);
  assert.equal(store.sessions.size, 0);
  const r2 = auth.login("alice", PW, { ip: "i" });
  const start = clock.t;
  for (let i = 1; i <= 29; i++) {
    clock.t = start + i * 24 * MIN;
    assert.ok(auth.authenticate(r2.token), "step " + i);
  }
  clock.t = start + 12 * HOUR;
  assert.equal(auth.authenticate(r2.token), null);
});
t("auth: authenticate reads role live, drops sessions of deleted users", () => {
  const { auth, store } = setup();
  const r = auth.login("alice", PW, { ip: "i" });
  store.users.get("alice").role = "moderator";
  assert.equal(auth.authenticate(r.token).role, "moderator");
  store.users.delete("alice");
  assert.equal(auth.authenticate(r.token), null);
  assert.equal(store.sessions.size, 0);
});
t("auth: setRole rotates caller session and kills the user's others", () => {
  const { auth } = setup();
  const a1 = auth.login("alice", PW, { ip: "i" });
  const a2 = auth.login("alice", PW, { ip: "i" });
  const b1 = auth.login("bob", PW, { ip: "i" });
  const r = auth.setRole("Alice", "admin", { token: a1.token });
  assert.equal(r.ok, true);
  assert.ok(r.token && r.token !== a1.token);
  assert.equal(auth.authenticate(a1.token), null);
  assert.equal(auth.authenticate(a2.token), null);
  assert.deepEqual(auth.authenticate(r.token), { id: "u1", username: "alice", role: "admin" });
  assert.ok(auth.authenticate(b1.token), "other users untouched");
  assert.equal(auth.csrf.verify(r.token, r.csrfToken), true);
  assert.equal(auth.csrf.verify(a1.token, a1.csrfToken), true, "csrf helper itself is stateless");
  assert.equal(auth.csrf.verify(r.token, a1.csrfToken), false, "old csrf token not valid for new session");
});
t("auth: setRole without a matching caller session", () => {
  const { auth } = setup();
  const a1 = auth.login("alice", PW, { ip: "i" });
  const b1 = auth.login("bob", PW, { ip: "i" });
  const r = auth.setRole("alice", "admin", { token: b1.token });
  assert.deepEqual(r, { ok: true, token: null, csrfToken: null });
  assert.equal(auth.authenticate(a1.token), null);
  assert.ok(auth.authenticate(b1.token), "foreign token is not rotated or destroyed");
  const r2 = auth.setRole("alice", "user");
  assert.deepEqual(r2, { ok: true, token: null, csrfToken: null });
  assert.deepEqual(auth.setRole("nobody", "user"), { ok: false, error: "no_such_user" });
  assert.throws(() => auth.setRole("alice", "root"), RangeError);
});
t("auth: setRole with an expired caller token does not resurrect it", () => {
  const { auth, clock } = setup();
  const a1 = auth.login("alice", PW, { ip: "i" });
  clock.t += 31 * MIN;
  const r = auth.setRole("alice", "admin", { token: a1.token });
  assert.equal(r.token, null);
  assert.equal(auth.authenticate(a1.token), null);
});
t("auth: logout kills all sessions of the user", () => {
  const { auth } = setup();
  const a1 = auth.login("alice", PW, { ip: "i" });
  const a2 = auth.login("alice", PW, { ip: "i" });
  const b1 = auth.login("bob", PW, { ip: "i" });
  assert.equal(auth.logout(a1.token), true);
  assert.equal(auth.authenticate(a1.token), null);
  assert.equal(auth.authenticate(a2.token), null);
  assert.ok(auth.authenticate(b1.token));
  assert.equal(auth.logout(a1.token), false);
  for (const bad of ["garbage", undefined, null, 5]) assert.equal(auth.logout(bad), false);
  assert.ok(auth.authenticate(b1.token), "bad logouts change nothing");
});
t("auth: changePassword", () => {
  const { auth, store } = setup();
  const a1 = auth.login("alice", PW, { ip: "i" });
  const b1 = auth.login("bob", PW, { ip: "i" });
  assert.deepEqual(auth.changePassword("alice", "wrong-old", "brand-new-pw"), INVALID);
  assert.deepEqual(auth.changePassword("ghost", "wrong-old", "brand-new-pw"), INVALID);
  assert.deepEqual(auth.changePassword("alice", "wrong-old", "x"), INVALID, "wrong old beats weak new");
  assert.deepEqual(auth.changePassword(null, "a", "b"), INVALID);
  assert.deepEqual(auth.changePassword("alice", PW, "short"), { ok: false, error: "weak_password" });
  assert.ok(auth.authenticate(a1.token), "failed change keeps sessions");
  assert.deepEqual(auth.changePassword("alice", PW, "brand-new-pw"), { ok: true });
  assert.equal(auth.authenticate(a1.token), null);
  assert.ok(auth.authenticate(b1.token));
  assert.match(store.users.get("alice").passwordHash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(auth.login("alice", PW, { ip: "j" }).ok, false);
  assert.equal(auth.login("alice", "brand-new-pw", { ip: "j" }).ok, true);
});
t("auth: changePassword failures do not feed the login lockout", () => {
  const { auth } = setup();
  for (let i = 0; i < 6; i++) auth.changePassword("alice", "wrong-old", "brand-new-pw");
  assert.equal(auth.login("alice", PW, { ip: "i" }).ok, true);
});

// ---------------------------------------------------------------- events, guard, wiring
t("events: exact shapes, no secrets", () => {
  const { auth, events } = setup();
  auth.login("alice", "nope-nope-nope", { ip: "9.9.9.9" });
  wrong(auth, "ALICE", "9.9.9.9", 4);
  auth.login("alice", "nope-nope-nope", { ip: "9.9.9.9" });
  const ok = auth.login("alice", PW);
  auth.setRole("alice", "admin", { token: ok.token });
  const ok2 = auth.login("alice", PW);
  auth.changePassword("alice", PW, "brand-new-pw");
  const ok3 = auth.login("alice", "brand-new-pw");
  auth.logout(ok3.token);
  auth.logout(ok3.token);
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["login_failure", "login_failure", "login_failure", "login_failure", "login_failure", "login_locked", "login_success", "role_changed", "login_success", "password_changed", "login_success", "logout"]);
  assert.deepEqual(events[0], { type: "login_failure", username: "alice", ip: "9.9.9.9" });
  assert.deepEqual(events[5], { type: "login_locked", username: "alice", ip: "9.9.9.9" });
  assert.deepEqual(events[6], { type: "login_success", username: "alice", ip: "unknown" });
  assert.deepEqual(events[7], { type: "role_changed", username: "alice", role: "admin" });
  assert.deepEqual(events[9], { type: "password_changed", username: "alice" });
  assert.deepEqual(events[11], { type: "logout", username: "alice" });
  const dump = JSON.stringify(events);
  for (const secret of [PW, "nope-nope-nope", "brand-new-pw", ok.token, ok.csrfToken, ok2.token, ok3.token, "scrypt$"]) {
    assert.ok(!dump.includes(secret), "event leaks " + secret.slice(0, 8));
  }
});
t("guard: 401 / 403 / 200", () => {
  const { auth } = setup();
  const guard = createGuard(auth);
  const a = auth.login("alice", PW, { ip: "i" });
  const b = auth.login("bob", PW, { ip: "i" });
  const req = (method, sid, csrf, header) => ({ method, cookies: { sid, csrf }, headers: { "x-csrf-token": header } });
  assert.equal(guard(req("POST", undefined, a.csrfToken, a.csrfToken)).status, 401);
  assert.equal(guard(req("POST", "junk", a.csrfToken, a.csrfToken)).status, 401);
  const ok = guard(req("POST", a.token, a.csrfToken, a.csrfToken));
  assert.equal(ok.status, 200);
  assert.equal(ok.user.username, "alice");
  assert.equal(guard(req("POST", a.token, a.csrfToken, undefined)).status, 403);
  assert.equal(guard(req("POST", a.token, b.csrfToken, b.csrfToken)).status, 403, "token from another session");
  assert.equal(guard(req("GET", a.token, undefined, undefined)).status, 200);
});
t("index: createApp wires the stack end to end", () => {
  const app = createApp({ csrfSecret: "k", now: () => 1_700_000_000_000 });
  app.auth.register("zed", "longenough1");
  const r = app.auth.login("zed", "longenough1", { ip: "i" });
  assert.equal(r.ok, true);
  const header = app.cookies.parseCookies(`sid=${r.token}; csrf=${encodeURIComponent(r.csrfToken)}`);
  assert.equal(app.guard({ method: "POST", cookies: header, headers: { "x-csrf-token": r.csrfToken } }).status, 200);
  assert.ok(app.store.users.has("zed"));
});
