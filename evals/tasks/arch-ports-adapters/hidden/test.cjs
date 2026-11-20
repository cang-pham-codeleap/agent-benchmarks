"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const ws = path.resolve(process.env.ACH_WORKSPACE || process.cwd());
const domainDir = path.join(ws, "src", "domain");
const infraDir = path.join(ws, "src", "infra");
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

const builtins = new Set(Module.builtinModules.flatMap((m) => [m, "node:" + m]));
const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(c?js|mjs)$/.test(e.name) ? [p] : [];
  });
}
// Classify a require specifier seen from `from`; returns a violation string or null.
function violation(spec, from) {
  if (builtins.has(spec) || spec.startsWith("node:")) return `requires built-in "${spec}"`;
  if (!spec.startsWith(".") && !path.isAbsolute(spec)) return `requires package "${spec}"`;
  const target = path.resolve(path.dirname(from), spec);
  if (inside(target, infraDir)) return `requires infra module "${spec}"`;
  if (!inside(target, domainDir)) return `requires outside domain "${spec}"`;
  return null;
}

const domainFiles = fs.existsSync(domainDir) ? walk(domainDir) : [];

t("domain has files", () => assert.ok(domainFiles.length > 0, "src/domain is empty"));

t("static scan: no infra/built-in requires in src/domain", () => {
  const bad = [];
  for (const f of domainFiles) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(ws, f);
    if (/\bimport\s[^;]*from\s|\bimport\s*\(/.test(src)) bad.push(`${rel}: uses import`);
    if (/\bprocess\s*\.\s*binding\b|\bprocess\s*\.\s*mainModule\b|\bmodule\s*\.\s*constructor\b|\bcreateRequire\b/.test(src))
      bad.push(`${rel}: uses a require escape hatch`);
    for (const m of src.matchAll(/\brequire\s*\(\s*([^)]*)\)/g)) {
      const lit = /^\s*(['"`])([^'"`$]+)\1\s*$/.exec(m[1]);
      if (!lit) {
        bad.push(`${rel}: non-literal require(${m[1].trim()})`);
        continue;
      }
      const v = violation(lit[2], f);
      if (v) bad.push(`${rel}: ${v}`);
    }
  }
  assert.equal(bad.join("; "), "");
});

// Runtime scan: patch Module._load, then load domain and exercise the service.
const seen = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  const pf = parent && parent.filename;
  if (pf && inside(pf, domainDir)) {
    const v = violation(request, pf);
    if (v) seen.push(`${path.relative(ws, pf)}: ${v}`);
  }
  return origLoad.call(this, request, parent, ...rest);
};

function fakeRepo() {
  const rows = [];
  const calls = [];
  return {
    calls,
    save(o) {
      calls.push("save");
      const c = JSON.parse(JSON.stringify(o));
      const i = rows.findIndex((r) => r.id === c.id);
      if (i >= 0) rows[i] = c;
      else rows.push(c);
    },
    get(id) {
      calls.push("get");
      const r = rows.find((x) => x.id === id);
      return r ? JSON.parse(JSON.stringify(r)) : null;
    },
    list() {
      calls.push("list");
      return rows.map((r) => JSON.parse(JSON.stringify(r)));
    },
    rows,
  };
}

let createOrderService;
t("domain exports createOrderService", () => {
  const mod = require(path.join(domainDir, "orders.js"));
  createOrderService = mod.createOrderService;
  assert.equal(typeof createOrderService, "function");
});
for (const f of domainFiles) {
  try { require(f); } catch (e) { /* reported by other checks */ }
}

const T0 = 1700000000000;
const ITEMS = () => [
  { sku: "a", qty: 2, price: 250 },
  { sku: "b", qty: 1, price: 199 },
];
function svc(clockMs = T0) {
  const repository = fakeRepo();
  const clock = { now: () => clockMs };
  return { repository, service: createOrderService({ repository, clock }), clock };
}

