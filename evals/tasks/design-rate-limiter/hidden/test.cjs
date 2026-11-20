"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const ws = process.env.ACH_WORKSPACE || process.cwd();
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + ": " + (e && e.message ? e.message : String(e)));
  }
}
process.on("exit", () => {
  if (failed > 0) process.exitCode = 1;
});

const L = require(path.join(ws, "limiter.js"));
const clock = (start = 0) => {
  const c = { t: start, now: () => c.t };
  return c;
};
const R = (allowed, retryAfterMs, remaining) => ({ allowed, retryAfterMs, remaining });

t("bucket starts full and drains", () => {
  const c = clock();
  const b = L.tokenBucket({ capacity: 3, refillPerSec: 1, now: c.now });
  assert.deepEqual(b.tryAcquire("a"), R(true, 0, 2));
  assert.deepEqual(b.tryAcquire("a"), R(true, 0, 1));
  assert.deepEqual(b.tryAcquire("a"), R(true, 0, 0));
  assert.deepEqual(b.tryAcquire("a"), R(false, 1000, 0));
});
t("bucket retryAfter exact then allowed after waiting", () => {
  const c = clock(5000);
  const b = L.tokenBucket({ capacity: 2, refillPerSec: 4, now: c.now });
  b.tryAcquire("k", 2);
  assert.deepEqual(b.tryAcquire("k"), R(false, 250, 0));
  c.t += 249;
  assert.equal(b.tryAcquire("k").allowed, false);
  c.t += 1;
  assert.deepEqual(b.tryAcquire("k"), R(true, 0, 0));
});
t("bucket fractional refill keeps fractions", () => {
  const c = clock();
  const b = L.tokenBucket({ capacity: 4, refillPerSec: 2, now: c.now });
  b.tryAcquire("k", 4);
  c.t = 250; // 0.5
  assert.deepEqual(b.tryAcquire("k"), R(false, 250, 0));
  c.t = 500; // 1.0 (0.5 kept across the denied call)
  assert.deepEqual(b.tryAcquire("k"), R(true, 0, 0));
  c.t = 750; // 0.5
  assert.deepEqual(b.peek("k", 2), R(false, 750, 0));
  c.t = 1250; // 1.5 -> remaining floor 1 on a cost-0.5? use cost 1
  assert.deepEqual(b.tryAcquire("k"), R(true, 0, 0));
});
t("bucket fractional cost", () => {
  const c = clock();
  const b = L.tokenBucket({ capacity: 2, refillPerSec: 1, now: c.now });
  assert.deepEqual(b.tryAcquire("k", 0.5), R(true, 0, 1));
  assert.deepEqual(b.tryAcquire("k", 1.5), R(true, 0, 0));
  assert.deepEqual(b.tryAcquire("k", 0.5), R(false, 500, 0));
});
t("bucket refill capped at capacity", () => {
  const c = clock();
  const b = L.tokenBucket({ capacity: 2, refillPerSec: 10, now: c.now });
  b.tryAcquire("k", 2);
  c.t = 1e6;
  assert.deepEqual(b.tryAcquire("k", 2), R(true, 0, 0));
  assert.equal(b.tryAcquire("k").allowed, false);
});
t("bucket cost above capacity is Infinity and consumes nothing", () => {
  const c = clock();
  const b = L.tokenBucket({ capacity: 3, refillPerSec: 1, now: c.now });
  assert.deepEqual(b.tryAcquire("k", 4), R(false, Infinity, 3));
  assert.deepEqual(b.tryAcquire("k", 3), R(true, 0, 0));
  assert.deepEqual(b.tryAcquire("k", 3.5), R(false, Infinity, 0));
});
t("bucket cost equal to capacity waits for full refill", () => {
  const c = clock();
  const b = L.tokenBucket({ capacity: 3, refillPerSec: 1, now: c.now });
  b.tryAcquire("k", 3);
  assert.deepEqual(b.tryAcquire("k", 3), R(false, 3000, 0));
});
t("bucket per-key isolation", () => {
  const c = clock();
  const b = L.tokenBucket({ capacity: 1, refillPerSec: 1, now: c.now });
  assert.equal(b.tryAcquire("a").allowed, true);
  assert.equal(b.tryAcquire("a").allowed, false);
  assert.equal(b.tryAcquire("b").allowed, true);
  const o = {};
  assert.equal(b.tryAcquire(o).allowed, true);
  assert.equal(b.tryAcquire(o).allowed, false);
  assert.equal(b.tryAcquire({}).allowed, true);
});
t("peek never consumes (all strategies)", () => {
  const c = clock();
  const ls = [
    L.tokenBucket({ capacity: 1, refillPerSec: 1, now: c.now }),
    L.slidingWindowLog({ limit: 1, windowMs: 1000, now: c.now }),
    L.fixedWindow({ limit: 1, windowMs: 1000, now: c.now }),
  ];
  for (const l of ls) {
    for (let i = 0; i < 3; i++) assert.deepEqual(l.peek("k"), R(true, 0, 0));
    assert.deepEqual(l.tryAcquire("k"), R(true, 0, 0));
    assert.equal(l.peek("k").allowed, false);
    assert.equal(l.tryAcquire("k").allowed, false);
  }
});
t("sliding log basic and boundary expiry", () => {
  const c = clock(1000);
  const s = L.slidingWindowLog({ limit: 2, windowMs: 100, now: c.now });
  assert.deepEqual(s.tryAcquire("k"), R(true, 0, 1));
  c.t = 1040;
  assert.deepEqual(s.tryAcquire("k"), R(true, 0, 0));
  c.t = 1050;
  assert.deepEqual(s.tryAcquire("k"), R(false, 50, 0));
  c.t = 1099;
  assert.deepEqual(s.tryAcquire("k"), R(false, 1, 0));
  c.t = 1100; // first entry expires exactly now
  assert.deepEqual(s.tryAcquire("k"), R(true, 0, 0));
});
t("sliding log denied calls are not logged", () => {
  const c = clock();
  const s = L.slidingWindowLog({ limit: 1, windowMs: 100, now: c.now });
  s.tryAcquire("k");
  c.t = 60;
  assert.equal(s.tryAcquire("k").allowed, false);
  c.t = 100;
  assert.deepEqual(s.tryAcquire("k"), R(true, 0, 0));
});
t("sliding log weighted costs: retry waits for enough entries", () => {
  const c = clock();
  const s = L.slidingWindowLog({ limit: 5, windowMs: 100, now: c.now });
  assert.deepEqual(s.tryAcquire("k", 2), R(true, 0, 3)); // t=0
  c.t = 10;
  assert.deepEqual(s.tryAcquire("k", 1), R(true, 0, 2)); // t=10
  c.t = 20;
  assert.deepEqual(s.tryAcquire("k", 2), R(true, 0, 0)); // t=20
  c.t = 30;
  assert.deepEqual(s.tryAcquire("k", 1), R(false, 70, 0)); // frees 2 at t=100
  assert.deepEqual(s.tryAcquire("k", 3), R(false, 80, 0)); // needs the t=0 and t=10 entries to expire
});
t("sliding log needs several expiries", () => {
  const c = clock();
  const s = L.slidingWindowLog({ limit: 5, windowMs: 100, now: c.now });
  s.tryAcquire("k", 2);
  c.t = 10;
  s.tryAcquire("k", 1);
  c.t = 20;
  s.tryAcquire("k", 2);
  c.t = 30;
  assert.deepEqual(s.peek("k", 3), R(false, 80, 0));
  assert.deepEqual(s.peek("k", 5), R(false, 90, 0));
  c.t = 110;
  assert.deepEqual(s.peek("k", 3), R(true, 0, 0));
});
t("sliding log cost above limit", () => {
  const c = clock();
  const s = L.slidingWindowLog({ limit: 3, windowMs: 100, now: c.now });
  s.tryAcquire("k", 1);
  assert.deepEqual(s.tryAcquire("k", 4), R(false, Infinity, 2));
  assert.deepEqual(s.tryAcquire("k", 2), R(true, 0, 0));
});
t("sliding log per-key isolation", () => {
  const c = clock();
  const s = L.slidingWindowLog({ limit: 1, windowMs: 100, now: c.now });
  s.tryAcquire("a");
  assert.equal(s.tryAcquire("a").allowed, false);
  assert.equal(s.tryAcquire("b").allowed, true);
});
t("fixed window basic and reset at boundary", () => {
  const c = clock(1250);
  const f = L.fixedWindow({ limit: 2, windowMs: 1000, now: c.now });
  assert.deepEqual(f.tryAcquire("k"), R(true, 0, 1));
  assert.deepEqual(f.tryAcquire("k"), R(true, 0, 0));
  assert.deepEqual(f.tryAcquire("k"), R(false, 750, 0));
  c.t = 1999;
  assert.deepEqual(f.tryAcquire("k"), R(false, 1, 0));
  c.t = 2000;
  assert.deepEqual(f.tryAcquire("k"), R(true, 0, 1));
});
t("fixed window boundary burst allowed (aligned windows)", () => {
  const c = clock(999);
  const f = L.fixedWindow({ limit: 2, windowMs: 1000, now: c.now });
  f.tryAcquire("k", 2);
  c.t = 1000;
  assert.deepEqual(f.tryAcquire("k", 2), R(true, 0, 0));
});
t("fixed window costs, denied not counted, Infinity", () => {
  const c = clock();
  const f = L.fixedWindow({ limit: 5, windowMs: 100, now: c.now });
  assert.deepEqual(f.tryAcquire("k", 3), R(true, 0, 2));
  assert.deepEqual(f.tryAcquire("k", 3), R(false, 100, 2));
  assert.deepEqual(f.tryAcquire("k", 2), R(true, 0, 0));
  assert.deepEqual(f.tryAcquire("k", 6), R(false, Infinity, 0));
  c.t = 100;
  assert.deepEqual(f.tryAcquire("k", 6), R(false, Infinity, 5));
});
t("fixed window skipping windows and key isolation", () => {
  const c = clock();
  const f = L.fixedWindow({ limit: 1, windowMs: 10, now: c.now });
  f.tryAcquire("a");
  c.t = 95;
  assert.equal(f.tryAcquire("a").allowed, true);
  assert.equal(f.tryAcquire("b").allowed, true);
  assert.deepEqual(f.tryAcquire("a"), R(false, 5, 0));
});
t("default clock is Date.now", () => {
  const f = L.fixedWindow({ limit: 1, windowMs: 3600000 });
  assert.equal(f.tryAcquire("k").allowed, true);
});

