"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

const mod = require(path.join(ws, "notify.js"));
const { createNotifier } = mod;
assert.equal(typeof createNotifier, "function", "createNotifier export missing");

const email = { channel: "email", to: "a@b.co", subject: "Hi", body: "hello" };
const sms = { channel: "sms", to: "+15551234567", body: "yo" };
const slack = { channel: "slack", to: "#dev-ops_1", body: "deploy" };
const recorder = (name) => {
  const calls = [];
  return {
    calls,
    validate(m) {
      calls.push("validate");
      if (!m.to) throw new RangeError("to required for " + name);
    },
    deliver(m) {
      calls.push("deliver");
      return { delivered: name, to: m.to };
    },
  };
};

t("built-ins registered in order", () => {
  assert.deepEqual(createNotifier().channels(), ["email", "sms", "slack"]);
});
t("email delivery", () => {
  assert.deepEqual(createNotifier().send(email), {
    channel: "email",
    result: "To: a@b.co\nSubject: Hi\n\nhello",
  });
});
t("sms delivery and 160 limit", () => {
  const n = createNotifier();
  assert.deepEqual(n.send(sms), { channel: "sms", result: "yo" });
  const max = "x".repeat(160);
  assert.equal(n.send({ ...sms, body: max }).result, max);
  assert.throws(() => n.send({ ...sms, body: max + "x" }), TypeError);
});
t("slack delivery", () => {
  assert.deepEqual(createNotifier().send(slack), { channel: "slack", result: "[#dev-ops_1] deploy" });
});
t("built-in validation rejects with TypeError", () => {
  const n = createNotifier();
  const bad = [
    { ...email, to: "nope" },
    { ...email, to: "a@@b" },
    { ...email, to: "a b@c" },
    { ...email, to: "@b" },
    { ...email, to: "a@" },
    { ...email, subject: "" },
    { ...email, subject: undefined },
    { ...email, body: "  \n" },
    { ...email, body: 5 },
    { ...sms, to: "5551234567" },
    { ...sms, to: "+1234567" },
    { ...sms, to: "+1234567890123456" },
    { ...sms, to: "+12345abc890" },
    { ...sms, body: "" },
    { ...slack, to: "dev" },
    { ...slack, to: "#" },
    { ...slack, to: "#Dev" },
    { ...slack, body: "   " },
  ];
  for (const m of bad) assert.throws(() => n.send(m), TypeError, JSON.stringify(m));
  assert.equal(n.send({ ...sms, to: "+12345678" }).result, "yo");
  assert.equal(n.send({ ...sms, to: "+123456789012345" }).result, "yo");
  assert.equal(n.send({ ...sms, body: "  " }).result, "  ");
  assert.throws(() => n.send(null), TypeError);
  assert.throws(() => n.send("email"), TypeError);
});
t("custom channel registered at runtime", () => {
  const n = createNotifier();
  const pager = recorder("pager");
  n.register("pager", pager);
  assert.deepEqual(n.channels(), ["email", "sms", "slack", "pager"]);
  const r = n.send({ channel: "pager", to: "oncall" });
  assert.deepEqual(r, { channel: "pager", result: { delivered: "pager", to: "oncall" } });
  assert.deepEqual(pager.calls, ["validate", "deliver"]);
  n.send({ channel: "pager", to: "oncall" });
  assert.deepEqual(pager.calls, ["validate", "deliver", "validate", "deliver"]);
});
t("custom validation failure propagates unchanged and skips deliver", () => {
  const n = createNotifier();
  const c = recorder("x");
  n.register("x", c);
  assert.throws(() => n.send({ channel: "x" }), (e) => e instanceof RangeError && /to required for x/.test(e.message));
  assert.deepEqual(c.calls, ["validate"]);
});
t("unknown channel throws and delivers nothing", () => {
  const n = createNotifier();
  const c = recorder("x");
  n.register("x", c);
  for (const name of ["fax", "EMAIL", "constructor", "toString", "__proto__", "hasOwnProperty", undefined, 7]) {
    assert.throws(
      () => n.send({ channel: name, to: "t" }),
      (e) => e instanceof Error && e.message.includes(String(name)),
      String(name),
    );
  }
  assert.deepEqual(c.calls, []);
});
t("register refuses duplicates and keeps the original", () => {
  const n = createNotifier();
  const first = recorder("first");
  n.register("pager", first);
  assert.throws(() => n.register("pager", recorder("second")), (e) => e instanceof Error && e.message.includes("pager"));
  assert.throws(() => n.register("email", recorder("evil")), (e) => e instanceof Error && e.message.includes("email"));
  assert.deepEqual(n.channels(), ["email", "sms", "slack", "pager"]);
  assert.equal(n.send({ channel: "pager", to: "t" }).result.delivered, "first");
  assert.equal(n.send(email).result, "To: a@b.co\nSubject: Hi\n\nhello");
  n.register("Pager", recorder("case")); // names are case-sensitive
});
t("register validates its arguments", () => {
  const n = createNotifier();
  const ok = recorder("ok");
  assert.throws(() => n.register("", ok), TypeError);
  assert.throws(() => n.register(5, ok), TypeError);
  assert.throws(() => n.register("a", null), TypeError);
  assert.throws(() => n.register("a", { validate() {} }), TypeError);
  assert.throws(() => n.register("a", { deliver() {} }), TypeError);
  assert.deepEqual(n.channels(), ["email", "sms", "slack"]);
});
t("notifiers are isolated from each other and from exported send", () => {
  const a = createNotifier();
  const b = createNotifier();
  a.register("pager", recorder("pager"));
  assert.deepEqual(b.channels(), ["email", "sms", "slack"]);
  assert.throws(() => b.send({ channel: "pager", to: "t" }), /pager/);
  assert.throws(() => mod.send({ channel: "pager", to: "t" }), /pager/);
  b.register("pager", recorder("again")); // no duplicate error: separate registry
  assert.equal(b.send({ channel: "pager", to: "t" }).result.delivered, "again");
  assert.equal(a.send({ channel: "pager", to: "t" }).result.delivered, "pager");
  const c = createNotifier();
  assert.deepEqual(c.channels(), ["email", "sms", "slack"]);
});
t("channels() returns a copy", () => {
  const n = createNotifier();
  n.channels().push("junk");
  assert.deepEqual(n.channels(), ["email", "sms", "slack"]);
});
t("exported send behaves like the built-ins", () => {
  assert.equal(typeof mod.send, "function");
  assert.deepEqual(mod.send(sms), { channel: "sms", result: "yo" });
  assert.throws(() => mod.send({ channel: "fax" }), /fax/);
  const { send } = mod; // must work detached from any object
  assert.equal(send(slack).result, "[#dev-ops_1] deploy");
});
t("send works detached from the notifier object", () => {
  const { send, register } = createNotifier();
  assert.equal(send(slack).result, "[#dev-ops_1] deploy");
  register("p", recorder("p"));
  assert.equal(send({ channel: "p", to: "t" }).result.delivered, "p");
});
t("no channel-name branching in dispatch code", () => {
  const skip = new Set(["node_modules", ".git"]);
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(c|m)?js$/.test(e.name)) files.push(p);
    }
  })(ws);
  assert.ok(files.length > 0);
  for (const f of files) {
    const src = fs
      .readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(!/\bswitch\s*\(/.test(src), `${path.relative(ws, f)} uses switch`);
    assert.ok(
      !/(===?|!==?)\s*(["'`])(email|sms|slack)\2|(["'`])(email|sms|slack)\4\s*(===?|!==?)/.test(src),
      `${path.relative(ws, f)} compares against a channel name`,
    );
    assert.ok(!/\bcase\s+(["'`])(email|sms|slack)\1/.test(src), `${path.relative(ws, f)} has channel case label`);
  }
});
