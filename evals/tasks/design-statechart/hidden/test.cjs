"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");

const ws = path.resolve(process.env.ACH_WORKSPACE || process.cwd());
let failed = 0;
let total = 0;
function t(name, fn) {
  total++;
  try {
    fn();
    console.log("ok " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + ": " + String(e && e.message ? e.message : e).split("\n").slice(0, 6).join(" | "));
  }
}
process.on("exit", () => {
  console.log(`${total - failed}/${total} cases passed`);
  if (failed > 0) process.exitCode = 1;
});

let lib;
try {
  lib = require(path.join(ws, "machine.js"));
} catch (e) {
  console.log("FAIL load machine.js: " + e.message);
  process.exit(1);
}
const { createMachine, assign } = lib;

let L = [];
const lg = (n) => () => L.push(n);
const node = (n, o = {}) => ({ entry: lg(n + "+"), exit: lg(n + "-"), ...o });
const T = (target, extra = {}) => ({ target, actions: lg("t"), ...extra });

function tree() {
  return {
    initial: "a",
    states: {
      a: node("a", {
        initial: "a1",
        on: { GO_B: T("b"), SELF: T("a") },
        states: {
          a1: node("a1", {
            initial: "x",
            on: {
              TO_A2: T("a2"),
              SELF1: T("a1"),
              INT: T(".y", { internal: true }),
              EXT: T(".y"),
              INT_X: T(".x", { internal: true }),
              INT_SIB: T("a2", { internal: true }),
              NOOP: { actions: lg("t") },
              TO_ROOT_A: T("#a"),
              DEEP: T(".y"),
            },
            states: {
              x: node("x", { on: { SELFX: T("x"), INTX_SELF: T("x", { internal: true }), LEAVE_DOTTED: T("#a.a2") } }),
              y: node("y", { on: { BACK_X: T("x") } }),
            },
          }),
          a2: node("a2"),
        },
      }),
      b: node("b", { initial: "b1", states: { b1: node("b1") } }),
    },
  };
}
function fresh(cfg) {
  L = [];
  const m = createMachine(cfg || tree());
  L = [];
  return m;
}
function order(event, expected, expectedValue, setup) {
  const m = fresh();
  if (setup) { setup.forEach((e) => m.send(e)); L = []; }
  const r = m.send(event);
  assert.deepEqual(L, expected);
  if (expectedValue !== undefined) assert.equal(r.value, expectedValue);
}

t("initial entry order, outermost first, with init event", () => {
  L = [];
  const ev = [];
  const cfg = tree();
  cfg.states.a.entry = (c, e) => { L.push("a+"); ev.push(e); };
  const m = createMachine(cfg);
  assert.deepEqual(L, ["a+", "a1+", "x+"]);
  assert.deepEqual(ev, [{ type: "init" }]);
  assert.equal(m.snapshot().value, "a.a1.x");
});
t("cross-branch transition: exits innermost-first, action, entries outermost-first", () =>
  order("GO_B", ["x-", "a1-", "a-", "t", "b+", "b1+"], "b.b1"));
t("sibling transition keeps the common parent", () => order("TO_A2", ["x-", "a1-", "t", "a2+"], "a.a2"));
t("external self-transition on compound re-enters its initial leaf", () =>
  order("SELF1", ["x-", "a1-", "t", "a1+", "x+"], "a.a1.x"));
t("external self-transition declared on an ancestor of the leaf", () =>
  order("SELF", ["x-", "a1-", "a-", "t", "a+", "a1+", "x+"], "a.a1.x"));
t("external self-transition on the leaf itself", () => order("SELFX", ["x-", "t", "x+"], "a.a1.x"));
t("target an ancestor absolutely: ancestor exits and re-enters", () =>
  order("TO_ROOT_A", ["x-", "a1-", "a-", "t", "a+", "a1+", "x+"], "a.a1.x"));
t("internal transition to child: declaring state is not exited", () =>
  order("INT", ["x-", "t", "y+"], "a.a1.y"));
t("external transition to child: declaring state is exited and re-entered", () =>
  order("EXT", ["x-", "a1-", "t", "a1+", "y+"], "a.a1.y"));
t("internal transition to the active child re-enters only the child", () =>
  order("INT_X", ["x-", "t", "x+"], "a.a1.x"));
t("internal transition to a non-descendant behaves as external", () =>
  order("INT_SIB", ["x-", "a1-", "t", "a2+"], "a.a2"));