function stub(name, log, result) {
  return {
    peek: (k, c) => (log.push("peek:" + name), typeof result === "function" ? result(true) : result),
    tryAcquire: (k, c) => (log.push("acq:" + name), typeof result === "function" ? result(false) : result),
  };
}
t("all: allows and consumes from every limiter", () => {
  const c = clock();
  const a = L.tokenBucket({ capacity: 3, refillPerSec: 1, now: c.now });
  const b = L.fixedWindow({ limit: 2, windowMs: 1000, now: c.now });
  const both = L.all([a, b]);
  assert.deepEqual(both.tryAcquire("k"), R(true, 0, 1));
  assert.deepEqual(a.peek("k"), R(true, 0, 1));
  assert.deepEqual(b.peek("k"), R(true, 0, 0));
});
t("all: denial consumes from none (earlier limiter untouched)", () => {
  const c = clock();
  const a = L.tokenBucket({ capacity: 5, refillPerSec: 1, now: c.now });
  const b = L.fixedWindow({ limit: 1, windowMs: 1000, now: c.now });
  const both = L.all([a, b]);
  assert.equal(both.tryAcquire("k").allowed, true);
  for (let i = 0; i < 3; i++) assert.equal(both.tryAcquire("k").allowed, false);
  assert.deepEqual(a.peek("k"), R(true, 0, 3));
});
t("all: denial when the first limiter denies leaves later ones untouched", () => {
  const c = clock();
  const a = L.fixedWindow({ limit: 1, windowMs: 1000, now: c.now });
  const b = L.slidingWindowLog({ limit: 5, windowMs: 1000, now: c.now });
  const both = L.all([a, b]);
  both.tryAcquire("k");
  both.tryAcquire("k");
  both.tryAcquire("k");
  assert.deepEqual(b.peek("k"), R(true, 0, 3));
});
t("all: tryAcquire is never called on any limiter when one denies", () => {
  const log = [];
  const combo = L.all([stub("a", log, R(true, 0, 5)), stub("b", log, R(false, 40, 0)), stub("c", log, R(true, 0, 2))]);
  assert.deepEqual(combo.tryAcquire("k"), R(false, 40, 0));
  assert.deepEqual(log, ["peek:a", "peek:b", "peek:c"]);
});
t("all: when allowed, peeks first then acquires in order", () => {
  const log = [];
  const combo = L.all([stub("a", log, R(true, 0, 5)), stub("b", log, R(true, 0, 2))]);
  assert.deepEqual(combo.tryAcquire("k"), R(true, 0, 2));
  assert.deepEqual(log, ["peek:a", "peek:b", "acq:a", "acq:b"]);
});
t("all: retryAfter is max of denying limiters, Infinity wins", () => {
  const c = clock();
  const a = L.fixedWindow({ limit: 1, windowMs: 1000, now: c.now });
  const b = L.tokenBucket({ capacity: 4, refillPerSec: 1, now: c.now });
  const both = L.all([a, b]);
  both.tryAcquire("k", 1);
  assert.deepEqual(both.tryAcquire("k", 1), R(false, 1000, 0));
  const s = L.slidingWindowLog({ limit: 10, windowMs: 5000, now: c.now });
  const three = L.all([a, b, s]);
  assert.equal(three.tryAcquire("z", 5).retryAfterMs, Infinity);
  const d = L.all([L.fixedWindow({ limit: 9, windowMs: 100, now: c.now }), L.tokenBucket({ capacity: 9, refillPerSec: 1, now: c.now })]);
  d.tryAcquire("k", 9);
  assert.equal(d.tryAcquire("k", 1).retryAfterMs, 1000);
});
t("all: remaining is the minimum and peek is read-only", () => {
  const c = clock();
  const a = L.tokenBucket({ capacity: 10, refillPerSec: 1, now: c.now });
  const b = L.fixedWindow({ limit: 3, windowMs: 1000, now: c.now });
  const both = L.all([a, b]);
  assert.deepEqual(both.peek("k"), R(true, 0, 2));
  assert.deepEqual(both.peek("k"), R(true, 0, 2));
  assert.deepEqual(both.tryAcquire("k"), R(true, 0, 2));
  assert.deepEqual(both.tryAcquire("k", 2), R(true, 0, 0));
});
t("all: nesting and per-key isolation", () => {
  const c = clock();
  const inner = L.all([L.fixedWindow({ limit: 1, windowMs: 1000, now: c.now }), L.tokenBucket({ capacity: 5, refillPerSec: 1, now: c.now })]);
  const outer = L.all([inner, L.slidingWindowLog({ limit: 5, windowMs: 1000, now: c.now })]);
  assert.equal(outer.tryAcquire("a").allowed, true);
  assert.equal(outer.tryAcquire("a").allowed, false);
  assert.equal(outer.tryAcquire("b").allowed, true);
  assert.deepEqual(outer.peek("a"), R(false, 1000, 0));
});
t("all: invalid cost propagates RangeError without consuming", () => {
  const c = clock();
  const a = L.tokenBucket({ capacity: 5, refillPerSec: 1, now: c.now });
  const both = L.all([a]);
  assert.throws(() => both.tryAcquire("k", -1), RangeError);
  assert.deepEqual(a.peek("k"), R(true, 0, 4));
});
t("validation: constructors", () => {
  const bad = [
    () => L.tokenBucket({ capacity: 0, refillPerSec: 1 }),
    () => L.tokenBucket({ capacity: -1, refillPerSec: 1 }),
    () => L.tokenBucket({ capacity: Infinity, refillPerSec: 1 }),
    () => L.tokenBucket({ capacity: 1, refillPerSec: 0 }),
    () => L.tokenBucket({ capacity: 1, refillPerSec: NaN }),
    () => L.tokenBucket({ capacity: "3", refillPerSec: 1 }),
    () => L.tokenBucket({ capacity: 1, refillPerSec: 1, now: 5 }),
    () => L.tokenBucket(),
    () => L.slidingWindowLog({ limit: 0, windowMs: 10 }),
    () => L.slidingWindowLog({ limit: 1.5, windowMs: 10 }),
    () => L.slidingWindowLog({ limit: 1, windowMs: 0 }),
    () => L.slidingWindowLog({ limit: 1, windowMs: Infinity }),
    () => L.fixedWindow({ limit: -2, windowMs: 10 }),
    () => L.fixedWindow({ limit: 2, windowMs: -10 }),
    () => L.fixedWindow({ limit: 2, windowMs: 10, now: "x" }),
    () => L.all([]),
    () => L.all(null),
    () => L.all({ length: 1 }),
  ];
  bad.forEach((f, i) => assert.throws(f, RangeError, "case " + i));
});
t("validation: cost", () => {
  const c = clock();
  const b = L.tokenBucket({ capacity: 5, refillPerSec: 1, now: c.now });
  for (const x of [0, -1, NaN, Infinity, "2", null]) assert.throws(() => b.tryAcquire("k", x), RangeError, String(x));
  assert.throws(() => b.peek("k", 0), RangeError);
  assert.deepEqual(b.tryAcquire("k", undefined), R(true, 0, 4));
  for (const l of [L.slidingWindowLog({ limit: 5, windowMs: 10, now: c.now }), L.fixedWindow({ limit: 5, windowMs: 10, now: c.now })]) {
    assert.throws(() => l.tryAcquire("k", 1.5), RangeError);
    assert.throws(() => l.peek("k", 0), RangeError);
    assert.deepEqual(l.tryAcquire("k"), R(true, 0, 4));
  }
});
process.exitCode = failed ? 1 : 0;
