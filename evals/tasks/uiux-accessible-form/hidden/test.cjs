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

const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === "#") return String.fromCodePoint(g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" }[g.toLowerCase()] ?? m;
  });

const VOID = new Set(["input", "br", "hr", "img", "meta", "link"]);
// Minimal tokenizer + tree builder: tags, attributes (any order/quoting), text, comments.
function parse(html) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  let cur = root, i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const e = html.indexOf("-->", i + 4);
      i = e < 0 ? html.length : e + 3;
    } else if (html[i] === "<" && /[a-zA-Z\/!]/.test(html[i + 1] || "")) {
      if (html[i + 1] === "!") { i = html.indexOf(">", i) + 1 || html.length; continue; }
      if (html[i + 1] === "/") {
        const e = html.indexOf(">", i);
        const name = html.slice(i + 2, e).trim().toLowerCase();
        let n = cur;
        while (n && n.tag !== name) n = n.parent;
        if (n && n.parent) cur = n.parent;
        i = e + 1;
        continue;
      }
      let j = i + 1;
      while (/[^\s\/>]/.test(html[j])) j++;
      const tag = html.slice(i + 1, j).toLowerCase();
      const attrs = {};
      for (;;) {
        while (/\s/.test(html[j] || "")) j++;
        if (j >= html.length) break;
        if (html[j] === ">") { j++; break; }
        if (html[j] === "/") { j++; continue; }
        let k = j;
        while (j < html.length && /[^\s=>\/]/.test(html[j])) j++;
        const an = html.slice(k, j).toLowerCase();
        while (/\s/.test(html[j] || "")) j++;
        let val = "";
        if (html[j] === "=") {
          j++;
          while (/\s/.test(html[j] || "")) j++;
          if (html[j] === '"' || html[j] === "'") {
            const q = html[j], e = html.indexOf(q, j + 1);
            val = html.slice(j + 1, e < 0 ? html.length : e);
            j = e < 0 ? html.length : e + 1;
          } else {
            k = j;
            while (j < html.length && /[^\s>]/.test(html[j])) j++;
            val = html.slice(k, j);
          }
        }
        if (!(an in attrs)) attrs[an] = decode(val);
      }
      const node = { tag, attrs, children: [], parent: cur };
      cur.children.push(node);
      if (!VOID.has(tag)) cur = node;
      i = j;
    } else {
      let e = html.indexOf("<", i + 1);
      if (e < 0) e = html.length;
      cur.children.push({ text: decode(html.slice(i, e)) });
      i = e;
    }
  }
  return root;
}
const all = (n, out = []) => { for (const c of n.children || []) { if (c.tag) { out.push(c); all(c, out); } } return out; };
const text = (n) => (n.text !== undefined ? n.text : (n.children || []).map(text).join(""));
const norm = (s) => s.replace(/\s+/g, " ").trim();

const { renderSignupForm } = require(path.join(ws, "form.js"));
const render = (a) => { const h = renderSignupForm(a); assert.equal(typeof h, "string"); const root = parse(h); return { h, root, els: all(root) }; };
const SPEC = [
  ["name", "text", "name", "Full name"],
  ["email", "email", "email", "Email address"],
  ["password", "password", "new-password", "Password"],
];
const byId = (els, id) => els.filter((e) => e.attrs.id === id);
const tokens = (s) => (s || "").split(/\s+/).filter(Boolean);

function structure(els) {
  const forms = els.filter((e) => e.tag === "form");
  assert.equal(forms.length, 1, "exactly one form");
  assert.equal((forms[0].attrs.method || "").toLowerCase(), "post");
  const inputs = els.filter((e) => e.tag === "input");
  assert.equal(inputs.length, 3, "three inputs");
  const ids = els.map((e) => e.attrs.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "duplicate ids");
  SPEC.forEach(([id, type, ac, label], idx) => {
    const inp = inputs[idx];
    assert.equal(inp.attrs.id, id, `input #${idx} id`);
    assert.equal(inp.attrs.name, id, `${id} name`);
    assert.equal(inp.attrs.type, type, `${id} type`);
    assert.equal(inp.attrs.autocomplete, ac, `${id} autocomplete`);
    assert.ok("required" in inp.attrs, `${id} required`);
    const labels = els.filter((e) => e.tag === "label" && e.attrs.for === id);
    assert.equal(labels.length, 1, `${id} needs one label[for]`);
    assert.equal(norm(text(labels[0])), label, `${id} label text`);
  });
  const btns = els.filter((e) => e.tag === "button");
  assert.equal(btns.length, 1, "one button");
  assert.equal(btns[0].attrs.type, "submit");
  assert.equal(norm(text(btns[0])), "Create account");
  assert.equal(els.filter((e) => e.attrs.onclick !== undefined || e.attrs.role === "button").length, 0, "no fake buttons / inline handlers");
}