t("internal flag with target equal to the leaf itself is external", () =>
  order("INTX_SELF", ["x-", "t", "x+"], "a.a1.x"));
t("targetless transition runs actions only, changed false", () => {
  const m = fresh();
  const r = m.send("NOOP");
  assert.deepEqual(L, ["t"]);
  assert.deepEqual([r.value, r.changed], ["a.a1.x", false]);
});
t("dotted absolute target resolves through nested keys", () => order("LEAVE_DOTTED", ["x-", "a1-", "t", "a2+"], "a.a2"));
t("a state handles events declared on itself after returning from a sibling", () => {
  const m = fresh();
  m.send("EXT");
  L = [];
  m.send("BACK_X");
  assert.deepEqual(L, ["y-", "t", "x+"]);
});
t("unknown event is ignored", () => {
  const m = fresh();
  const r = m.send("NOPE");
  assert.deepEqual(L, []);
  assert.equal(r.changed, false);
  assert.equal(r.value, "a.a1.x");
});
t("string events normalize to {type}, payload preserved for objects", () => {
  const seen = [];
  const m = createMachine({
    initial: "s",
    states: { s: { on: { A: { actions: (c, e) => seen.push(e) }, B: { cond: (c, e) => { seen.push(e); return true; }, target: "s" } } } },
  });
  m.send("A");
  m.send({ type: "A", v: 1 });
  m.send({ type: "B", w: 2 });
  assert.deepEqual(seen, [{ type: "A" }, { type: "A", v: 1 }, { type: "B", w: 2 }]);
});
t("send rejects malformed events with TypeError", () => {
  const m = fresh();
  for (const bad of [null, undefined, 5, {}, { type: 1 }, ["A"]]) assert.throws(() => m.send(bad), TypeError, String(bad));
});

t("guards: first passing transition in the array wins", () => {
  const m = createMachine({
    initial: "s",
    states: {
      s: { on: { E: [{ cond: (c, e) => e.v > 5, target: "big" }, { cond: (c, e) => e.v > 1, target: "mid" }, { target: "small" }] } },
      big: {}, mid: {}, small: {},
    },
  });
  assert.equal(m.send({ type: "E", v: 9 }).value, "big");
  const m2 = createMachine({ initial: "s", states: { s: { on: { E: [{ cond: (c, e) => e.v > 5, target: "big" }, { cond: (c, e) => e.v > 1, target: "mid" }, { target: "small" }] } }, big: {}, mid: {}, small: {} } });
  assert.equal(m2.send({ type: "E", v: 3 }).value, "mid");
  const m3 = createMachine({ initial: "s", states: { s: { on: { E: [{ cond: (c, e) => e.v > 5, target: "big" }, { cond: (c, e) => e.v > 1, target: "mid" }, { target: "small" }] } }, big: {}, mid: {}, small: {} } });
  assert.equal(m3.send({ type: "E", v: 0 }).value, "small");
});
t("guards: deepest state wins when several handle the event", () => {
  const m = createMachine({
    initial: "p",
    states: { p: { initial: "c", on: { E: "o1" }, states: { c: { on: { E: "d" } }, d: {} } }, o1: {} },
  });
  assert.equal(m.send("E").value, "p.d");
});
t("guards: all-failing guards on a child fall through to the parent", () => {
  const m = createMachine({
    initial: "p",
    states: { p: { initial: "c", on: { E: "o" }, states: { c: { on: { E: [{ cond: () => false, target: "d" }, { cond: () => 0, target: "d" }] } }, d: {} } }, o: {} },
  });
  assert.equal(m.send("E").value, "o");
});
t("guards: failing everywhere means ignored, no actions", () => {
  L = [];
  const m = createMachine({ initial: "s", states: { s: node("s", { on: { E: { cond: () => false, target: "s", actions: lg("t") } } }) } });
  L = [];
  assert.equal(m.send("E").changed, false);
  assert.deepEqual(L, []);
});
t("guards: evaluated against context before any action of the step runs", () => {
  const m = createMachine({
    context: { n: 0 },
    initial: "s",
    states: {
      s: { exit: assign({ n: 5 }), on: { E: [{ cond: (c) => c.n === 0, target: "a", actions: assign({ n: 9 }) }, { target: "b" }] } },
      a: {}, b: {},
    },
  });
  const r = m.send("E");
  assert.equal(r.value, "a");
  assert.equal(r.context.n, 9);
});
t("guard receives current context and event (bubbling reevaluates per state)", () => {
  const calls = [];
  const m = createMachine({
    context: { n: 3 },
    initial: "p",
    states: { p: { initial: "c", on: { E: { cond: (c, e) => { calls.push(["p", c.n, e.type]); return true; }, target: "o" } }, states: { c: { on: { E: { cond: (c, e) => { calls.push(["c", c.n, e.type]); return false; } } } } } }, o: {} },
  });
  m.send("E");
  assert.deepEqual(calls, [["c", 3, "E"], ["p", 3, "E"]]);
});
t("root-level on handles events from any depth with domain = root", () => {
  const m = createMachine({
    initial: "a",
    on: { RESET: T("a") },
    states: { a: node("a", { initial: "a1", states: { a1: node("a1") } }) },
  });
  L = [];
  m.send("RESET");
  assert.deepEqual(L, ["a1-", "a-", "t", "a+", "a1+"]);
});

