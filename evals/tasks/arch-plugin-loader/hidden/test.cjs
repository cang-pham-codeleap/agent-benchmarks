"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");

const ws = path.resolve(process.env.ACH_WORKSPACE || process.cwd());
let failed = 0;
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const { loadPlugins } = require(path.join(ws, "loader.js"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mk(name, version, requires, log, extra = {}) {
  return {
    name,
    version,
    requires,
    init: extra.init || ((ctx) => { log.push("init:" + name); return { api: name }; }),
    dispose: extra.noDispose ? undefined : extra.dispose || (() => { log.push("dispose:" + name); }),
  };
}
async function rej(p, check) {
  let err;
  try { await p; } catch (e) { err = e; }
  assert.ok(err, "expected rejection");
  check(err);
  return err;
}

// ---- ordering
t("independent plugins keep input order", async () => {
  const log = [];
  const h = await loadPlugins([mk("c", "1.0.0", {}, log), mk("a", "1.0.0", {}, log), mk("b", "1.0.0", {}, log)], {});
  assert.deepEqual(h.order, ["c", "a", "b"]);
  assert.deepEqual(log, ["init:c", "init:a", "init:b"]);
});
t("dependency delays only the dependent", async () => {
  const log = [];
  const h = await loadPlugins([
    mk("a", "1.0.0", { c: "^1.0.0" }, log),
    mk("b", "1.0.0", {}, log),
    mk("c", "1.2.0", {}, log),
  ], {});
  assert.deepEqual(h.order, ["b", "c", "a"]);
});
t("earliest-ready selection (not DFS)", async () => {
  const log = [];
  // a needs d; b, c free; d free. After d, a (earliest) becomes ready before b? no: b,c,d in input order first.
  const h = await loadPlugins([
    mk("a", "1.0.0", { d: ">=1.0.0" }, log),
    mk("b", "1.0.0", {}, log),
    mk("c", "1.0.0", { b: "1.0.0" }, log),
    mk("d", "1.0.0", {}, log),
  ], {});
  assert.deepEqual(h.order, ["b", "c", "d", "a"]);
});
t("ready plugin earlier in input wins after unlock", async () => {
  const log = [];
  const h = await loadPlugins([
    mk("a", "1.0.0", { z: "1.0.0" }, log),
    mk("m", "1.0.0", {}, log),
    mk("z", "1.0.0", {}, log),
    mk("n", "1.0.0", {}, log),
  ], {});
  assert.deepEqual(h.order, ["m", "z", "a", "n"]);
});
t("empty list", async () => {
  const h = await loadPlugins([], {});
  assert.deepEqual(h.order, []);
  await h.unloadAll();
});
t("init is sequential and awaited", async () => {
  const log = [];
  const slow = (n, ms) => ({
    init: async () => { log.push("start:" + n); await sleep(ms); log.push("end:" + n); return n; },
  });
  await loadPlugins([
    mk("a", "1.0.0", {}, log, slow("a", 30)),
    mk("b", "1.0.0", {}, log, slow("b", 1)),
  ], {});
  assert.deepEqual(log, ["start:a", "end:a", "start:b", "end:b"]);
});

// ---- ctx
t("ctx.host, ctx.name, ctx.get for declared deps", async () => {
  const host = { id: 1 };
  const seen = {};
  const log = [];
  const h = await loadPlugins([
    mk("b", "1.0.0", { a: "1.0.0" }, log, {
      init: (ctx) => { seen.host = ctx.host; seen.name = ctx.name; seen.a = ctx.get("a"); return { fromB: true }; },
    }),
    mk("a", "1.0.0", {}, log, { init: () => ({ marker: 42 }) }),
  ], host);
  assert.equal(seen.host, host);
  assert.equal(seen.name, "b");
  assert.equal(seen.a.marker, 42);
  assert.equal(h.get("a").marker, 42);
  assert.equal(h.get("b").fromB, true);
  assert.equal(h.get("nope"), undefined);
});
t("ctx.get rejects undeclared names, even loaded ones and unknown ones", async () => {
  const log = [];
  const errs = [];
  await loadPlugins([
    mk("a", "1.0.0", {}, log),
    mk("b", "1.0.0", {}, log, {
      init: (ctx) => {
        for (const n of ["a", "zzz", "b"]) { try { ctx.get(n); errs.push("no throw " + n); } catch (e) { errs.push(e instanceof Error); } }
      },
    }),
  ], {});
  assert.deepEqual(errs, [true, true, true]);
});
t("async init API is awaited and stored; undefined API allowed", async () => {
  const log = [];
  let got;
  const h = await loadPlugins([
    mk("a", "1.0.0", {}, log, { init: async () => { await sleep(5); return { v: 1 }; } }),
    mk("u", "1.0.0", {}, log, { init: () => undefined }),
    mk("b", "1.0.0", { a: "1.0.0", u: "1.0.0" }, log, { init: (ctx) => { got = [ctx.get("a"), ctx.get("u")]; } }),
  ], {});
  assert.deepEqual(got, [{ v: 1 }, undefined]);
  assert.equal(h.get("a").v, 1);
});

// ---- ranges
const RANGES = [
  ["1.2.3", "1.2.3", true], ["1.2.3", "1.2.4", false], ["1.2.3", "1.2.2", false], ["1.2.3", "1.3.3", false],
  [">=1.2.3", "1.2.3", true], [">=1.2.3", "1.10.0", true], [">=1.2.3", "2.0.0", true], [">=1.2.3", "1.2.2", false], [">=1.2.3", "0.9.9", false],
  [">=1.9.0", "1.10.0", true], ["^1.9.0", "1.10.0", true],
  ["~1.2.3", "1.2.3", true], ["~1.2.3", "1.2.99", true], ["~1.2.3", "1.3.0", false], ["~1.2.3", "1.2.2", false], ["~1.2.3", "2.2.3", false],
  ["^1.2.3", "1.2.3", true], ["^1.2.3", "1.99.0", true], ["^1.2.3", "2.0.0", false], ["^1.2.3", "1.2.2", false], ["^1.2.3", "1.1.9", false],
  ["^0.2.3", "0.2.3", true], ["^0.2.3", "0.2.9", true], ["^0.2.3", "0.3.0", false], ["^0.2.3", "0.2.2", false], ["^0.2.3", "1.2.3", false],
  ["^0.0.3", "0.0.3", true], ["^0.0.3", "0.0.4", false], ["^0.0.3", "0.0.2", false], ["^0.0.3", "0.1.0", false],
  ["^0.0.0", "0.0.0", true], ["^0.0.0", "0.0.1", false],
];
t("range matcher table (" + RANGES.length + " rows)", async () => {
  const bad = [];
  for (const [range, ver, want] of RANGES) {
    const log = [];
    let ok;
    try {
      await loadPlugins([mk("a", "1.0.0", { d: range }, log), mk("d", ver, {}, log)], {});
      ok = true;
    } catch (e) {
      ok = false;
      if (e.code !== "INCOMPATIBLE_VERSION") bad.push(range + " vs " + ver + " threw " + e.code + " " + e.message);
    }
    if (ok !== want) bad.push(range + " vs " + ver + " expected " + want);
  }
  assert.deepEqual(bad, []);
});

// ---- validation errors
t("duplicate names rejected before any init", async () => {
  const log = [];
  await rej(loadPlugins([mk("a", "1.0.0", {}, log), mk("b", "1.0.0", {}, log), mk("a", "2.0.0", {}, log)], {}), (e) => {
    assert.equal(e.code, "DUPLICATE_PLUGIN");
    assert.match(e.message, /a/);
  });
  assert.deepEqual(log, []);
});
t("duplicate reported before missing dependency", async () => {
  const log = [];
  await rej(loadPlugins([mk("x", "1.0.0", { ghost: "1.0.0" }, log), mk("y", "1.0.0", {}, log), mk("y", "1.0.0", {}, log)], {}), (e) =>
    assert.equal(e.code, "DUPLICATE_PLUGIN"));
});
t("missing dependency", async () => {
  const log = [];
  await rej(loadPlugins([mk("app", "1.0.0", { db: "^1.0.0" }, log), mk("log", "1.0.0", {}, log)], {}), (e) => {
    assert.equal(e.code, "MISSING_DEPENDENCY");
    assert.match(e.message, /app/);
    assert.match(e.message, /db/);
  });
  assert.deepEqual(log, []);
});
t("incompatible version message names plugins, range and version", async () => {
  const log = [];
  await rej(loadPlugins([mk("app", "1.0.0", { db: "^2.0.0" }, log), mk("db", "1.4.2", {}, log)], {}), (e) => {
    assert.equal(e.code, "INCOMPATIBLE_VERSION");
    for (const s of ["app", "db", "^2.0.0", "1.4.2"]) assert.ok(e.message.includes(s), s + " in " + e.message);
  });
  assert.deepEqual(log, []);
});
t("incompatible version is reported before a cycle elsewhere", async () => {
  const log = [];
  await rej(loadPlugins([
    mk("a", "1.0.0", { b: "1.0.0" }, log), mk("b", "1.0.0", { a: "1.0.0" }, log),
    mk("c", "1.0.0", { a: "2.0.0" }, log),
  ], {}), (e) => assert.equal(e.code, "INCOMPATIBLE_VERSION"));
});
t("malformed versions and ranges are TypeErrors", async () => {
  const bad = [
    [mk("a", "1.0", {}, []), null],
    [mk("a", "v1.0.0", {}, []), null],
    [mk("a", "1.0.0-beta", {}, []), null],
    [mk("a", "1.0.0", { b: "~1.0" }, []), mk("b", "1.0.0", {}, [])],
    [mk("a", "1.0.0", { b: "latest" }, []), mk("b", "1.0.0", {}, [])],
    [mk("a", "1.0.0", { b: "^^1.0.0" }, []), mk("b", "1.0.0", {}, [])],
    [mk("a", "1.0.0", { b: ">1.0.0" }, []), mk("b", "1.0.0", {}, [])],
  ];
  for (const [a, b] of bad) {
    await rej(loadPlugins(b ? [a, b] : [a], {}), (e) => assert.ok(e instanceof TypeError, "TypeError for " + JSON.stringify(a.requires) + a.version));
  }
});
t("cycle: three-node path", async () => {
  const log = [];
  const ps = [
    mk("a", "1.0.0", { b: "1.0.0" }, log), mk("b", "1.0.0", { c: "1.0.0" }, log), mk("c", "1.0.0", { a: "1.0.0" }, log),
  ];
  const e = await rej(loadPlugins(ps, {}), (e) => assert.equal(e.code, "DEPENDENCY_CYCLE"));
  checkCycle(e, ps, 3);
  assert.deepEqual(log, []);
});
function checkCycle(e, ps, len) {
  const c = e.cycle;
  assert.ok(Array.isArray(c) && c.length >= 2, "cycle array");
  assert.equal(c[0], c[c.length - 1]);
  if (len) assert.equal(c.length, len + 1);
  for (let i = 0; i + 1 < c.length; i++) {
    const p = ps.find((x) => x.name === c[i]);
    assert.ok(p && Object.hasOwn(p.requires, c[i + 1]), c[i] + " requires " + c[i + 1]);
  }
  assert.ok(e.message.includes(c.join(" -> ")), e.message);
}
t("cycle: self dependency", async () => {
  const ps = [mk("a", "1.0.0", { a: "1.0.0" }, [])];
  const e = await rej(loadPlugins(ps, {}), (e) => assert.equal(e.code, "DEPENDENCY_CYCLE"));
  assert.deepEqual(e.cycle, ["a", "a"]);
});
t("cycle: path excludes plugins merely hanging off the cycle", async () => {
  const ps = [
    mk("x", "1.0.0", { a: "1.0.0" }, []),
    mk("a", "1.0.0", { b: "1.0.0" }, []),
    mk("b", "1.0.0", { a: "1.0.0" }, []),
    mk("free", "1.0.0", {}, []),
  ];
  const e = await rej(loadPlugins(ps, {}), (e) => assert.equal(e.code, "DEPENDENCY_CYCLE"));
  checkCycle(e, ps, 2);
  assert.ok(!e.cycle.includes("x") && !e.cycle.includes("free"), "cycle: " + e.cycle);
});
t("cycle: dependents of a cycle fail at validation, nothing initialized", async () => {
  const log = [];
  await rej(loadPlugins([
    mk("free", "1.0.0", {}, log), mk("a", "1.0.0", { b: "1.0.0" }, log), mk("b", "1.0.0", { a: "1.0.0" }, log),
  ], {}), (e) => assert.equal(e.code, "DEPENDENCY_CYCLE"));
  assert.deepEqual(log, []);
});
t("diamond is not a cycle", async () => {
  const log = [];
  const h = await loadPlugins([
    mk("top", "1.0.0", { l: "1.0.0", r: "1.0.0" }, log),
    mk("l", "1.0.0", { base: "1.0.0" }, log),
    mk("r", "1.0.0", { base: "1.0.0" }, log),
    mk("base", "1.0.0", {}, log),
  ], {});
  assert.deepEqual(h.order, ["base", "l", "r", "top"]);
});

// ---- failure and rollback
t("init failure rolls back in reverse init order and rethrows same error", async () => {
  const log = [];
  const boom = new Error("boom");
  const ps = [
    mk("a", "1.0.0", {}, log),
    mk("b", "1.0.0", { a: "1.0.0" }, log),
    mk("c", "1.0.0", { b: "1.0.0" }, log),
    mk("d", "1.0.0", { c: "1.0.0" }, log, { init: () => { log.push("init:d"); throw boom; } }),
    mk("e", "1.0.0", {}, log),
  ];
  const err = await rej(loadPlugins(ps, {}), () => {});
  assert.equal(err, boom);
  assert.deepEqual(log, ["init:a", "init:b", "init:c", "init:d", "dispose:c", "dispose:b", "dispose:a"]);
});
t("async init rejection rolls back, failing plugin not disposed, later not initialized", async () => {
  const log = [];
  const boom = new Error("async boom");
  const ps = [
    mk("a", "1.0.0", {}, log),
    mk("f", "1.0.0", {}, log, { init: async () => { await sleep(3); log.push("init:f"); throw boom; } }),
    mk("g", "1.0.0", {}, log),
  ];
  const err = await rej(loadPlugins(ps, {}), () => {});
  assert.equal(err, boom);
  assert.deepEqual(log, ["init:a", "init:f", "dispose:a"]);
});
t("rollback continues past a throwing dispose and still rethrows the init error", async () => {
  const log = [];
  const boom = new Error("init failed");
  const ps = [
    mk("a", "1.0.0", {}, log),
    mk("b", "1.0.0", {}, log, { dispose: () => { log.push("dispose:b"); throw new Error("dispose b"); } }),
    mk("c", "1.0.0", {}, log, { dispose: async () => { log.push("dispose:c"); throw new Error("dispose c"); } }),
    mk("d", "1.0.0", {}, log, { init: () => { throw boom; } }),
  ];
  const err = await rej(loadPlugins(ps, {}), () => {});
  assert.equal(err, boom);
  assert.deepEqual(log, ["init:a", "init:b", "init:c", "dispose:c", "dispose:b", "dispose:a"]);
});
t("rollback awaits async disposes sequentially and skips plugins without dispose", async () => {
  const log = [];
  const slow = (n, ms) => ({ dispose: async () => { log.push("ds:" + n); await sleep(ms); log.push("de:" + n); } });
  const ps = [
    mk("a", "1.0.0", {}, log, slow("a", 1)),
    mk("n", "1.0.0", {}, log, { noDispose: true }),
    mk("b", "1.0.0", {}, log, slow("b", 25)),
    mk("x", "1.0.0", {}, log, { init: () => { throw new Error("x"); } }),
  ];
  await rej(loadPlugins(ps, {}), () => {});
  assert.deepEqual(log.filter((s) => /^d[se]:/.test(s)), ["ds:b", "de:b", "ds:a", "de:a"]);
});

// ---- unload
t("unloadAll disposes in reverse init order (not input order)", async () => {
  const log = [];
  const h = await loadPlugins([
    mk("a", "1.0.0", { c: "1.0.0" }, log),
    mk("b", "1.0.0", {}, log),
    mk("c", "1.0.0", {}, log),
  ], {});
  assert.deepEqual(h.order, ["b", "c", "a"]);
  log.length = 0;
  await h.unloadAll();
  assert.deepEqual(log, ["dispose:a", "dispose:c", "dispose:b"]);
});
t("unloadAll continues after errors and throws AggregateError in order", async () => {
  const log = [];
  const e1 = new Error("e-b"), e2 = new Error("e-a");
  const h = await loadPlugins([
    mk("a", "1.0.0", {}, log, { dispose: async () => { log.push("dispose:a"); throw e2; } }),
    mk("b", "1.0.0", { a: "1.0.0" }, log, { dispose: () => { log.push("dispose:b"); throw e1; } }),
    mk("c", "1.0.0", { b: "1.0.0" }, log),
  ], {});
  log.length = 0;
  const err = await rej(h.unloadAll(), (e) => assert.ok(e instanceof AggregateError));
  assert.deepEqual(log, ["dispose:c", "dispose:b", "dispose:a"]);
  assert.deepEqual(err.errors, [e1, e2]);
});
t("unloadAll skips plugins without dispose, awaits async ones sequentially", async () => {
  const log = [];
  const h = await loadPlugins([
    mk("a", "1.0.0", {}, log, { dispose: async () => { log.push("s:a"); await sleep(20); log.push("e:a"); } }),
    mk("n", "1.0.0", {}, log, { noDispose: true }),
    mk("b", "1.0.0", {}, log, { dispose: async () => { log.push("s:b"); await sleep(1); log.push("e:b"); } }),
  ], {});
  log.length = 0;
  await h.unloadAll();
  assert.deepEqual(log, ["s:b", "e:b", "s:a", "e:a"]);
});
t("unloadAll is idempotent: each dispose runs at most once", async () => {
  const log = [];
  const h = await loadPlugins([mk("a", "1.0.0", {}, log), mk("b", "1.0.0", {}, log)], {});
  log.length = 0;
  await h.unloadAll();
  await h.unloadAll();
  assert.deepEqual(log, ["dispose:b", "dispose:a"]);
});
t("failed unloadAll is still consumed (second call resolves, no re-dispose)", async () => {
  const log = [];
  const h = await loadPlugins([
    mk("a", "1.0.0", {}, log, { dispose: () => { log.push("dispose:a"); throw new Error("x"); } }),
  ], {});
  log.length = 0;
  await rej(h.unloadAll(), (e) => assert.ok(e instanceof AggregateError));
  await h.unloadAll();
  assert.deepEqual(log, ["dispose:a"]);
});
t("separate loads are independent", async () => {
  const log1 = [], log2 = [];
  const h1 = await loadPlugins([mk("a", "1.0.0", {}, log1)], {});
  const h2 = await loadPlugins([mk("a", "2.0.0", {}, log2)], {});
  await h1.unloadAll();
  assert.deepEqual(log1, ["init:a", "dispose:a"]);
  assert.deepEqual(log2, ["init:a"]);
  assert.deepEqual(h2.order, ["a"]);
});

(async () => {
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log("ok   " + name);
    } catch (e) {
      failed++;
      console.log("FAIL " + name + ": " + (e && e.message ? e.message.split("\n")[0] : String(e)));
    }
  }
  process.exitCode = failed ? 1 : 0;
})();
