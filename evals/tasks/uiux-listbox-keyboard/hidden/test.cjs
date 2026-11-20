"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const ws = process.env.ACH_WORKSPACE || process.cwd();
let failed = 0;
function t(name, fn) {
  try { fn(); console.log("ok " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.message ? e.message.split("\n")[0] : String(e))); }
}
process.on("exit", () => { if (failed > 0) process.exitCode = 1; });

const { listboxReducer: r, getOptionProps } = require(path.join(ws, "listbox.js"));

function freeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); }
  return o;
}
const OPTS = () => [
  { id: "a1", label: "Apple", disabled: false },
  { id: "a2", label: "Apricot", disabled: true },
  { id: "b1", label: "Banana", disabled: false },
  { id: "a3", label: "Avocado", disabled: false },
  { id: "b2", label: "Blueberry", disabled: false },
  { id: "c1", label: "Cherry" },
];
const mk = (extra) => freeze({ options: OPTS(), activeId: null, selectedId: null, typeahead: { buffer: "", at: 0 }, ...extra });
const key = (s, k, now = 1000) => r(s, { type: "key", key: k, now });
const press = (s, keys, now = 1000) => keys.reduce((st, k) => key(st, k, now), s);

t("ArrowDown skips disabled, no wrap", () => {
  let s = key(mk(), "ArrowDown");
  assert.equal(s.activeId, "a1");
  s = key(s, "ArrowDown"); assert.equal(s.activeId, "b1");
  s = press(s, ["ArrowDown", "ArrowDown", "ArrowDown"]); assert.equal(s.activeId, "c1");
  s = key(s, "ArrowDown"); assert.equal(s.activeId, "c1");
});
t("ArrowUp skips disabled, no wrap", () => {
  let s = key(mk(), "ArrowUp");
  assert.equal(s.activeId, "c1");
  s = press(s, ["ArrowUp", "ArrowUp"]); assert.equal(s.activeId, "a3");
  s = press(s, ["ArrowUp"]); assert.equal(s.activeId, "b1");
  s = key(s, "ArrowUp"); assert.equal(s.activeId, "a1");
  s = key(s, "ArrowUp"); assert.equal(s.activeId, "a1");
});
t("arrows relative to a disabled active option", () => {
  assert.equal(key(mk({ activeId: "a2" }), "ArrowDown").activeId, "b1");
  assert.equal(key(mk({ activeId: "a2" }), "ArrowUp").activeId, "a1");
});
t("Home/End pick first/last enabled", () => {
  const opts = OPTS(); opts[0].disabled = true; opts[5].disabled = true;
  const s = freeze({ options: opts, activeId: "b1", selectedId: null, typeahead: { buffer: "", at: 0 } });
  assert.equal(key(s, "Home").activeId, "b1");
  assert.equal(key(s, "End").activeId, "b2");
  assert.equal(key(mk({ activeId: "b2" }), "Home").activeId, "a1");
  assert.equal(key(mk({ activeId: "b2" }), "End").activeId, "c1");
});
t("Enter and Space select the active option", () => {
  let s = key(mk({ activeId: "b1" }), "Enter");
  assert.equal(s.selectedId, "b1"); assert.equal(s.activeId, "b1");
  s = key(mk({ activeId: "a3" }), " "); assert.equal(s.selectedId, "a3");
  assert.equal(key(mk(), "Enter").selectedId, null);
  assert.equal(key(mk({ activeId: "a2" }), "Enter").selectedId, null);
});
t("Space is not typeahead", () => {
  const s = key(mk({ activeId: "b1" }), " ");
  assert.equal(s.typeahead.buffer, "");
});
t("Escape restores activeId to selectedId", () => {
  assert.equal(key(mk({ activeId: "b2", selectedId: "a1" }), "Escape").activeId, "a1");
  assert.equal(key(mk({ activeId: "b2" }), "Escape").activeId, null);
});
t("typeahead single char, case-insensitive", () => {
  assert.equal(key(mk(), "b").activeId, "b1");
  assert.equal(key(mk(), "C").activeId, "c1");
  assert.deepEqual(key(mk(), "C", 77).typeahead, { buffer: "c", at: 77 });
});
t("typeahead skips disabled options", () => {
  const s = key(mk({ activeId: "a1" }), "a");
  assert.equal(s.activeId, "a3");
});
t("repeated same char cycles and wraps", () => {
  let s = key(mk(), "a", 1000); assert.equal(s.activeId, "a1");
  s = key(s, "a", 1100); assert.equal(s.activeId, "a3");
  assert.equal(s.typeahead.buffer, "aa");
  s = key(s, "a", 1200); assert.equal(s.activeId, "a1");
  s = key(s, "a", 1300); assert.equal(s.activeId, "a3");
});
t("multi-char buffer searches from active inclusive", () => {
  let s = key(mk(), "b", 1000); assert.equal(s.activeId, "b1");
  s = key(s, "l", 1100); assert.equal(s.activeId, "b2");
  assert.equal(s.typeahead.buffer, "bl");
  s = key(s, "u", 1200); assert.equal(s.activeId, "b2");
});
t("multi-char buffer wraps around", () => {
  const s = key(key(mk({ activeId: "c1" }), "a", 1000), "v", 1100);
  assert.equal(s.activeId, "a3");
  assert.equal(s.typeahead.buffer, "av");
});
t("buffer resets after a gap over 500 ms", () => {
  let s = key(mk(), "b", 1000);
  s = key(s, "a", 1600);
  assert.equal(s.typeahead.buffer, "a");
  assert.equal(s.activeId, "a3");
});
t("gap of exactly 500 ms continues the buffer", () => {
  let s = key(mk(), "b", 1000);
  s = key(s, "a", 1500);
  assert.equal(s.typeahead.buffer, "ba");
  assert.equal(s.activeId, "b1");
});
t("no match keeps activeId, still updates buffer", () => {
  const s = key(mk({ activeId: "b1", selectedId: "c1" }), "z", 2000);
  assert.equal(s.activeId, "b1"); assert.equal(s.selectedId, "c1");
  assert.deepEqual(s.typeahead, { buffer: "z", at: 2000 });
});
t("typeahead never changes selectedId", () => {
  assert.equal(key(mk({ selectedId: "c1" }), "b").selectedId, "c1");
});
t("click enabled selects and activates", () => {
  const s = r(mk({ activeId: "a1" }), { type: "click", id: "b2" });
  assert.equal(s.activeId, "b2"); assert.equal(s.selectedId, "b2");
});
t("click disabled or unknown does nothing", () => {
  const base = mk({ activeId: "a1", selectedId: "c1" });
  for (const id of ["a2", "nope"]) {
    const s = r(base, { type: "click", id });
    assert.equal(s.activeId, "a1"); assert.equal(s.selectedId, "c1");
  }
});
t("unknown keys leave state equivalent", () => {
  const base = mk({ activeId: "b1" });
  assert.deepEqual(key(base, "Tab"), base);
  assert.deepEqual(key(base, "F5"), base);
});
t("does not mutate input (deep-frozen) and returns new state", () => {
  const base = mk({ activeId: "a1" });
  const s = key(base, "ArrowDown");
  assert.notEqual(s, base);
  assert.equal(base.activeId, "a1");
  assert.deepEqual(base.typeahead, { buffer: "", at: 0 });
});
t("getOptionProps", () => {
  const s = mk({ selectedId: "b1" });
  assert.deepEqual(getOptionProps(s, "b1"), { role: "option", id: "b1", "aria-selected": true, "aria-disabled": false });
  assert.deepEqual(getOptionProps(s, "a2"), { role: "option", id: "a2", "aria-selected": false, "aria-disabled": true });
  assert.deepEqual(getOptionProps(s, "c1"), { role: "option", id: "c1", "aria-selected": false, "aria-disabled": false });
});