t("assign: object values (functions and literals) evaluate against the pre-assign context", () => {
  const m = createMachine({
    context: { a: 1, b: 2, keep: "k" },
    initial: "s",
    states: { s: { on: { SWAP: { actions: assign({ a: (c) => c.b, b: (c) => c.a, z: 7 }) } } } },
  });
  const r = m.send("SWAP");
  assert.deepEqual(r.context, { a: 2, b: 1, keep: "k", z: 7 });
  assert.equal(r.changed, true);
});
t("assign: function form receives event; later actions see earlier assigns", () => {
  const seen = [];
  const m = createMachine({
    context: { n: 0 },
    initial: "s",
    states: { s: { on: { E: { actions: [assign({ n: 1 }), (c) => seen.push(c.n), assign((c, e) => ({ n: c.n + e.by }))] } } } },
  });
  const r = m.send({ type: "E", by: 10 });
  assert.deepEqual(seen, [1]);
  assert.equal(r.context.n, 11);
});
t("assign in exit/entry is visible to the transition actions and later entries", () => {
  const seen = [];
  const m = createMachine({
    context: { n: 0 },
    initial: "a",
    states: {
      a: { exit: assign({ n: 1 }), on: { GO: { target: "b", actions: [(c) => seen.push("t" + c.n), assign((c) => ({ n: c.n + 1 }))] } } },
      b: { entry: (c) => seen.push("e" + c.n) },
    },
  });
  m.send("GO");
  assert.deepEqual(seen, ["t1", "e2"]);
});
t("assign creates a new context object; config and original context are untouched", () => {
  const ctx0 = Object.freeze({ list: Object.freeze([1]), n: 0 });
  const cfg = Object.freeze({ context: ctx0, initial: "s", states: Object.freeze({ s: Object.freeze({ on: Object.freeze({ E: Object.freeze({ actions: assign({ n: (c) => c.n + 1 }) }) }) }) }) });
  const m1 = createMachine(cfg);
  const m2 = createMachine(cfg);
  m1.send("E");
  m1.send("E");
  assert.equal(m1.snapshot().context.n, 2);
  assert.equal(m2.snapshot().context.n, 0);
  assert.equal(ctx0.n, 0);
});
t("context defaults to {}", () => {
  const m = createMachine({ initial: "s", states: { s: { on: { E: { actions: assign({ k: 1 }) } } } } });
  assert.deepEqual(m.snapshot().context, {});
  assert.deepEqual(m.send("E").context, { k: 1 });
});
t("changed: value change, context change, and neither", () => {
  const m = createMachine({
    context: { n: 0 },
    initial: "s",
    states: {
      s: { on: { MOVE: "u", BUMP: { actions: assign({ n: (c) => c.n + 1 }) }, SAME: { actions: assign({ n: (c) => c.n }) }, SELF: "s" } },
      u: {},
    },
  });
  assert.equal(m.send("BUMP").changed, true);
  assert.equal(m.send("SAME").changed, false);
  assert.equal(m.send("SELF").changed, false);
  assert.equal(m.send("MOVE").changed, true);
});

