'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const ws = process.env.ACH_WORKSPACE || process.cwd();
const src = path.join(ws, 'src');
let failed = false;
const ok = (n) => console.log(`ok ${n}`);
const fail = (n, w) => { failed = true; console.log(`FAIL ${n}: ${w}`); };

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.(c|m)?js$/.test(e.name) ? [path.join(d, e.name)] : []);
}
function resolve(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + '.js', base + '.cjs', path.join(base, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// Static graph: every relative require anywhere in the file, lazy or not.
const files = walk(src);
const graph = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const deps = [];
  for (const m of text.matchAll(/require\(\s*['"`](\.{1,2}\/?[^'"`]*)['"`]\s*\)/g)) {
    const r = resolve(f, m[1]);
    if (r) deps.push(r);
  }
  graph.set(f, deps);
}
const rel = (f) => path.relative(src, f);
function findCycle() {
  const state = new Map();
  const stack = [];
  function dfs(n) {
    state.set(n, 1); stack.push(n);
    for (const d of graph.get(n) || []) {
      if (state.get(d) === 1) return [...stack.slice(stack.indexOf(d)), d];
      if (!state.get(d)) { const c = dfs(d); if (c) return c; }
    }
    stack.pop(); state.set(n, 2);
    return null;
  }
  for (const n of graph.keys()) if (!state.get(n)) { const c = dfs(n); if (c) return c; }
  return null;
}
const cyc = findCycle();
if (cyc) fail('acyclic-graph', 'require cycle: ' + cyc.map(rel).join(' -> '));
else ok('acyclic-graph');

// Behavior, with each module as the first entry in a fresh process.
const script = `
const assert = require('node:assert');
const entry = process.argv[1];
const first = require(entry + '/src/' + process.argv[2]);
const cat = require(entry + '/src/catalog');
const pri = require(entry + '/src/pricing');
const inv = require(entry + '/src/inventory');
for (const [m, names] of [[cat, ['PRODUCTS','getProduct','catalogTotal']], [pri, ['priceFor']], [inv, ['STOCK','stockOf','reserve','restockList']]])
  for (const n of names) assert.ok(m[n] !== undefined, 'export ' + n + ' is undefined');
assert.deepStrictEqual(Object.keys(cat.PRODUCTS).sort(), ['gadget','gizmo','widget']);
assert.strictEqual(cat.getProduct('gadget').basePrice, 2500);
assert.throws(() => cat.getProduct('nope'), /unknown sku/);
assert.strictEqual(pri.priceFor('widget'), 900);
assert.strictEqual(pri.priceFor('gadget'), 3000);
assert.strictEqual(pri.priceFor('gizmo'), null);
assert.strictEqual(cat.catalogTotal(), 3900);
assert.strictEqual(inv.stockOf('widget'), 100);
assert.throws(() => inv.stockOf('nope'), /unknown sku/);
assert.deepStrictEqual(inv.restockList(), ['gadget', 'gizmo']);
assert.throws(() => inv.reserve('gadget', 4), /insufficient/);
assert.strictEqual(inv.reserve('widget', 60), 40);
assert.strictEqual(inv.STOCK.widget, 40);
assert.strictEqual(pri.priceFor('widget'), 1000);
assert.strictEqual(inv.reserve('gadget', 3), 0);
assert.strictEqual(pri.priceFor('gadget'), null);
assert.strictEqual(cat.catalogTotal(), 1000);
assert.deepStrictEqual(inv.restockList(), ['gadget', 'gizmo']);
`;
for (const m of ['catalog', 'pricing', 'inventory']) {
  const r = spawnSync(process.execPath, ['-e', script, ws, m], { encoding: 'utf8', timeout: 15000 });
  if (r.status === 0) ok(`entry-${m}`);
  else fail(`entry-${m}`, ((r.stderr || '').split('\n').find((l) => /Error/.test(l)) || r.stderr || 'failed').trim());
}
process.exit(failed ? 1 : 0);
