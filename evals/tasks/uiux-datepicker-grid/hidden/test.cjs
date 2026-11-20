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
    console.log("FAIL " + name + ": " + (e && e.message ? e.message.split("\n")[0] : String(e)));
  }
}
process.on("exit", () => {
  if (failed > 0) process.exitCode = 1;
});

const { buildMonth, move, gridProps } = require(path.join(ws, "datepicker.js"));
const flat = (w) => w.flat();
const isos = (w) => flat(w).map((c) => c.iso);
const S = (focused, extra = {}) => ({ focused, selected: null, ...extra });
const mv = (focused, key, extra) => move(S(focused, extra), key).focused;

// ---- buildMonth
t("buildMonth: Feb 2026 Sunday-start is exactly 4 full weeks", () => {
  const w = buildMonth({ year: 2026, month: 2 });
  assert.equal(w.length, 4);
  assert.ok(w.every((r) => r.length === 7));
  assert.equal(isos(w)[0], "2026-02-01");
  assert.equal(isos(w)[27], "2026-02-28");
  assert.ok(flat(w).every((c) => c.inMonth));
});
t("buildMonth: Feb 2026 Monday-start needs 5 weeks with padding", () => {
  const w = buildMonth({ year: 2026, month: 2, firstDayOfWeek: 1 });
  assert.equal(w.length, 5);
  assert.equal(isos(w)[0], "2026-01-26");
  assert.equal(isos(w)[34], "2026-03-01");
  assert.deepEqual(flat(w).map((c) => c.inMonth), [...Array(6).fill(false), ...Array(28).fill(true), false]);
});
t("buildMonth: Aug 2025 needs 6 weeks", () => {
  const w = buildMonth({ year: 2025, month: 8 });
  assert.equal(w.length, 6);
  assert.equal(isos(w)[0], "2025-07-27");
  assert.equal(isos(w)[41], "2025-09-06");
});
t("buildMonth: Jan 2025 pads from previous year; Saturday-start", () => {
  const a = buildMonth({ year: 2025, month: 1 });
  assert.equal(a.length, 5);
  assert.equal(isos(a)[0], "2024-12-29");
  assert.equal(isos(a)[34], "2025-02-01");
  const b = buildMonth({ year: 2025, month: 1, firstDayOfWeek: 6 });
  assert.equal(b.length, 5);
  assert.equal(isos(b)[0], "2024-12-28");
  assert.equal(isos(b)[34], "2025-01-31");
});
t("buildMonth: June 2025 starts on the first column", () => {
  const w = buildMonth({ year: 2025, month: 6 });
  assert.equal(w.length, 5);
  assert.equal(w[0][0].iso, "2025-06-01");
  assert.equal(w[4][1].iso, "2025-06-30");
});
t("buildMonth: December rolls into next year", () => {
  const w = buildMonth({ year: 2025, month: 12 });
  assert.equal(isos(w).at(-1), "2026-01-03");
  assert.equal(w[0][0].iso, "2025-11-30");
});
t("buildMonth: leap and non-leap February lengths", () => {
  const leap = buildMonth({ year: 2000, month: 2, firstDayOfWeek: 2 });
  assert.equal(leap.length, 5);
  assert.equal(leap[4][0].iso, "2000-02-29");
  assert.equal(leap[4][6].iso, "2000-03-06");
  const c1900 = buildMonth({ year: 1900, month: 2, firstDayOfWeek: 4 });
  assert.equal(c1900.length, 4);
  assert.equal(isos(c1900).at(-1), "1900-02-28");
  const y2100 = isos(buildMonth({ year: 2100, month: 2 })).filter((i) => i.startsWith("2100-02"));
  assert.equal(y2100.length, 28);
});
t("buildMonth: years below 100 keep 4-digit ISO format", () => {
  const all = isos(buildMonth({ year: 99, month: 2 }));
  assert.ok(all.every((i) => /^\d{4}-\d\d-\d\d$/.test(i)), all.join());
  assert.ok(all.includes("0099-02-28"));
  assert.ok(!all.includes("0099-02-29"));
  assert.equal(isos(buildMonth({ year: 100, month: 2 })).includes("0100-02-29"), false);
});
t("buildMonth: disabled via min, max, array and predicate (incl. padding)", () => {
  const w = flat(
    buildMonth({
      year: 2025, month: 6, min: "2025-06-10", max: "2025-06-20",
      disabled: ["2025-06-15"], today: "2025-06-12",
    }),
  );
  const dis = (iso) => w.find((c) => c.iso === iso).disabled;
  assert.equal(dis("2025-06-09"), true);
  assert.equal(dis("2025-06-10"), false);
  assert.equal(dis("2025-06-15"), true);
  assert.equal(dis("2025-06-20"), false);
  assert.equal(dis("2025-06-21"), true);
  assert.equal(dis("2025-07-05"), true);
  const p = flat(buildMonth({ year: 2025, month: 6, disabled: (i) => i.endsWith("-17") }));
  assert.deepEqual(p.filter((c) => c.disabled).map((c) => c.iso), ["2025-06-17"]);
  assert.ok(flat(buildMonth({ year: 2025, month: 6 })).every((c) => c.disabled === false));
});
t("buildMonth: today flag only on the matching cell, incl. padding", () => {
  const a = flat(buildMonth({ year: 2025, month: 6, today: "2025-06-12" }));
  assert.deepEqual(a.filter((c) => c.today).map((c) => c.iso), ["2025-06-12"]);
  const b = flat(buildMonth({ year: 2025, month: 6, today: "2025-07-02" }));
  assert.deepEqual(b.filter((c) => c.today).map((c) => c.iso), ["2025-07-02"]);
  assert.equal(flat(buildMonth({ year: 2025, month: 6 })).some((c) => c.today), false);
});
t("buildMonth: cell shape and inMonth", () => {
  const c = buildMonth({ year: 2025, month: 6 })[0][0];
  assert.deepEqual(Object.keys(c).sort(), ["disabled", "inMonth", "iso", "today"]);
  assert.equal(c.inMonth, true);
});
t("buildMonth: invalid month / firstDayOfWeek throw RangeError", () => {
  for (const month of [0, 13, 1.5, "3", NaN]) assert.throws(() => buildMonth({ year: 2025, month }), RangeError, String(month));
  for (const f of [7, -1, 1.5]) assert.throws(() => buildMonth({ year: 2025, month: 1, firstDayOfWeek: f }), RangeError, String(f));
});

