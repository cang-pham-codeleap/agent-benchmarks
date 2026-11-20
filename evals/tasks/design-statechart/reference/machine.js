"use strict";

const bad = (m) => new Error("Invalid machine config: " + m);
const isAssign = (a) => a !== null && typeof a === "object" && a.type === "assign" && "update" in a;
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

function assign(update) {
  if (typeof update !== "function" && !isObj(update)) throw new TypeError("assign() needs a function or an object");
  return { type: "assign", update };
}

function actionList(x, where) {
  if (x === undefined) return [];
  const list = Array.isArray(x) ? x : [x];
  for (const a of list) if (typeof a !== "function" && !isAssign(a)) throw bad(where + ": action must be a function or assign()");
  return list;
}

function build(key, def, parent) {
  const path = parent && parent.parent ? parent.path + "." + key : parent ? key : "";
  const where = 'state "' + path + '"';
  if (!isObj(def)) throw bad(where + " must be an object");
  if (def.type !== undefined && def.type !== "final" && def.type !== "history") throw bad(where + ": unknown type");
  if (parent && (!key || key.includes(".") || key.startsWith("#"))) throw bad("illegal state key " + JSON.stringify(key));
  const childDefs = def.states;
  if (childDefs !== undefined && !isObj(childDefs)) throw bad(where + ": states must be an object");
  const hasKids = childDefs !== undefined && Object.keys(childDefs).length > 0;
  const kind = def.type || (hasKids ? "compound" : "atomic");
  const node = { key, path, parent, kind, children: new Map(), initial: def.initial, entry: [], exit: [], on: new Map(), raw: def };
  if (kind === "final" || kind === "history") {
    if (hasKids) throw bad(where + ": " + kind + " state cannot have states");
    if (def.on !== undefined) throw bad(where + ": " + kind + " state cannot have on");
    if (kind === "history" && (def.entry !== undefined || def.exit !== undefined || def.initial !== undefined)) {
      throw bad(where + ": history state cannot have entry/exit/initial");
    }
  }
  node.entry = actionList(def.entry, where + " entry");
  node.exit = actionList(def.exit, where + " exit");
  if (hasKids) for (const k of Object.keys(childDefs)) node.children.set(k, build(k, childDefs[k], node));
  return node;
}

function validateCompound(node) {
  if (node.children.size > 0) {
    const init = node.children.get(node.initial);
    if (!init) throw bad('state "' + node.path + '": missing or unknown initial');
    if (init.kind === "history") throw bad('state "' + node.path + '": initial cannot be a history state');
    node.children.forEach(validateCompound);
  }
}

function resolve(from, str, where) {
  if (typeof str !== "string") throw bad(where + ": target must be a string");
  let cur, rest;
  if (str.startsWith("#")) [cur, rest] = [rootOf(from), str.slice(1)];
  else if (str.startsWith(".")) [cur, rest] = [from, str.slice(1)];
  else [cur, rest] = [from.parent || from, str];
  for (const k of rest.split(".")) {
    cur = cur.children.get(k);
    if (!cur) throw bad(where + ': cannot resolve target "' + str + '"');
  }
  return cur;
}
const rootOf = (n) => (n.parent ? rootOf(n.parent) : n);

function compileTransitions(node) {
  const where = 'state "' + node.path + '"';
  const on = node.raw.on;
  if (on !== undefined && !isObj(on)) throw bad(where + ": on must be an object");
  for (const [type, spec] of Object.entries(on || {})) {
    const list = (Array.isArray(spec) ? spec : [spec]).map((t) => {
      const o = typeof t === "string" ? { target: t } : t;
      if (!isObj(o)) throw bad(where + " on " + type + ": invalid transition");
      if (o.cond !== undefined && typeof o.cond !== "function") throw bad(where + " on " + type + ": cond must be a function");
      return {
        cond: o.cond,
        internal: o.internal === true,
        actions: actionList(o.actions, where + " on " + type),
        target: o.target === undefined ? null : resolve(node, o.target, where + " on " + type),
      };
    });
    node.on.set(type, list);
  }
  node.children.forEach(compileTransitions);
}

function finishHistory(node) {
  if (node.kind === "history" && node.raw.target !== undefined) {
    const t = node.parent.children.get(node.raw.target);
    if (!t || t.kind === "history") throw bad('history "' + node.path + '": bad target');
    node.defaultTarget = t;
  }
  node.children.forEach(finishHistory);
}