if (createOrderService) {
  t("placeOrder uses injected repository and clock", () => {
    const { repository, service } = svc();
    const o = service.placeOrder({ customer: "ann", items: ITEMS() });
    assert.equal(o.id, "ord-1");
    assert.equal(o.customer, "ann");
    assert.equal(o.discount, 0);
    assert.equal(o.createdAt, "2023-11-14T22:13:20.000Z");
    assert.deepEqual(repository.rows.map((r) => r.id), ["ord-1"]);
    assert.equal(service.placeOrder({ customer: "bob", items: ITEMS() }).id, "ord-2");
    assert.deepEqual(repository.rows.map((r) => r.id), ["ord-1", "ord-2"]);
  });

  t("clock is read per call (not cached at creation)", () => {
    const repository = fakeRepo();
    let now = T0;
    const service = createOrderService({ repository, clock: { now: () => now } });
    service.placeOrder({ customer: "a", items: ITEMS() });
    now = T0 + 86400000;
    const o2 = service.placeOrder({ customer: "b", items: ITEMS() });
    assert.equal(o2.createdAt, "2023-11-15T22:13:20.000Z");
    assert.equal(repository.rows[0].createdAt, "2023-11-14T22:13:20.000Z");
  });

  t("id follows repository size, not an internal counter", () => {
    const { repository, service } = svc();
    repository.save({ id: "ord-1", customer: "x", items: ITEMS(), discount: 0, createdAt: "z" });
    repository.save({ id: "ord-2", customer: "y", items: ITEMS(), discount: 0, createdAt: "z" });
    assert.equal(service.placeOrder({ customer: "c", items: ITEMS() }).id, "ord-3");
  });

  t("validation rejects bad input and saves nothing", () => {
    const { repository, service } = svc();
    const bad = [
      { customer: "", items: ITEMS() },
      { customer: 5, items: ITEMS() },
      { customer: "a", items: [] },
      { customer: "a", items: "x" },
      { customer: "a" },
      { customer: "a", items: [{ sku: "", qty: 1, price: 1 }] },
      { customer: "a", items: [{ sku: "a", qty: 0, price: 1 }] },
      { customer: "a", items: [{ sku: "a", qty: 1.5, price: 1 }] },
      { customer: "a", items: [{ sku: "a", qty: 1, price: -1 }] },
      { customer: "a", items: [{ sku: "a", qty: 1, price: 1.5 }] },
      { customer: "a", items: [{ sku: "a", qty: 1, price: 1 }, null] },
    ];
    for (const b of bad) assert.throws(() => service.placeOrder(b), Error, JSON.stringify(b));
    assert.equal(repository.rows.length, 0);
    assert.doesNotThrow(() => service.placeOrder({ customer: "a", items: [{ sku: "free", qty: 1, price: 0 }] }));
  });

  t("total without discount", () => {
    const { service } = svc();
    const o = service.placeOrder({ customer: "a", items: ITEMS() });
    assert.equal(service.total(o.id), 699);
  });

  t("discount rounding and replace (no stacking)", () => {
    const { service } = svc();
    const o = service.placeOrder({ customer: "a", items: ITEMS() });
    assert.equal(service.applyDiscount(o.id, 10).discount, 10);
    assert.equal(service.total(o.id), 629); // 699*0.9 = 629.1
    service.applyDiscount(o.id, 15);
    assert.equal(service.total(o.id), 594); // 594.15, not stacked
    service.applyDiscount(o.id, 50);
    assert.equal(service.total(o.id), 350); // 349.5 rounds up
    service.applyDiscount(o.id, 100);
    assert.equal(service.total(o.id), 0);
    service.applyDiscount(o.id, 0);
    assert.equal(service.total(o.id), 699);
    service.applyDiscount(o.id, 12.5);
    assert.equal(service.total(o.id), 612); // 611.625
  });

  t("applyDiscount persists through the repository", () => {
    const { repository, service } = svc();
    const o = service.placeOrder({ customer: "a", items: ITEMS() });
    service.applyDiscount(o.id, 20);
    assert.equal(repository.rows[0].discount, 20);
    assert.equal(service.get(o.id).discount, 20);
  });

  t("invalid percent / unknown id throw and change nothing", () => {
    const { repository, service } = svc();
    const o = service.placeOrder({ customer: "a", items: ITEMS() });
    for (const p of [-1, 101, NaN, "10", null, undefined, Infinity])
      assert.throws(() => service.applyDiscount(o.id, p), Error, "percent " + String(p));
    assert.equal(repository.rows[0].discount, 0);
    assert.throws(() => service.applyDiscount("ord-99", 5), Error);
    assert.throws(() => service.total("ord-99"), Error);
    assert.equal(service.get("ord-99"), null);
  });

  t("runtime: no infra/built-in requires while loading and running domain", () => {
    assert.equal([...new Set(seen)].join("; "), "");
  });
}

t("infra: createFileRepository implements the port", () => {
  const { createFileRepository } = require(path.join(infraDir, "file-store.js"));
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ach-repo-")), "nested", "orders");
  const repo = createFileRepository(dir);
  assert.ok(fs.existsSync(dir), "dir created");
  assert.deepEqual(repo.list(), []);
  assert.equal(repo.get("ord-1"), null);
  for (const n of [1, 2, 10]) repo.save({ id: "ord-" + n, customer: "c" + n, items: [], discount: 0, createdAt: "z" });
  assert.deepEqual(fs.readdirSync(dir).sort(), ["ord-1.json", "ord-10.json", "ord-2.json"]);
  assert.deepEqual(repo.list().map((o) => o.id), ["ord-1", "ord-2", "ord-10"]);
  repo.save({ id: "ord-2", customer: "changed", items: [], discount: 5, createdAt: "z" });
  assert.equal(repo.get("ord-2").customer, "changed");
  assert.equal(repo.list().length, 3);
});

t("app: end-to-end behavior preserved against a temp dir", () => {
  const { createApp } = require(path.join(ws, "src", "app.js"));
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ach-app-")), "data");
  const app = createApp(dir);
  const before = Date.now();
  const o1 = app.placeOrder({ customer: "ann", items: ITEMS() });
  const after = Date.now();
  assert.equal(o1.id, "ord-1");
  const ts = Date.parse(o1.createdAt);
  assert.ok(ts >= before && ts <= after, "createdAt from system clock");
  assert.equal(app.placeOrder({ customer: "bob", items: [{ sku: "z", qty: 3, price: 10 }] }).id, "ord-2");
  assert.equal(app.total("ord-1"), 699);
  app.applyDiscount("ord-1", 10);
  app.applyDiscount("ord-1", 20);
  assert.equal(app.total("ord-1"), 559); // 559.2, replaced not stacked
  assert.equal(app.get("ord-1").discount, 20);
  assert.equal(app.get("nope"), null);
  assert.throws(() => app.total("nope"), Error);
  assert.throws(() => app.placeOrder({ customer: "", items: ITEMS() }), Error);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["ord-1.json", "ord-2.json"]);
  // a fresh app on the same directory sees persisted state
  const app2 = createApp(dir);
  assert.equal(app2.get("ord-2").customer, "bob");
  assert.equal(app2.placeOrder({ customer: "cy", items: ITEMS() }).id, "ord-3");
  assert.equal(app2.total("ord-1"), 559);
});

Module._load = origLoad;
