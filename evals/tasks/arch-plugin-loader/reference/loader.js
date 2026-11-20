"use strict";

const VER = /^\d+\.\d+\.\d+$/;
const RANGE = /^(>=|~|\^)?(\d+\.\d+\.\d+)$/;
const parse = (v) => v.split(".").map(Number);
function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function satisfies(version, range) {
  const [, op, base] = RANGE.exec(range);
  const v = parse(version);
  const b = parse(base);
  if (!op) return cmp(v, b) === 0;
  if (op === ">=") return cmp(v, b) >= 0;
  let upper;
  if (op === "~") upper = [b[0], b[1] + 1, 0];
  else if (b[0] > 0) upper = [b[0] + 1, 0, 0];
  else if (b[1] > 0) upper = [0, b[1] + 1, 0];
  else upper = [0, 0, b[2] + 1];
  return cmp(v, b) >= 0 && cmp(v, upper) < 0;
}

function fail(code, message, extra) {
  return Object.assign(new Error(message), { code }, extra);
}

function validate(plugins) {
  const byName = new Map();
  for (const p of plugins) {
    if (byName.has(p.name)) throw fail("DUPLICATE_PLUGIN", "duplicate plugin " + p.name);
    byName.set(p.name, p);
  }
  for (const p of plugins) {
    if (!VER.test(p.version)) throw new TypeError("bad version for " + p.name + ": " + p.version);
    for (const [dep, range] of Object.entries(p.requires || {})) {
      if (typeof range !== "string" || !RANGE.test(range)) {
        throw new TypeError("bad range for " + p.name + " -> " + dep + ": " + range);
      }
    }
  }
  for (const p of plugins) {
    for (const [dep, range] of Object.entries(p.requires || {})) {
      const d = byName.get(dep);
      if (!d) throw fail("MISSING_DEPENDENCY", p.name + " requires missing plugin " + dep);
      if (!satisfies(d.version, range)) {
        throw fail(
          "INCOMPATIBLE_VERSION",
          p.name + " requires " + dep + " " + range + " but found " + d.version
        );
      }
    }
  }
  return byName;
}

function findCycle(rest, byName) {
  const inRest = new Set(rest.map((p) => p.name));
  const seen = [];
  let cur = rest[0].name;
  while (!seen.includes(cur)) {
    seen.push(cur);
    cur = Object.keys(byName.get(cur).requires || {}).find((d) => inRest.has(d));
  }
  const cycle = seen.slice(seen.indexOf(cur)).concat(cur);
  return fail("DEPENDENCY_CYCLE", "dependency cycle: " + cycle.join(" -> "), { cycle });
}

async function disposeAll(list, errors) {
  for (const p of list.slice().reverse()) {
    if (typeof p.dispose !== "function") continue;
    try {
      await p.dispose();
    } catch (e) {
      errors.push(e);
    }
  }
}

async function loadPlugins(plugins, host) {
  const byName = validate(plugins);
  const apis = new Map();
  const done = [];
  const sorted = [];
  const seen = new Set();
  let pending = plugins.slice();
  while (pending.length) {
    const next = pending.find((p) => Object.keys(p.requires || {}).every((d) => seen.has(d)));
    if (!next) throw findCycle(pending, byName);
    sorted.push(next);
    seen.add(next.name);
    pending = pending.filter((p) => p !== next);
  }
  for (const next of sorted) {
    const deps = new Set(Object.keys(next.requires || {}));
    const ctx = {
      host,
      name: next.name,
      get(dep) {
        if (!deps.has(dep)) throw new Error(next.name + " did not declare dependency " + dep);
        return apis.get(dep);
      },
    };
    try {
      apis.set(next.name, await next.init(ctx));
    } catch (e) {
      await disposeAll(done, []);
      throw e;
    }
    done.push(next);
  }
  let unloaded = false;
  return {
    order: done.map((p) => p.name),
    get: (name) => apis.get(name),
    async unloadAll() {
      if (unloaded) return;
      unloaded = true;
      const errors = [];
      await disposeAll(done, errors);
      if (errors.length) throw new AggregateError(errors, "unload failed");
    },
  };
}

module.exports = { loadPlugins };