// ---- move: arrows
t("ArrowLeft/Right cross month and year boundaries", () => {
  assert.equal(mv("2025-01-31", "ArrowRight"), "2025-02-01");
  assert.equal(mv("2025-12-31", "ArrowRight"), "2026-01-01");
  assert.equal(mv("2025-03-01", "ArrowLeft"), "2025-02-28");
  assert.equal(mv("2024-03-01", "ArrowLeft"), "2024-02-29");
  assert.equal(mv("2025-01-01", "ArrowLeft"), "2024-12-31");
});
t("ArrowUp/Down move by a week across boundaries", () => {
  assert.equal(mv("2025-01-31", "ArrowDown"), "2025-02-07");
  assert.equal(mv("2025-03-03", "ArrowUp"), "2025-02-24");
  assert.equal(mv("2024-12-30", "ArrowDown"), "2025-01-06");
  assert.equal(mv("2025-01-03", "ArrowUp"), "2024-12-27");
});
t("arrows skip disabled dates in the move direction", () => {
  assert.equal(mv("2025-01-10", "ArrowRight", { disabled: ["2025-01-11", "2025-01-12"] }), "2025-01-13");
  assert.equal(mv("2025-02-02", "ArrowLeft", { disabled: ["2025-02-01", "2025-01-31"] }), "2025-01-30");
  assert.equal(mv("2025-01-08", "ArrowDown", { disabled: ["2025-01-15"] }), "2025-01-22");
  assert.equal(mv("2025-01-22", "ArrowUp", { disabled: (i) => i === "2025-01-15" || i === "2025-01-08" }), "2025-01-01");
  assert.equal(mv("2025-01-10", "ArrowRight", { disabled: (i) => i < "2025-01-14" && i > "2025-01-10" }), "2025-01-14");
});
t("arrows never leave [min, max]", () => {
  assert.equal(mv("2025-01-31", "ArrowRight", { max: "2025-01-31" }), "2025-01-31");
  assert.equal(mv("2025-01-28", "ArrowDown", { max: "2025-01-31" }), "2025-01-28");
  assert.equal(mv("2025-01-05", "ArrowLeft", { min: "2025-01-05" }), "2025-01-05");
  assert.equal(mv("2025-01-10", "ArrowUp", { min: "2025-01-05" }), "2025-01-10");
  assert.equal(mv("2025-01-30", "ArrowRight", { max: "2025-02-01" }), "2025-01-31");
});
t("arrows stay put when the skip search runs out of range or dates", () => {
  assert.equal(mv("2025-01-29", "ArrowRight", { max: "2025-01-31", disabled: ["2025-01-30", "2025-01-31"] }), "2025-01-29");
  assert.equal(mv("2025-01-29", "ArrowLeft", { min: "2025-01-27", disabled: ["2025-01-28", "2025-01-27"] }), "2025-01-29");
  assert.equal(mv("2025-01-29", "ArrowRight", { disabled: () => true }), "2025-01-29");
  assert.equal(mv("2025-01-29", "ArrowDown", { disabled: () => true }), "2025-01-29");
});
// ---- move: Home/End
t("Home/End honor firstDayOfWeek", () => {
  assert.equal(mv("2025-01-01", "Home"), "2024-12-29");
  assert.equal(mv("2025-01-01", "End"), "2025-01-04");
  assert.equal(mv("2025-01-05", "Home", { firstDayOfWeek: 1 }), "2024-12-30");
  assert.equal(mv("2025-01-05", "End", { firstDayOfWeek: 1 }), "2025-01-05");
  assert.equal(mv("2025-01-01", "End", { firstDayOfWeek: 1 }), "2025-01-05");
  assert.equal(mv("2025-01-01", "Home", { firstDayOfWeek: 3 }), "2025-01-01");
  assert.equal(mv("2025-01-01", "End", { firstDayOfWeek: 3 }), "2025-01-07");
  assert.equal(mv("2025-01-01", "Home", { firstDayOfWeek: 6 }), "2024-12-28");
  assert.equal(mv("2025-01-01", "End", { firstDayOfWeek: 6 }), "2025-01-03");
  assert.equal(mv("2025-01-04", "Home"), "2024-12-29");
  assert.equal(mv("2025-01-04", "End"), "2025-01-04");
});
t("Home/End clamp to min/max", () => {
  assert.equal(mv("2025-01-04", "Home", { min: "2025-01-02" }), "2025-01-02");
  assert.equal(mv("2025-01-01", "End", { max: "2025-01-03" }), "2025-01-03");
});
t("Home/End skip disabled dates toward the focused date", () => {
  assert.equal(mv("2025-01-04", "Home", { disabled: ["2024-12-29", "2024-12-30"] }), "2024-12-31");
  assert.equal(mv("2025-01-04", "Home", { min: "2025-01-02", disabled: ["2025-01-02"] }), "2025-01-03");
  assert.equal(mv("2025-01-01", "End", { max: "2025-01-03", disabled: ["2025-01-03"] }), "2025-01-02");
  assert.equal(mv("2025-01-01", "End", { disabled: ["2025-01-04", "2025-01-03"] }), "2025-01-02");
  assert.equal(mv("2025-01-04", "Home", { disabled: (i) => i < "2025-01-04" }), "2025-01-04");
  assert.equal(mv("2025-01-01", "End", { disabled: (i) => i > "2025-01-01" }), "2025-01-01");
});
// ---- move: paging
t("PageDown clamps the day to the target month length", () => {
  assert.equal(mv("2025-01-31", "PageDown"), "2025-02-28");
  assert.equal(mv("2024-01-31", "PageDown"), "2024-02-29");
  assert.equal(mv("2025-03-31", "PageDown"), "2025-04-30");
  assert.equal(mv("2025-12-15", "PageDown"), "2026-01-15");
  assert.equal(mv("2025-01-29", "PageDown"), "2025-02-28");
  assert.equal(mv("2024-01-30", "PageDown"), "2024-02-29");
  assert.equal(mv("2025-10-31", "PageDown"), "2025-11-30");
});
t("PageUp clamps the day to the target month length", () => {
  assert.equal(mv("2025-03-31", "PageUp"), "2025-02-28");
  assert.equal(mv("2025-01-31", "PageUp"), "2024-12-31");
  assert.equal(mv("2025-03-30", "PageUp"), "2025-02-28");
  assert.equal(mv("2024-03-30", "PageUp"), "2024-02-29");
  assert.equal(mv("2025-01-15", "PageUp"), "2024-12-15");
  assert.equal(mv("2025-05-31", "PageUp"), "2025-04-30");
});
t("Shift+PageUp/Down move by year, Feb 29 to Feb 28", () => {
  assert.equal(mv("2024-02-29", "Shift+PageDown"), "2025-02-28");
  assert.equal(mv("2024-02-29", "Shift+PageUp"), "2023-02-28");
  assert.equal(mv("2028-02-29", "Shift+PageUp"), "2027-02-28");
  assert.equal(mv("2023-02-28", "Shift+PageDown"), "2024-02-28");
  assert.equal(mv("2025-06-15", "Shift+PageUp"), "2024-06-15");
  assert.equal(mv("2025-12-31", "Shift+PageDown"), "2026-12-31");
  assert.equal(mv("2023-02-28", "Shift+PageUp"), "2022-02-28");
});
t("paging keys clamp to min/max", () => {
  assert.equal(mv("2025-01-31", "PageDown", { max: "2025-02-20" }), "2025-02-20");
  assert.equal(mv("2025-03-05", "PageUp", { min: "2025-02-10" }), "2025-02-10");
  assert.equal(mv("2025-03-15", "PageUp", { min: "2025-02-10" }), "2025-02-15");
  assert.equal(mv("2025-06-15", "Shift+PageUp", { min: "2024-08-01" }), "2024-08-01");
  assert.equal(mv("2025-06-15", "Shift+PageDown", { max: "2026-01-09" }), "2026-01-09");
});
t("paging keys skip disabled dates in the move direction", () => {
  assert.equal(mv("2025-01-10", "PageDown", { disabled: ["2025-02-10", "2025-02-11"] }), "2025-02-12");
  assert.equal(mv("2025-03-10", "PageUp", { disabled: ["2025-02-10", "2025-02-09"] }), "2025-02-08");
  assert.equal(mv("2025-01-31", "PageDown", { disabled: ["2025-02-28"] }), "2025-03-01");
  assert.equal(mv("2024-02-29", "Shift+PageDown", { disabled: ["2025-02-28"] }), "2025-03-01");
  assert.equal(mv("2025-03-31", "PageUp", { disabled: ["2025-02-28", "2025-02-27"] }), "2025-02-26");
});
t("paging stays put when the clamped target is disabled and the scan leaves range", () => {
  assert.equal(mv("2025-01-31", "PageDown", { max: "2025-02-20", disabled: ["2025-02-20"] }), "2025-01-31");
  assert.equal(mv("2025-03-05", "PageUp", { min: "2025-02-10", disabled: ["2025-02-10"] }), "2025-03-05");
  assert.equal(mv("2025-01-15", "PageDown", { disabled: () => true }), "2025-01-15");
});
// ---- move: misc
t("unknown keys leave focus unchanged", () => {
  for (const k of ["a", "Enter", "Shift+ArrowLeft", "pagedown", "Shift+Home", ""]) assert.equal(mv("2025-01-10", k), "2025-01-10", k);
});
t("move returns a new state, keeps other fields and never mutates", () => {
  const dis = Object.freeze(["2025-01-11"]);
  const st = Object.freeze({ focused: "2025-01-10", selected: "2025-01-02", firstDayOfWeek: 1, min: "2025-01-01", max: "2025-12-31", disabled: dis, today: "2025-01-03" });
  const out = move(st, "ArrowRight");
  assert.notEqual(out, st);
  assert.equal(st.focused, "2025-01-10");
  assert.deepEqual(out, { ...st, focused: "2025-01-12" });
  assert.deepEqual(move(st, "x"), st);
});