function describedText(els, inp) {
  return tokens(inp.attrs["aria-describedby"]).map((id) => {
    const m = byId(els, id);
    assert.equal(m.length, 1, `aria-describedby id "${id}" must resolve to one element`);
    return { id, text: norm(text(m[0])) };
  });
}

t("valid state: structure, labels, hint", () => {
  const { els } = render({ values: { name: "Ada Lovelace", email: "ada@example.com" }, errors: {} });
  structure(els);
  const inputs = els.filter((e) => e.tag === "input");
  assert.equal(inputs[0].attrs.value, "Ada Lovelace");
  assert.equal(inputs[1].attrs.value, "ada@example.com");
  for (const i of inputs) assert.ok(!i.attrs["aria-invalid"] || i.attrs["aria-invalid"] === "false", "no aria-invalid when valid");
  for (const i of inputs.slice(0, 2)) assert.equal(i.attrs["aria-describedby"], undefined, "no describedby without error");
  const d = describedText(els, inputs[2]);
  assert.ok(d.some((x) => x.text === "At least 12 characters."), "password hint linked");
  assert.equal(els.filter((e) => e.attrs.role === "alert").length, 0, "no alert without errors");
});

t("defaults: no arguments / empty object", () => {
  structure(render().els);
  structure(render({}).els);
});

t("password value is never echoed", () => {
  const { h } = render({ values: { password: "hunter2-secret-pw" } });
  assert.ok(!h.includes("hunter2-secret-pw"));
});

t("invalid state: aria-invalid, describedby with error text and hint", () => {
  const errors = { email: "Enter a valid email.", password: "Too short & weak." };
  const { els } = render({ values: { name: "Bo", email: "nope" }, errors });
  structure(els);
  const [name, email, pw] = els.filter((e) => e.tag === "input");
  assert.ok(!name.attrs["aria-invalid"] || name.attrs["aria-invalid"] === "false");
  assert.equal(name.attrs["aria-describedby"], undefined);
  assert.equal(email.attrs["aria-invalid"], "true");
  const de = describedText(els, email);
  assert.equal(de.length, 1);
  assert.equal(de[0].text, "Enter a valid email.");
  assert.equal(pw.attrs["aria-invalid"], "true");
  const dp = describedText(els, pw).map((x) => x.text);
  assert.equal(dp.length, 2);
  assert.ok(dp.includes("At least 12 characters."), "hint kept");
  assert.ok(dp.includes("Too short & weak."), "error text decoded");
});

t("error summary: alert, focusable, links in field order", () => {
  const errors = { name: "Name is required.", password: "Too short." };
  const { els } = render({ errors });
  const alerts = els.filter((e) => e.attrs.role === "alert");
  assert.equal(alerts.length, 1, "exactly one role=alert");
  assert.equal(alerts[0].attrs.tabindex, "-1");
  const links = all(alerts[0]).filter((e) => e.tag === "a");
  assert.deepEqual(links.map((a) => a.attrs.href), ["#name", "#password"]);
  assert.ok(text(links[0]).includes("Name is required."));
  assert.ok(text(links[1]).includes("Too short."));
  for (const a of links) assert.equal(byId(els, a.attrs.href.slice(1)).length, 1, "link target exists");
});

t("all three errors", () => {
  const { els } = render({ errors: { name: "a", email: "b", password: "c" } });
  structure(els);
  const alert = els.find((e) => e.attrs.role === "alert");
  assert.equal(all(alert).filter((e) => e.tag === "a").length, 3);
  assert.equal(els.filter((e) => e.tag === "input" && e.attrs["aria-invalid"] === "true").length, 3);
});

t("empty / unknown error entries are ignored", () => {
  const { els } = render({ errors: { name: "", email: undefined, bogus: "x" } });
  assert.equal(els.filter((e) => e.attrs.role === "alert").length, 0);
  assert.equal(els.filter((e) => e.attrs["aria-invalid"] === "true").length, 0);
});

t("XSS: values and errors are escaped", () => {
  const evil = `"><script>alert(1)</script><img src=x onerror=alert(2)> ' & <b>`;
  const { h, els } = render({ values: { name: evil, email: evil }, errors: { name: evil, email: "<i>bad</i>" } });
  structure(els);
  assert.equal(els.filter((e) => e.tag === "script" || e.tag === "img" || e.tag === "b" || e.tag === "i").length, 0, "injected tags");
  assert.ok(!els.some((e) => "onerror" in e.attrs));
  assert.ok(!h.includes("<script"));
  const [name, email] = els.filter((e) => e.tag === "input");
  assert.equal(name.attrs.value, evil, "value round-trips");
  assert.equal(email.attrs.value, evil);
  assert.equal(describedText(els, name)[0].text, norm(evil));
  assert.equal(describedText(els, email)[0].text, "<i>bad</i>");
});
