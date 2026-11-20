"use strict";

const DAY = 86400000;
const MAX_SCAN = 1000;
const pad = (n, w) => String(n).padStart(w, "0");

function parse(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d); // Date.UTC would map years 0-99 to 1900+
  return dt;
}
const fmt = (dt) =>
  pad(dt.getUTCFullYear(), 4) + "-" + pad(dt.getUTCMonth() + 1, 2) + "-" + pad(dt.getUTCDate(), 2);
const addDays = (iso, n) => fmt(new Date(parse(iso).getTime() + n * DAY));
const daysInMonth = (y, m) => {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m, 0);
  return dt.getUTCDate();
};

function isDisabled(o, iso) {
  if (o.min && iso < o.min) return true;
  if (o.max && iso > o.max) return true;
  const d = o.disabled;
  if (Array.isArray(d)) return d.includes(iso);
  return typeof d === "function" ? !!d(iso) : false;
}
const outside = (o, iso) => (o.min && iso < o.min) || (o.max && iso > o.max);

function buildMonth(o) {
  const { year, month, firstDayOfWeek = 0, today } = o;
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError("invalid month: " + month);
  if (!Number.isInteger(firstDayOfWeek) || firstDayOfWeek < 0 || firstDayOfWeek > 6)
    throw new RangeError("invalid firstDayOfWeek: " + firstDayOfWeek);
  const first = pad(year, 4) + "-" + pad(month, 2) + "-01";
  const lead = (parse(first).getUTCDay() - firstDayOfWeek + 7) % 7;
  const weeks = Math.ceil((lead + daysInMonth(year, month)) / 7);
  const start = addDays(first, -lead);
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const row = [];
    for (let c = 0; c < 7; c++) {
      const iso = addDays(start, w * 7 + c);
      row.push({
        iso,
        inMonth: iso.slice(0, 7) === first.slice(0, 7),
        disabled: isDisabled(o, iso),
        today: iso === today,
      });
    }
    out.push(row);
  }
  return out;
}

function shiftMonths(iso, n) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return pad(ny, 4) + "-" + pad(nm, 2) + "-" + pad(Math.min(d, daysInMonth(ny, nm)), 2);
}

function clamp(o, iso) {
  if (o.min && iso < o.min) return o.min;
  if (o.max && iso > o.max) return o.max;
  return iso;
}

function target(s, key) {
  const f = s.focused;
  const fdow = s.firstDayOfWeek || 0;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[key];
  if (step) {
    let c = addDays(f, step);
    for (let i = 0; i < MAX_SCAN && !outside(s, c); i++, c = addDays(c, step)) {
      if (!isDisabled(s, c)) return c;
    }
    return f;
  }
  if (key === "Home" || key === "End") {
    const off = (parse(f).getUTCDay() - fdow + 7) % 7;
    const dir = key === "Home" ? 1 : -1;
    let c = clamp(s, addDays(f, key === "Home" ? -off : 6 - off));
    while (dir > 0 ? c < f : c > f) {
      if (!isDisabled(s, c)) return c;
      c = addDays(c, dir);
    }
    return f;
  }
  const n = { PageUp: [-1, -1], PageDown: [1, 1], "Shift+PageUp": [-12, -1], "Shift+PageDown": [12, 1] }[key];
  if (!n) return f;
  let c = clamp(s, shiftMonths(f, n[0]));
  for (let i = 0; i < MAX_SCAN && !outside(s, c); i++, c = addDays(c, n[1])) {
    if (!isDisabled(s, c)) return c;
  }
  return f;
}

function move(state, key) {
  return { ...state, focused: target(state, key) };
}

function gridProps(state, iso) {
  const p = {
    "aria-selected": iso === state.selected,
    "aria-disabled": isDisabled(state, iso),
    tabindex: iso === state.focused ? 0 : -1,
  };
  if (iso === state.today) p["aria-current"] = "date";
  return p;
}

module.exports = { buildMonth, move, gridProps };