// ---- gridProps
t("gridProps: roving tabindex", () => {
  const st = S("2025-01-15");
  const w = flat(buildMonth({ year: 2025, month: 1 }));
  const zeros = w.filter((c) => gridProps(st, c.iso).tabindex === 0).map((c) => c.iso);
  assert.deepEqual(zeros, ["2025-01-15"]);
  assert.ok(w.filter((c) => c.iso !== "2025-01-15").every((c) => gridProps(st, c.iso).tabindex === -1));
  assert.equal(gridProps(S("2025-02-01"), "2025-02-01").tabindex, 0);
});
t("gridProps: aria-selected is a strict boolean", () => {
  const st = S("2025-01-15", { selected: "2025-01-20" });
  assert.strictEqual(gridProps(st, "2025-01-20")["aria-selected"], true);
  assert.strictEqual(gridProps(st, "2025-01-15")["aria-selected"], false);
  assert.strictEqual(gridProps(S("2025-01-15"), "2025-01-15")["aria-selected"], false);
  assert.strictEqual(gridProps({ focused: "2025-01-15" }, "2025-01-15")["aria-selected"], false);
});
t("gridProps: aria-disabled mirrors buildMonth rules", () => {
  const st = S("2025-01-15", { min: "2025-01-10", max: "2025-01-20", disabled: ["2025-01-16"] });
  const d = (i) => gridProps(st, i)["aria-disabled"];
  assert.strictEqual(d("2025-01-09"), true);
  assert.strictEqual(d("2025-01-10"), false);
  assert.strictEqual(d("2025-01-16"), true);
  assert.strictEqual(d("2025-01-21"), true);
  assert.strictEqual(d("2025-01-15"), false);
  assert.strictEqual(gridProps(S("2025-01-15", { disabled: (i) => i === "2025-01-03" }), "2025-01-03")["aria-disabled"], true);
});
t("gridProps: aria-current only on today, key absent elsewhere", () => {
  const st = S("2025-01-15", { today: "2025-01-12" });
  assert.equal(gridProps(st, "2025-01-12")["aria-current"], "date");
  assert.equal("aria-current" in gridProps(st, "2025-01-13"), false);
  assert.equal("aria-current" in gridProps(S("2025-01-15"), "2025-01-12"), false);
});
t("gridProps: a disabled focused cell keeps tabindex 0", () => {
  const p = gridProps(S("2025-01-15", { disabled: ["2025-01-15"] }), "2025-01-15");
  assert.equal(p.tabindex, 0);
  assert.equal(p["aria-disabled"], true);
});
