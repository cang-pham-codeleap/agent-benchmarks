"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const ws = process.env.ACH_WORKSPACE || process.cwd();
let failed = 0;
function t(name, fn) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.message ? e.message : String(e))); }
}
process.on("exit", () => { if (failed > 0) process.exitCode = 1; });

const { createToaster } = require(path.join(ws, "toasts.js"));

function env(opts = {}) {
  let time = 0, next = 1;
  const timers = new Map();
  const e = {
    set: 0, cleared: 0,
    tick(ms) {
      const target = time + ms;
      for (;;) {
        let best = null;
        for (const [h, x] of timers) if (x.at <= target && (!best || x.at < best.x.at)) best = { h, x };
        if (!best) break;
        timers.delete(best.h);
        time = best.x.at;
        best.x.fn();
      }
      time = target;
    },
    pending: () => timers.size,
  };
  e.toaster = createToaster({
    now: () => time,
    setTimer: (fn, ms) => { e.set++; const h = next++; timers.set(h, { fn, at: time + ms }); return h; },
    clearTimer: (h) => { e.cleared++; timers.delete(h); },
    ...opts,
  });
  return e;
}
const ids = (arr) => arr.map((x) => x.id);

t("auto dismiss after duration", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m" });
  e.tick(4999);
  assert.deepEqual(ids(e.toaster.visible()), ["a"]);
  e.tick(1);
  assert.deepEqual(ids(e.toaster.visible()), []);
});
t("show returns id, generates unique ids", () => {
  const e = env();
  const a = e.toaster.show({ message: "x" }), b = e.toaster.show({ message: "x" });
  assert.equal(typeof a, "string");
  assert.notEqual(a, b);
  assert.equal(e.toaster.show({ id: "z", message: "x" }), "z");
  assert.equal(e.toaster.visible().length, 3);
});
t("defaults and snapshot shape", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "hi" });
  assert.deepEqual(e.toaster.visible()[0], {
    id: "a", message: "hi", kind: "info", count: 1, durationMs: 5000, paused: false,
    remainingMs: 5000, role: "status", ariaLive: "polite", animate: true,
  });
});
t("validation", () => {
  const e = env();
  assert.throws(() => e.toaster.show({ message: "x", kind: "fatal" }), RangeError);
  assert.throws(() => e.toaster.show({ message: "" }), TypeError);
  assert.throws(() => e.toaster.show({ message: 5 }), TypeError);
  assert.throws(() => e.toaster.show({ message: "x", durationMs: 0 }), RangeError);
  assert.throws(() => e.toaster.show({ message: "x", durationMs: -1 }), RangeError);
  assert.throws(() => e.toaster.show({ message: "x", durationMs: Infinity }), RangeError);
  assert.throws(() => e.toaster.show({ message: "x", durationMs: NaN }), RangeError);
  assert.equal(e.toaster.visible().length, 0);
  assert.equal(e.pending(), 0);
  for (const m of [0, -1, 1.5, "3", NaN]) assert.throws(() => env({ maxVisible: m }), RangeError, String(m));
});
t("invalid reshow does not mutate", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m" });
  assert.throws(() => e.toaster.show({ id: "a", message: "m", kind: "bad" }), RangeError);
  assert.equal(e.toaster.visible()[0].count, 1);
});
t("error never auto-dismisses, sets no timer", () => {
  const e = env();
  e.toaster.show({ id: "e", message: "boom", kind: "error", durationMs: 10 });
  assert.equal(e.set, 0);
  e.tick(1e9);
  assert.deepEqual(ids(e.toaster.visible()), ["e"]);
  assert.equal(e.toaster.visible()[0].remainingMs, null);
});
t("role and aria-live mapping", () => {
  const e = env();
  for (const k of ["info", "success", "warning"]) {
    e.toaster.show({ id: k, message: "m", kind: k });
  }
  for (const s of e.toaster.visible()) {
    assert.equal(s.role, "status"); assert.equal(s.ariaLive, "polite");
    assert.deepEqual(e.toaster.liveRegionProps(s), { role: "status", "aria-live": "polite", "aria-atomic": "true" });
  }
  e.toaster.show({ id: "e", message: "m", kind: "error" });
  const s = e.toaster.queued()[0];
  assert.equal(s.role, "alert"); assert.equal(s.ariaLive, "assertive");
  assert.deepEqual(e.toaster.liveRegionProps(s), { role: "alert", "aria-live": "assertive", "aria-atomic": "true" });
  assert.deepEqual(e.toaster.liveRegionProps({ kind: "error" }), { role: "alert", "aria-live": "assertive", "aria-atomic": "true" });
  assert.throws(() => e.toaster.liveRegionProps({ kind: "nope" }), RangeError);
});
t("reduced motion flag", () => {
  const e = env({ prefersReducedMotion: true });
  e.toaster.show({ id: "a", message: "m" });
  assert.equal(e.toaster.visible()[0].animate, false);
  const f = env({ maxVisible: 1 });
  f.toaster.show({ id: "a", message: "m" });
  f.toaster.show({ id: "b", message: "m" });
  assert.equal(f.toaster.visible()[0].animate, true);
  assert.equal(f.toaster.queued()[0].animate, true);
});
t("queue beyond maxVisible, default 3", () => {
  const e = env();
  for (const i of ["a", "b", "c", "d", "e"]) e.toaster.show({ id: i, message: "m" });
  assert.deepEqual(ids(e.toaster.visible()), ["a", "b", "c"]);
  assert.deepEqual(ids(e.toaster.queued()), ["d", "e"]);
  assert.equal(e.pending(), 3);
});
t("queued countdown starts at promotion with full duration", () => {
  const e = env({ maxVisible: 1 });
  e.toaster.show({ id: "a", message: "m", durationMs: 1000 });
  e.toaster.show({ id: "b", message: "m", durationMs: 3000 });
  assert.equal(e.toaster.queued()[0].remainingMs, 3000);
  e.tick(1000);
  assert.deepEqual(ids(e.toaster.visible()), ["b"]);
  e.tick(2999);
  assert.deepEqual(ids(e.toaster.visible()), ["b"]);
  e.tick(1);
  assert.deepEqual(ids(e.toaster.visible()), []);
});
t("errors jump ahead of queued non-errors, FIFO among errors", () => {
  const e = env({ maxVisible: 1 });
  e.toaster.show({ id: "v", message: "m" });
  e.toaster.show({ id: "n1", message: "m" });
  e.toaster.show({ id: "n2", message: "m", kind: "warning" });
  e.toaster.show({ id: "e1", message: "m", kind: "error" });
  e.toaster.show({ id: "n3", message: "m" });
  e.toaster.show({ id: "e2", message: "m", kind: "error" });
  assert.deepEqual(ids(e.toaster.queued()), ["e1", "e2", "n1", "n2", "n3"]);
});
t("error does not evict a visible toast", () => {
  const e = env({ maxVisible: 1 });
  e.toaster.show({ id: "v", message: "m" });
  e.toaster.show({ id: "e", message: "m", kind: "error" });
  assert.deepEqual(ids(e.toaster.visible()), ["v"]);
  e.tick(5000);
  assert.deepEqual(ids(e.toaster.visible()), ["e"]);
});
t("error takes a free slot immediately", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m" });
  e.toaster.show({ id: "e", message: "m", kind: "error" });
  assert.deepEqual(ids(e.toaster.visible()), ["a", "e"]);
});
t("dismiss promotes head of queue, appended last", () => {
  const e = env({ maxVisible: 2 });
  for (const i of ["a", "b", "c", "d"]) e.toaster.show({ id: i, message: "m" });
  assert.equal(e.toaster.dismiss("a"), true);
  assert.deepEqual(ids(e.toaster.visible()), ["b", "c"]);
  assert.deepEqual(ids(e.toaster.queued()), ["d"]);
  assert.equal(e.toaster.dismiss("b"), true);
  assert.deepEqual(ids(e.toaster.visible()), ["c", "d"]);
});
t("dismiss clears timer; unknown id false", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m" });
  assert.equal(e.toaster.dismiss("a"), true);
  assert.equal(e.pending(), 0);
  assert.equal(e.toaster.dismiss("a"), false);
  assert.equal(e.toaster.dismiss("zzz"), false);
});
t("dismiss a queued toast", () => {
  const e = env({ maxVisible: 1 });
  e.toaster.show({ id: "a", message: "m" });
  e.toaster.show({ id: "b", message: "m" });
  e.toaster.show({ id: "c", message: "m" });
  assert.equal(e.toaster.dismiss("b"), true);
  assert.deepEqual(ids(e.toaster.queued()), ["c"]);
  assert.deepEqual(ids(e.toaster.visible()), ["a"]);
});
t("dismiss error promotes next", () => {
  const e = env({ maxVisible: 1 });
  e.toaster.show({ id: "e", message: "m", kind: "error" });
  e.toaster.show({ id: "n", message: "m" });
  e.toaster.dismiss("e");
  assert.deepEqual(ids(e.toaster.visible()), ["n"]);
  assert.equal(e.pending(), 1);
});
t("dedupe: count bumps, no duplicate, fields updated", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "one", durationMs: 1000 });
  e.toaster.show({ id: "a", message: "two", kind: "success", durationMs: 2000 });
  const v = e.toaster.visible();
  assert.equal(v.length, 1);
  assert.equal(v[0].count, 2);
  assert.equal(v[0].message, "two");
  assert.equal(v[0].kind, "success");
  assert.equal(v[0].durationMs, 2000);
  e.toaster.show({ id: "a", message: "two" });
  assert.equal(e.toaster.visible()[0].count, 3);
});
t("dedupe restarts timer with full new duration", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m", durationMs: 1000 });
  e.tick(900);
  e.toaster.show({ id: "a", message: "m", durationMs: 1000 });
  assert.equal(e.pending(), 1);
  e.tick(999);
  assert.equal(e.toaster.visible().length, 1);
  e.tick(1);
  assert.equal(e.toaster.visible().length, 0);
});
t("dedupe keeps visible position", () => {
  const e = env();
  for (const i of ["a", "b", "c"]) e.toaster.show({ id: i, message: "m" });
  e.toaster.show({ id: "a", message: "again" });
  assert.deepEqual(ids(e.toaster.visible()), ["a", "b", "c"]);
});
t("dedupe visible -> error clears timer, never dismisses", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m", durationMs: 1000 });
  e.toaster.show({ id: "a", message: "m", kind: "error" });
  assert.equal(e.pending(), 0);
  e.tick(1e6);
  assert.deepEqual(ids(e.toaster.visible()), ["a"]);
  assert.equal(e.toaster.visible()[0].role, "alert");
});
t("dedupe error -> info starts countdown", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m", kind: "error" });
  e.toaster.show({ id: "a", message: "m", kind: "info", durationMs: 700 });
  e.tick(700);
  assert.equal(e.toaster.visible().length, 0);
});
t("dedupe of queued keeps position and bumps count", () => {
  const e = env({ maxVisible: 1 });
  for (const i of ["v", "x", "y", "z"]) e.toaster.show({ id: i, message: "m" });
  e.toaster.show({ id: "y", message: "again" });
  assert.deepEqual(ids(e.toaster.queued()), ["x", "y", "z"]);
  assert.equal(e.toaster.queued()[1].count, 2);
  assert.equal(e.toaster.queued()[1].message, "again");
  assert.equal(e.toaster.visible()[0].count, 1);
});
t("queued non-error reshown as error is re-inserted by error rule", () => {
  const e = env({ maxVisible: 1 });
  for (const i of ["v", "x", "y", "z"]) e.toaster.show({ id: i, message: "m" });
  e.toaster.show({ id: "e1", message: "m", kind: "error" });
  e.toaster.show({ id: "z", message: "m", kind: "error" });
  assert.deepEqual(ids(e.toaster.queued()), ["e1", "z", "x", "y"]);
  assert.equal(e.toaster.queued()[1].count, 2);
});
t("queued error reshown as error keeps its place", () => {
  const e = env({ maxVisible: 1 });
  e.toaster.show({ id: "v", message: "m" });
  e.toaster.show({ id: "e1", message: "m", kind: "error" });
  e.toaster.show({ id: "e2", message: "m", kind: "error" });
  e.toaster.show({ id: "e1", message: "m2", kind: "error" });
  assert.deepEqual(ids(e.toaster.queued()), ["e1", "e2"]);
  e.toaster.show({ id: "e2", message: "m", kind: "error" });
  assert.deepEqual(ids(e.toaster.queued()), ["e1", "e2"]);
});
t("dismissed id returns as brand new", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m" });
  e.toaster.show({ id: "a", message: "m" });
  e.toaster.dismiss("a");
  e.toaster.show({ id: "a", message: "m" });
  assert.equal(e.toaster.visible()[0].count, 1);
});
t("pause keeps remaining time exactly, resume continues", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m", durationMs: 1000 });
  e.tick(300);
  assert.equal(e.toaster.pause("a"), true);
  assert.equal(e.pending(), 0);
  e.tick(100000);
  assert.deepEqual(ids(e.toaster.visible()), ["a"]);
  const s = e.toaster.visible()[0];
  assert.equal(s.paused, true);
  assert.equal(s.remainingMs, 700);
  assert.equal(e.toaster.resume("a"), true);
  assert.equal(e.toaster.visible()[0].paused, false);
  e.tick(699);
  assert.deepEqual(ids(e.toaster.visible()), ["a"]);
  e.tick(1);
  assert.deepEqual(ids(e.toaster.visible()), []);
});
t("repeated pause/resume neither loses nor adds time", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m", durationMs: 1000 });
  e.tick(100);
  e.toaster.pause("a"); e.tick(50); e.toaster.resume("a");
  e.tick(200);
  e.toaster.pause("a"); e.tick(7777); e.toaster.resume("a");
  assert.equal(e.toaster.visible()[0].remainingMs, 700);
  e.tick(100);
  e.toaster.pause("a"); e.toaster.resume("a");
  e.tick(599);
  assert.equal(e.toaster.visible().length, 1);
  e.tick(1);
  assert.equal(e.toaster.visible().length, 0);
});
t("pause/resume return values", () => {
  const e = env({ maxVisible: 1 });
  e.toaster.show({ id: "a", message: "m" });
  e.toaster.show({ id: "q", message: "m" });
  e.toaster.show({ id: "e", message: "m", kind: "error" });
  assert.equal(e.toaster.pause("nope"), false);
  assert.equal(e.toaster.pause("q"), false);
  assert.equal(e.toaster.resume("a"), false);
  assert.equal(e.toaster.pause("a"), true);
  assert.equal(e.toaster.pause("a"), false);
  assert.equal(e.toaster.resume("a"), true);
  assert.equal(e.toaster.resume("a"), false);
  assert.equal(e.toaster.resume("q"), false);
  e.toaster.dismiss("a");
  e.toaster.dismiss("q");
  assert.deepEqual(ids(e.toaster.visible()), ["e"]);
  assert.equal(e.toaster.pause("e"), false);
  assert.equal(e.toaster.resume("e"), false);
});
t("paused toast does not auto-dismiss and still occupies its slot", () => {
  const e = env({ maxVisible: 1 });
  e.toaster.show({ id: "a", message: "m", durationMs: 100 });
  e.toaster.show({ id: "b", message: "m" });
  e.toaster.pause("a");
  e.tick(10000);
  assert.deepEqual(ids(e.toaster.visible()), ["a"]);
  assert.deepEqual(ids(e.toaster.queued()), ["b"]);
});
t("dismiss while paused promotes next", () => {
  const e = env({ maxVisible: 1 });
  e.toaster.show({ id: "a", message: "m" });
  e.toaster.show({ id: "b", message: "m", durationMs: 400 });
  e.toaster.pause("a");
  e.toaster.dismiss("a");
  assert.deepEqual(ids(e.toaster.visible()), ["b"]);
  e.tick(400);
  assert.deepEqual(ids(e.toaster.visible()), []);
});
t("reshow while paused stays paused with full new duration", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m", durationMs: 1000 });
  e.tick(600);
  e.toaster.pause("a");
  e.toaster.show({ id: "a", message: "m", durationMs: 2000 });
  const s = e.toaster.visible()[0];
  assert.equal(s.paused, true);
  assert.equal(s.count, 2);
  assert.equal(s.remainingMs, 2000);
  assert.equal(e.pending(), 0);
  e.toaster.resume("a");
  e.tick(1999);
  assert.equal(e.toaster.visible().length, 1);
  e.tick(1);
  assert.equal(e.toaster.visible().length, 0);
});
t("remainingMs counts down for running toasts", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m", durationMs: 1000 });
  e.tick(250);
  assert.equal(e.toaster.visible()[0].remainingMs, 750);
});
t("snapshots are copies", () => {
  const e = env();
  e.toaster.show({ id: "a", message: "m" });
  const s = e.toaster.visible()[0];
  s.message = "hacked"; s.count = 99;
  assert.equal(e.toaster.visible()[0].message, "m");
  assert.equal(e.toaster.visible()[0].count, 1);
});
t("cascade: simultaneous expiry promotes queue", () => {
  const e = env({ maxVisible: 2 });
  for (const i of ["a", "b", "c", "d"]) e.toaster.show({ id: i, message: "m", durationMs: 1000 });
  e.tick(1000);
  assert.deepEqual(ids(e.toaster.visible()), ["c", "d"]);
  assert.equal(e.toaster.queued().length, 0);
  e.tick(1000);
  assert.equal(e.toaster.visible().length, 0);
  assert.equal(e.pending(), 0);
});