function histCfg(target) {
  return {
    initial: "q",
    states: {
      p: node("p", {
        initial: "p1",
        on: { LEAVE: "#q" },
        states: {
          p1: node("p1", { on: { TO_P2B: "p2.p2b", TO_H: "h" } }),
          p2: node("p2", { initial: "p2a", states: { p2a: node("p2a"), p2b: node("p2b", { on: { TO_H2: "#p.h", OUT: "#q" } }) } }),
          h: { type: "history", ...(target ? { target } : {}) },
        },
      }),
      q: node("q", { on: { BACK: "#p.h", FRESH: "#p" } }),
    },
  };
}
function histMachine(target) {
  L = [];
  const m = createMachine(histCfg(target));
  L = [];
  return m;
}
t("history: shallow, restores remembered child but not its grandchildren", () => {
  const m = histMachine();
  m.send("BACK");
  m.send("TO_P2B");
  m.send("LEAVE");
  assert.equal(m.snapshot().value, "q");
  L = [];
  const r = m.send("BACK");
  assert.deepEqual(L, ["q-", "p+", "p2+", "p2a+"]);
  assert.equal(r.value, "p.p2.p2a");
});
t("history: first use without target falls back to parent's initial", () => {
  const m = histMachine();
  m.send("BACK");
  assert.deepEqual(L, ["q-", "p+", "p1+"]);
  assert.equal(m.snapshot().value, "p.p1");
});
t("history: first use with target enters that sibling and its initial chain", () => {
  const m = histMachine("p2");
  const r = m.send("BACK");
  assert.deepEqual(L, ["q-", "p+", "p2+", "p2a+"]);
  assert.equal(r.value, "p.p2.p2a");
});
t("history: transitioning to history inside the parent exits only the active child", () => {
  const m = histMachine();
  m.send("BACK");
  L = [];
  const r = m.send("TO_H");
  assert.deepEqual(L, ["p1-", "p1+"]);
  assert.equal(r.value, "p.p1");
});
t("history: via sibling history from a deep leaf remembers the just-exited child", () => {
  const m = histMachine();
  m.send("BACK");
  m.send("TO_P2B");
  L = [];
  const r = m.send("TO_H2");
  assert.deepEqual(L, ["p2b-", "p2-", "p2+", "p2a+"]);
  assert.equal(r.value, "p.p2.p2a");
});
t("history: a plain transition to the parent ignores history (initial chain)", () => {
  const m = histMachine();
  m.send("BACK");
  m.send("TO_P2B");
  m.send("LEAVE");
  L = [];
  assert.equal(m.send("FRESH").value, "p.p1");
  assert.deepEqual(L, ["q-", "p+", "p1+"]);
});
t("history at the top level remembers the last exited top-level state", () => {
  const m = createMachine({
    initial: "a",
    states: { a: { on: { GO: "b" } }, b: { on: { GO: "c" } }, c: { on: { H: "h" } }, h: { type: "history" } },
  });
  m.send("GO");
  m.send("GO");
  assert.equal(m.send("H").value, "c");
});
t("history is recorded for every exited state; snapshot exposes it exactly", () => {
  const m = fresh();
  m.send("GO_B");
  assert.deepEqual(m.snapshot().history, { "a.a1": "x", a: "a1", "": "a" });
});

