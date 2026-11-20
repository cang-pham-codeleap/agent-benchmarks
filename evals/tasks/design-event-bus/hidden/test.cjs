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

const { createBus } = require(path.join(ws, "bus.js"));

t("order and payload", () => {
  const bus = createBus();
  const log = [];
  bus.on("a", (p) => log.push("1:" + p));
  bus.on("b", () => log.push("other"));
  bus.on("a", (p) => log.push("2:" + p));
  assert.equal(bus.emit("a", "x"), undefined);
  assert.deepEqual(log, ["1:x", "2:x"]);
  bus.emit("none", 1);
});

t("wildcard after specific with (event, payload)", () => {
  const bus = createBus();
  const log = [];
  bus.on("*", (e, p) => log.push(["w1", e, p]));
  bus.on("a", (p) => log.push(["a", p]));
  bus.on("*", (e, p) => log.push(["w2", e, p]));
  bus.emit("a", 7);
  assert.deepEqual(log, [["a", 7], ["w1", "a", 7], ["w2", "a", 7]]);
});

t("unsubscribe is idempotent and per-subscription", () => {
  const bus = createBus();
  let n = 0;
  const f = () => n++;
  const off1 = bus.on("a", f);
  bus.on("a", f);
  bus.emit("a");
  assert.equal(n, 2);
  off1();
  off1();
  off1();
  assert.equal(bus.listenerCount("a"), 1);
  bus.emit("a");
  assert.equal(n, 3);
});

t("once fires once; unsubscribe before firing", () => {
  const bus = createBus();
  let n = 0;
  bus.once("a", (p) => (n += p));
  assert.equal(bus.listenerCount("a"), 1);
  bus.emit("a", 5);
  bus.emit("a", 5);
  assert.equal(n, 5);
  assert.equal(bus.listenerCount("a"), 0);
  const off = bus.once("a", () => n++);
  off();
  bus.emit("a", 1);
  assert.equal(n, 5);
  bus.once("*", () => n++);
  bus.emit("z");
  bus.emit("z");
  assert.equal(n, 6);
});

t("once is removed before invocation (re-entrant emit)", () => {
  const bus = createBus();
  let n = 0;
  bus.once("a", () => {
    n++;
    bus.emit("a");
  });
  bus.emit("a");
  assert.equal(n, 1);
});

t("throwing listener isolated and reported", () => {
  const errs = [];
  const bus = createBus({ onError: (e, ev) => errs.push([e.message, ev]) });
  const log = [];
  bus.on("a", () => {
    throw new Error("boom");
  });
  bus.on("a", () => log.push("after"));
  bus.on("*", () => {
    throw new Error("wild");
  });
  bus.on("*", () => log.push("wafter"));
  bus.emit("a");
  assert.deepEqual(log, ["after", "wafter"]);
  assert.deepEqual(errs, [["boom", "a"], ["wild", "a"]]);
});

t("errors ignored without onError", () => {
  const bus = createBus();
  let ok = false;
  bus.on("a", () => {
    throw new Error("x");
  });
  bus.on("a", () => (ok = true));
  bus.emit("a");
  assert.ok(ok);
});

t("listeners added during emit not called by that emit", () => {
  const bus = createBus();
  const log = [];
  bus.on("a", () => {
    log.push("first");
    bus.on("a", () => log.push("late"));
    bus.on("*", () => log.push("latewild"));
  });
  bus.emit("a");
  assert.deepEqual(log, ["first"]);
  log.length = 0;
  bus.emit("a");
  assert.deepEqual(log, ["first", "late", "latewild"]);
});

t("removing the running listener does not skip the next", () => {
  const bus = createBus();
  const log = [];
  const off = bus.on("a", () => {
    log.push("1");
    off();
  });
  bus.on("a", () => log.push("2"));
  bus.on("a", () => log.push("3"));
  bus.emit("a");
  assert.deepEqual(log, ["1", "2", "3"]);
  log.length = 0;
  bus.emit("a");
  assert.deepEqual(log, ["2", "3"]);
});

t("removing a not-yet-reached listener skips it", () => {
  const bus = createBus();
  const log = [];
  let offB, offW;
  bus.on("a", () => {
    log.push("A");
    offB();
    offW();
  });
  offB = bus.on("a", () => log.push("B"));
  bus.on("a", () => log.push("C"));
  offW = bus.on("*", () => log.push("W"));
  bus.on("*", () => log.push("W2"));
  bus.emit("a");
  assert.deepEqual(log, ["A", "C", "W2"]);
});

t("removing an already-run listener mid-emit is fine", () => {
  const bus = createBus();
  const log = [];
  const offA = bus.on("a", () => log.push("A"));
  bus.on("a", () => {
    offA();
    log.push("B");
  });
  bus.on("a", () => log.push("C"));
  bus.emit("a");
  assert.deepEqual(log, ["A", "B", "C"]);
});

t("listenerCount", () => {
  const bus = createBus();
  assert.equal(bus.listenerCount("a"), 0);
  const o1 = bus.on("a", () => {});
  bus.on("a", () => {});
  bus.on("*", () => {});
  bus.once("b", () => {});
  assert.equal(bus.listenerCount("a"), 2);
  assert.equal(bus.listenerCount("*"), 1);
  assert.equal(bus.listenerCount("b"), 1);
  o1();
  assert.equal(bus.listenerCount("a"), 1);
});

t("nested emit works and buses are independent", () => {
  const bus = createBus();
  const other = createBus();
  const log = [];
  bus.on("a", () => {
    log.push("a");
    bus.emit("b");
  });
  bus.on("b", () => log.push("b"));
  other.on("a", () => log.push("other"));
  bus.emit("a");
  assert.deepEqual(log, ["a", "b"]);
});