function buildRoot(config) {
  if (!isObj(config) || !isObj(config.states)) throw bad("states must be an object");
  if (config.entry !== undefined || config.exit !== undefined) throw bad("root cannot have entry/exit");
  const root = build("", { initial: config.initial, on: config.on, states: config.states }, null);
  if (root.children.size === 0) throw bad("states must not be empty");
  validateCompound(root);
  compileTransitions(root);
  finishHistory(root);
  return root;
}

const shallowEqual = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && Object.is(a[k], b[k]));
};

function createMachine(config) {
  const root = buildRoot(config);
  const byPath = new Map();
  (function index(n) { byPath.set(n.path, n); n.children.forEach(index); })(root);

  let ctx = structuredClone(config.context === undefined ? {} : config.context);
  let leaf = null;
  let history = {};
  const queue = [];
  const done = () => leaf.kind === "final" && leaf.parent === root;

  function run(actions, event) {
    for (const a of actions) {
      if (typeof a === "function") { a(ctx, event); continue; }
      const u = a.update;
      let patch;
      if (typeof u === "function") patch = u(ctx, event);
      else {
        patch = {};
        for (const k of Object.keys(u)) patch[k] = typeof u[k] === "function" ? u[k](ctx, event) : u[k];
      }
      ctx = { ...ctx, ...patch };
    }
  }

  function exitState(n, event) {
    run(n.exit, event);
    history[n.parent.path] = n.key;
  }

  function enterOne(n, event) {
    run(n.entry, event);
    if (n.kind !== "compound") leaf = n;
    if (n.kind === "final" && n.parent !== root) queue.push({ type: "done.state." + n.parent.path });
  }

  function descend(n, event) {
    while (n.kind === "compound") {
      n = n.children.get(n.initial);
      enterOne(n, event);
    }
  }

  function enterFrom(D, T, event) {
    const chain = [];
    for (let x = T; x !== D; x = x.parent) chain.unshift(x);
    for (const n of chain) {
      if (n.kind === "history") {
        const p = n.parent;
        const c = p.children.get(history[p.path]) || n.defaultTarget || p.children.get(p.initial);
        enterOne(c, event);
        descend(c, event);
        return;
      }
      enterOne(n, event);
    }
    descend(T, event);
  }

  function domain(S, T, internal) {
    if (S === root) return root;
    const props = new Set();
    for (let x = S.parent; x; x = x.parent) props.add(x);
    if (internal && T !== S) {
      for (let x = T.parent; x; x = x.parent) if (x === S) return S;
    }
    for (let x = T.parent; x; x = x.parent) if (props.has(x)) return x;
    return root;
  }

  function step(event) {
    let found = null;
    for (let x = leaf; x && !found; x = x.parent) {
      for (const t of x.on.get(event.type) || []) {
        if (!t.cond || t.cond(ctx, event)) { found = { S: x, t }; break; }
      }
    }
    if (!found) return;
    const { S, t } = found;
    if (!t.target) return run(t.actions, event);
    const D = domain(S, t.target, t.internal);
    for (let x = leaf; x !== D; x = x.parent) exitState(x, event);
    run(t.actions, event);
    enterFrom(D, t.target, event);
  }

  function drain() {
    while (queue.length && !done()) step(queue.shift());
    queue.length = 0;
  }

  const init = { type: "init" };
  enterFrom(root, root.children.get(root.initial), init);
  drain();

  return {
    send(e) {
      const event = typeof e === "string" ? { type: e } : e;
      if (!isObj(event) || typeof event.type !== "string") throw new TypeError("event must be a string or { type: string }");
      const beforeValue = leaf.path;
      const beforeCtx = ctx;
      if (!done()) {
        step(event);
        drain();
      }
      return { value: leaf.path, context: ctx, changed: leaf.path !== beforeValue || !shallowEqual(beforeCtx, ctx) };
    },
    snapshot() {
      return { value: leaf.path, context: structuredClone(ctx), history: { ...history } };
    },
    restore(snap) {
      const node = isObj(snap) ? byPath.get(snap.value) : undefined;
      if (!node || node.kind === "compound" || node.kind === "history" || node === root) throw new Error("restore: value is not a leaf state");
      const h = snap.history === undefined ? {} : snap.history;
      if (!isObj(h)) throw new Error("restore: bad history");
      for (const [p, k] of Object.entries(h)) {
        const parent = byPath.get(p);
        const child = parent && parent.children.get(k);
        if (!child || child.kind === "history") throw new Error("restore: bad history entry " + p);
      }
      leaf = node;
      ctx = structuredClone(snap.context === undefined ? {} : snap.context);
      history = { ...h };
      queue.length = 0;
      return { value: leaf.path, context: ctx, changed: false };
    },
  };
}

module.exports = { createMachine, assign };