function finalCfg() {
  return {
    initial: "work",
    states: {
      work: node("work", {
        initial: "w1",
        on: { "done.state.work": T("review") },
        states: {
          w1: node("w1", { on: { FIN: T("end") } }),
          end: node("end", { type: "final" }),
        },
      }),
      review: node("review", { on: { OK: "#finished" } }),
      finished: { type: "final", on: undefined },
    },
  };
}
t("final: done.state event is processed after entry, bubbles to the parent", () => {
  L = [];
  const m = createMachine(finalCfg());
  L = [];
  const r = m.send("FIN");
  assert.deepEqual(L, ["w1-", "t", "end+", "end-", "work-", "t", "review+"]);
  assert.equal(r.value, "review");
  assert.equal(r.changed, true);
});
t("final: done event carries the parent's dotted path as its type", () => {
  const seen = [];
  const m = createMachine({
    initial: "o",
    states: {
      o: { initial: "i", states: { i: { initial: "a", on: { "done.state.o.i": { actions: (c, e) => seen.push(e) } }, states: { a: { on: { GO: "f" } }, f: { type: "final" } } } } },
    },
  });
  m.send("GO");
  assert.deepEqual(seen, [{ type: "done.state.o.i" }]);
  assert.equal(m.snapshot().value, "o.i.f");
});
t("final: compound whose initial is final raises done during createMachine", () => {
  L = [];
  const m = createMachine({
    initial: "c",
    states: { c: node("c", { initial: "f", on: { "done.state.c": T("n") }, states: { f: node("f", { type: "final" }) } }), n: node("n") },
  });
  assert.deepEqual(L, ["c+", "f+", "f-", "c-", "t", "n+"]);
  assert.equal(m.snapshot().value, "n");
});
t("final: chained done events resolve FIFO within one send", () => {
  const m = createMachine({
    initial: "outer",
    states: {
      outer: {
        initial: "a",
        on: { "done.state.outer": "finished" },
        states: {
          a: { initial: "a1", on: { "done.state.outer.a": "b" }, states: { a1: { on: { GO: "a2" } }, a2: { type: "final" } } },
          b: { type: "final" },
          z: {},
        },
      },
      finished: { type: "final" },
    },
  });
  const r = m.send("GO");
  assert.equal(r.value, "finished");
  assert.equal(r.changed, true);
});
t("final: unhandled done event is ignored, machine stays in the final leaf", () => {
  const m = createMachine({ initial: "p", states: { p: { initial: "a", states: { a: { on: { GO: "f" } }, f: { type: "final" } } } } });
  const r = m.send("GO");
  assert.equal(r.value, "p.f");
  assert.equal(m.send("GO").changed, false);
});
t("final: top-level final stops the machine, even for root handlers", () => {
  const m = createMachine({
    initial: "a",
    on: { AGAIN: "a" },
    states: { a: { on: { END: "f" } }, f: { type: "final" } },
  });
  assert.equal(m.send("END").value, "f");
  const r = m.send("AGAIN");
  assert.deepEqual([r.value, r.changed], ["f", false]);
});
t("final: transition actions of a done handler may use assign", () => {
  const m = createMachine({
    context: { done: false },
    initial: "w",
    states: { w: { initial: "a", on: { "done.state.w": { target: "after", actions: assign({ done: true }) } }, states: { a: { on: { GO: "f" } }, f: { type: "final" } } }, after: {} },
  });
  const r = m.send("GO");
  assert.equal(r.context.done, true);
  assert.equal(r.value, "after");
});

t("snapshot is a JSON-safe deep copy; mutating it does not affect the machine", () => {
  const m = createMachine({ context: { deep: { n: 1 } }, initial: "s", states: { s: {} } });
  const s = m.snapshot();
  assert.deepEqual(s, { value: "s", context: { deep: { n: 1 } }, history: {} });
  s.context.deep.n = 99;
  s.history.x = "y";
  assert.equal(m.snapshot().context.deep.n, 1);
  assert.deepEqual(m.snapshot().history, {});
  assert.deepEqual(JSON.parse(JSON.stringify(m.snapshot())), m.snapshot());
});
t("restore: no actions run, value/context/history replaced, machine continues", () => {
  const m = histMachine();
  m.send("BACK");
  m.send("TO_P2B");
  m.send("LEAVE");
  const snap = JSON.parse(JSON.stringify(m.snapshot()));
  const m2 = histMachine();
  L = [];
  const r = m2.restore(snap);
  assert.deepEqual(L, []);
  assert.deepEqual(r, { value: "q", context: {}, changed: false });
  L = [];
  assert.equal(m2.send("BACK").value, "p.p2.p2a");
  assert.deepEqual(L, ["q-", "p+", "p2+", "p2a+"]);
});
t("restore into a deep leaf then exit runs exits innermost-first", () => {
  const m = fresh();
  m.restore({ value: "a.a1.y", context: {}, history: {} });
  m.send("GO_B");
  assert.deepEqual(L, ["y-", "a1-", "a-", "t", "b+", "b1+"]);
});
t("restore: invalid snapshots throw and leave the machine unchanged", () => {
  const m = createMachine({ context: { n: 1 }, initial: "a", states: { a: { initial: "a1", states: { a1: {}, h: { type: "history" } } }, b: {} } });
  for (const bad of [
    { value: "a", context: {}, history: {} },
    { value: "nope", context: {}, history: {} },
    { value: "a.h", context: {}, history: {} },
    { value: "", context: {}, history: {} },
    { value: "b", context: {}, history: { zzz: "a1" } },
    { value: "b", context: {}, history: { a: "zzz" } },
    { value: "b", context: {}, history: { a: "h" } },
    null,
  ]) assert.throws(() => m.restore(bad), Error, JSON.stringify(bad));
  assert.deepEqual(m.snapshot(), { value: "a.a1", context: { n: 1 }, history: {} });
});
t("restore deep-copies its input", () => {
  const m = createMachine({ initial: "a", states: { a: {}, b: {} } });
  const snap = { value: "b", context: { k: { n: 1 } }, history: {} };
  m.restore(snap);
  snap.context.k.n = 5;
  assert.equal(m.snapshot().context.k.n, 1);
});
t("restore discards pending state: the next event works from the restored leaf", () => {
  const m = createMachine({ initial: "a", states: { a: { on: { GO: "b" } }, b: { on: { GO: "a" } } } });
  m.restore({ value: "b", context: {}, history: {} });
  assert.equal(m.send("GO").value, "a");
});

t("independent machines from one config do not share state", () => {
  const cfg = tree();
  const m1 = createMachine(cfg);
  const m2 = createMachine(cfg);
  m1.send("GO_B");
  assert.equal(m1.snapshot().value, "b.b1");
  assert.equal(m2.snapshot().value, "a.a1.x");
});
t("relative targets: '.child' and sibling dotted path from a nested declaring state", () => {
  const m = createMachine({
    initial: "r",
    states: {
      r: { initial: "s", on: { DOWN: ".t.u" }, states: { s: { on: { SIB: "t.u" } }, t: { initial: "v", states: { v: {}, u: {} } } } },
    },
  });
  assert.equal(m.send("SIB").value, "r.t.u");
  const m2 = createMachine({ initial: "r", states: { r: { initial: "s", on: { DOWN: ".t.u" }, states: { s: {}, t: { initial: "v", states: { v: {}, u: {} } } } } } });
  assert.equal(m2.send("DOWN").value, "r.t.u");
});
t("targeting a compound state enters its initial chain recursively", () => {
  const m = createMachine({
    initial: "s",
    states: { s: { on: { GO: "c" } }, c: node("c", { initial: "d", states: { d: node("d", { initial: "e", states: { e: node("e") } }) } }) },
  });
  L = [];
  assert.equal(m.send("GO").value, "c.d.e");
  assert.deepEqual(L, ["c+", "d+", "e+"]);
});
t("full workflow: guards, assign, internal, history and done interacting", () => {
  const m = createMachine({
    context: { items: 0, attempts: 0 },
    initial: "cart",
    on: { CANCEL: "#cancelled" },
    states: {
      cart: { on: { ADD: { actions: assign({ items: (c) => c.items + 1 }) }, SUBMIT: { target: "checkout", cond: (c) => c.items > 0 } } },
      checkout: {
        initial: "ship",
        on: { PAUSE: "hold", "done.state.checkout": "fulfilled" },
        states: {
          ship: { on: { NEXT: "pay" } },
          pay: {
            initial: "method",
            on: { "done.state.checkout.pay": "review" },
            states: {
              method: { on: { GO: "auth" } },
              auth: {
                entry: assign({ attempts: (c) => c.attempts + 1 }),
                on: { FAIL: [{ target: "method", cond: (c) => c.attempts < 2 }, { target: "#cancelled" }], OK: "ok" },
              },
              ok: { type: "final" },
            },
          },
          review: { on: { CONFIRM: "done" } },
          done: { type: "final" },
          past: { type: "history" },
        },
      },
      hold: { on: { RESUME: "checkout.past" } },
      fulfilled: { type: "final" },
      cancelled: { type: "final" },
    },
  });
  assert.equal(m.send("SUBMIT").changed, false);
  m.send("ADD");
  assert.equal(m.send("SUBMIT").value, "checkout.ship");
  m.send("NEXT");
  m.send("GO");
  assert.equal(m.send("FAIL").value, "checkout.pay.method");
  m.send("PAUSE");
  assert.equal(m.send("RESUME").value, "checkout.pay.method");
  m.send("GO");
  assert.equal(m.snapshot().context.attempts, 2);
  assert.equal(m.send("OK").value, "checkout.review");
  assert.equal(m.send("CONFIRM").value, "fulfilled");
  assert.equal(m.send("CANCEL").changed, false);
});

t("validation: root shape and initial", () => {
  for (const bad of [undefined, null, 5, {}, { initial: "a" }, { initial: "a", states: [] }, { initial: "a", states: {} }, { states: { a: {} } }, { initial: "zzz", states: { a: {} } }]) {
    assert.throws(() => createMachine(bad), Error, JSON.stringify(bad));
  }
});
t("validation: compound states need a known, non-history initial", () => {
  assert.throws(() => createMachine({ initial: "a", states: { a: { states: { b: {} } } } }));
  assert.throws(() => createMachine({ initial: "a", states: { a: { initial: "zzz", states: { b: {} } } } }));
  assert.throws(() => createMachine({ initial: "a", states: { a: { initial: "h", states: { b: {}, h: { type: "history" } } } } }));
  assert.throws(() => createMachine({ initial: "h", states: { a: {}, h: { type: "history" } } }));
});
t("validation: bad state definitions, types and keys", () => {
  for (const states of [{ a: 5 }, { a: null }, { a: [] }, { a: { type: "weird" } }, { "a.b": {} }, { "#a": {} }, { "": {} }]) {
    assert.throws(() => createMachine({ initial: Object.keys(states)[0], states }), Error, JSON.stringify(states));
  }
  assert.throws(() => createMachine({ initial: "a", states: { a: { states: { "x.y": {} }, initial: "x.y" } } }));
});
t("validation: final and history restrictions", () => {
  const mk = (extra) => ({ initial: "a", states: { a: {}, f: extra } });
  assert.throws(() => createMachine(mk({ type: "final", states: { x: {} }, initial: "x" })));
  assert.throws(() => createMachine(mk({ type: "final", on: { E: "a" } })));
  assert.throws(() => createMachine(mk({ type: "history", states: { x: {} }, initial: "x" })));
  assert.throws(() => createMachine(mk({ type: "history", on: { E: "a" } })));
  assert.throws(() => createMachine(mk({ type: "history", entry: () => {} })));
  assert.throws(() => createMachine(mk({ type: "history", exit: () => {} })));
  assert.throws(() => createMachine(mk({ type: "history", target: "nope" })));
  assert.throws(() => createMachine({ initial: "a", states: { a: {}, h1: { type: "history" }, h2: { type: "history", target: "h1" } } }));
  createMachine(mk({ type: "final", entry: () => {} }));
  createMachine({ initial: "a", states: { a: {}, h: { type: "history", target: "a" } } });
});
t("validation: unresolvable transition targets", () => {
  for (const target of ["nope", ".nope", "#nope", "#", "a.zzz", ".", "#a.zzz"]) {
    assert.throws(() => createMachine({ initial: "a", states: { a: { on: { E: target } } } }), Error, target);
  }
  assert.throws(() => createMachine({ initial: "a", states: { a: { initial: "b", states: { b: { on: { E: [{ target: "b" }, { target: "gone" }] } } } } } }));
  assert.throws(() => createMachine({ initial: "a", on: { E: "gone" }, states: { a: {} } }));
  assert.throws(() => createMachine({ initial: "a", states: { a: { on: { E: { target: 5 } } } } }));
});
t("validation: guards and actions must be well-formed", () => {
  const cfg = (on, extra = {}) => ({ initial: "a", states: { a: { on, ...extra } } });
  assert.throws(() => createMachine(cfg({ E: { cond: "yes" } })));
  assert.throws(() => createMachine(cfg({ E: { actions: "log" } })));
  assert.throws(() => createMachine(cfg({ E: { actions: [() => {}, 5] } })));
  assert.throws(() => createMachine(cfg({}, { entry: "x" })));
  assert.throws(() => createMachine(cfg({}, { exit: [{}] })));
  assert.throws(() => createMachine(cfg({}, { entry: [() => {}, null] })));
  assert.throws(() => createMachine({ initial: "a", entry: () => {}, states: { a: {} } }));
  assert.throws(() => createMachine({ initial: "a", exit: () => {}, states: { a: {} } }));
});
t("validation: errors surface for unreachable states too, valid full config passes", () => {
  assert.throws(() => createMachine({ initial: "a", states: { a: {}, z: { on: { E: "gone" } } } }));
  createMachine(tree());
  createMachine(histCfg("p2"));
  createMachine(finalCfg());
});
t("assign() argument validation", () => {
  assert.throws(() => assign(5), TypeError);
  assert.throws(() => assign(null), TypeError);
  assert.throws(() => assign(undefined), TypeError);
  assert.throws(() => assign("n"), TypeError);
  assign(() => ({}));
  assign({});
});
