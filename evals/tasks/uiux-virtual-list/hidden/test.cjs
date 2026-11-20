"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");

const ws = path.resolve(process.env.ACH_WORKSPACE || process.cwd());
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

let createVirtualizer, renderWindow, createScrollController;
try {
  ({ createVirtualizer } = require(path.join(ws, "virtual.js")));
  ({ renderWindow } = require(path.join(ws, "list.js")));
  ({ createScrollController } = require(path.join(ws, "lib", "scroll-controller.js")));
} catch (e) {
  console.log("FAIL load: " + e.message);
  process.exit(1);
}

const mk = (o = {}) => createVirtualizer({ count: 100, estimateSize: 10, overscan: 0, viewportSize: 50, ...o });
const idx = (r) => r.items.map((i) => i.index);

t("validation: bad constructor arguments throw RangeError", () => {
  const bad = [
    { count: -1 }, { count: 1.5 }, { count: "3" }, { viewportSize: 0 }, { viewportSize: -5 },
    { viewportSize: NaN }, { overscan: -1 }, { overscan: 1.5 }, { estimateSize: 0 },
    { estimateSize: -3 }, { estimateSize: Infinity },
  ];
  for (const b of bad) assert.throws(() => mk(b), RangeError, JSON.stringify(b));
});

t("validation: estimateSize function returning a bad value throws RangeError when read", () => {
  // the engine may read estimates eagerly (constructor) or lazily; either throws RangeError
  const use = (est, fn) => fn(createVirtualizer({ count: 5, estimateSize: est, viewportSize: 20 }));
  assert.throws(() => use((i) => (i === 3 ? 0 : 10), (v) => { v.getSize(2); v.getSize(3); v.getTotalSize(); }), RangeError);
  assert.throws(() => use(() => NaN, (v) => v.getTotalSize()), RangeError);
  assert.throws(() => use(() => -2, (v) => v.getRange(0)), RangeError);
});

t("offsets: exact math with a per-index estimate function", () => {
  const v = mk({ count: 6, estimateSize: (i) => 10 + i * 5 }); // 10 15 20 25 30 35
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => v.getOffset(i)), [0, 10, 25, 45, 70, 100, 135]);
  assert.equal(v.getTotalSize(), 135);
  assert.equal(v.getSize(4), 30);
  assert.equal(v.getCount(), 6);
});

t("offsets: measured sizes override estimates and shift later offsets", () => {
  const v = mk({ count: 6, estimateSize: 10 });
  v.measure(1, 25);
  v.measure(4, 7.5);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => v.getOffset(i)), [0, 10, 35, 45, 55, 62.5, 72.5]);
  assert.equal(v.getSize(1), 25);
  assert.equal(v.getTotalSize(), 72.5);
});

t("offsets/measure: out-of-range indexes and bad sizes throw RangeError", () => {
  const v = mk({ count: 5 });
  for (const i of [-1, 5, 1.5, NaN, "1"]) assert.throws(() => v.getSize(i), RangeError, String(i));
  for (const i of [-1, 6, 2.5]) assert.throws(() => v.getOffset(i), RangeError, String(i));
  assert.equal(v.getOffset(5), 50);
  for (const i of [-1, 5, 0.5]) assert.throws(() => v.measure(i, 10), RangeError);
  for (const s of [0, -1, NaN, Infinity, "10"]) assert.throws(() => v.measure(0, s), RangeError, String(s));
  assert.equal(v.getSize(0), 10);
});

t("getRange: basic window without overscan", () => {
  const v = mk();
  const r = v.getRange(0);
  assert.deepEqual([r.start, r.end, r.totalSize], [0, 4, 1000]);
  assert.deepEqual(r.items, [0, 1, 2, 3, 4].map((i) => ({ index: i, offset: i * 10, size: 10 })));
  const m = v.getRange(25);
  assert.deepEqual([m.start, m.end], [2, 7]);
  assert.deepEqual(m.items[0], { index: 2, offset: 20, size: 10 });
});

t("getRange: boundaries are start-inclusive of the ending row and exclusive at the bottom", () => {
  const v = mk();
  const r = v.getRange(30); // row 2 ends exactly at 30 -> not visible; row 8 starts at 80 == bottom -> not visible
  assert.deepEqual([r.start, r.end], [3, 7]);
  const s = v.getRange(31);
  assert.deepEqual([s.start, s.end], [3, 8]);
});

t("getRange: overscan extends both sides and clamps at 0 and count-1", () => {
  const v = mk({ overscan: 3 });
  const mid = v.getRange(300);
  assert.deepEqual([mid.start, mid.end, mid.items.length], [27, 37, 11]);
  const top = v.getRange(10);
  assert.deepEqual([top.start, top.end], [0, 8]);
  const bottom = v.getRange(1e9);
  assert.deepEqual([bottom.start, bottom.end], [92, 99]);
  assert.equal(bottom.items.length, 8);
  assert.deepEqual(bottom.items[bottom.items.length - 1], { index: 99, offset: 990, size: 10 });
});

t("getRange: scrollTop is clamped and remembered", () => {
  const v = mk();
  assert.equal(v.getScrollTop(), 0);
  v.getRange(-40);
  assert.equal(v.getScrollTop(), 0);
  const r = v.getRange(5000);
  assert.equal(v.getScrollTop(), 950);
  assert.deepEqual([r.start, r.end], [95, 99]);
  v.getRange(123);
  assert.equal(v.getScrollTop(), 123);
});

t("getRange: empty list and list shorter than the viewport", () => {
  const e = mk({ count: 0 });
  assert.deepEqual(e.getRange(100), { start: 0, end: -1, items: [], totalSize: 0 });
  assert.equal(e.getTotalSize(), 0);
  const s = mk({ count: 3, overscan: 2 });
  const r = s.getRange(80);
  assert.deepEqual([r.start, r.end, r.totalSize, s.getScrollTop()], [0, 2, 30, 0]);
});

t("getRange: uses measured sizes for the visible window", () => {
  const v = mk({ count: 20, estimateSize: 10, viewportSize: 40 });
  v.measure(0, 30);
  v.measure(1, 5);
  v.measure(2, 60);
  const r = v.getRange(0);
  assert.deepEqual(r.items, [
    { index: 0, offset: 0, size: 30 },
    { index: 1, offset: 30, size: 5 },
    { index: 2, offset: 35, size: 60 },
  ]);
  assert.equal(r.totalSize, 30 + 5 + 60 + 170);
  const tall = v.getRange(40); // 40..80 lies inside the 60px row only
  assert.deepEqual(idx(tall), [2]);
});

t("anchoring: unchanged size returns 0 and changes nothing", () => {
  const v = mk();
  v.getRange(100);
  assert.equal(v.measure(2, 10), 0);
  v.measure(3, 14);
  assert.equal(v.measure(3, 14), 0);
  assert.equal(v.getScrollTop(), 104);
});

t("anchoring: row above the viewport returns newSize - oldSize (grow and shrink)", () => {
  const v = mk();
  v.getRange(100);
  assert.equal(v.measure(3, 25), 15);
  assert.equal(v.getScrollTop(), 115);
  assert.equal(v.measure(0, 4), -6);
  assert.equal(v.getScrollTop(), 109);
  assert.equal(v.measure(3, 20), -5);
  assert.equal(v.getScrollTop(), 104);
});

t("anchoring: rows intersecting the viewport or below it return 0", () => {
  const v = mk();
  v.getRange(100); // rows 10..14 visible
  assert.equal(v.measure(10, 30), 0);
  assert.equal(v.measure(12, 3), 0);
  assert.equal(v.measure(14, 40), 0);
  assert.equal(v.measure(15, 40), 0);
  assert.equal(v.measure(80, 99), 0);
  assert.equal(v.getScrollTop(), 100);
});

t("anchoring: the first visible row only partly in view is not 'above'", () => {
  const v = mk();
  v.getRange(105); // row 10 spans 100..110, still visible
  assert.equal(v.measure(10, 50), 0);
  assert.equal(v.measure(9, 12), 2);
});

t("anchoring: a row ending exactly at scrollTop is above", () => {
  const v = mk();
  v.getRange(100);
  assert.equal(v.measure(9, 17), 7);
});

t("anchoring: consecutive measures are judged against the advanced scroll position", () => {
  const v = mk();
  v.getRange(100);
  assert.equal(v.measure(3, 25), 15); // scrollTop 115, row 10 now at 115..125
  assert.equal(v.measure(10, 50), 0); // visible: first visible row is 10 again
  assert.equal(v.measure(9, 30), 20); // old end 115 == scrollTop -> above
  assert.equal(v.getScrollTop(), 135);
  assert.equal(v.measure(10, 20), 0);
});

t("anchoring: before any getRange the remembered position is 0, so nothing is above", () => {
  const v = mk();
  assert.equal(v.measure(0, 40), 0);
  assert.equal(v.measure(5, 40), 0);
  assert.equal(v.getScrollTop(), 0);
});

t("anchoring: scroll advance is not clamped to the new maximum", () => {
  const v = mk({ count: 10, viewportSize: 50 });
  v.getRange(50); // max scroll 50 -> rows 5..9
  assert.equal(v.measure(0, 5), -5);
  assert.equal(v.getScrollTop(), 45);
  assert.equal(v.getRange(45).start, 5);
});

t("scrollToIndex: start / center / end with exact math and clamping", () => {
  const v = mk({ count: 100, estimateSize: (i) => 10 + (i % 2) * 10, viewportSize: 60 }); // 10 20 10 20
  // offset(5)=70 size 20
  assert.equal(v.scrollToIndex(5, "start"), 70);
  assert.equal(v.scrollToIndex(5), 70);
  assert.equal(v.scrollToIndex(5, "center"), 70 + 10 - 30);
  assert.equal(v.scrollToIndex(5, "end"), 70 + 20 - 60);
  assert.equal(v.scrollToIndex(0, "center"), 0); // negative -> 0
  assert.equal(v.scrollToIndex(1, "end"), 0);
  const max = v.getTotalSize() - 60;
  assert.equal(v.scrollToIndex(99, "start"), max);
  assert.equal(v.scrollToIndex(99, "center"), max);
  assert.equal(v.scrollToIndex(98, "start"), max);
});

t("scrollToIndex: center with odd sizes yields fractional positions", () => {
  const v = mk({ count: 50, estimateSize: 11, viewportSize: 30 });
  assert.equal(v.scrollToIndex(10, "center"), 110 + 5.5 - 15);
});

t("scrollToIndex: result is remembered and short lists clamp to 0", () => {
  const v = mk();
  assert.equal(v.scrollToIndex(30, "start"), 300);
  assert.equal(v.getScrollTop(), 300);
  const s = mk({ count: 3 });
  assert.equal(s.scrollToIndex(2, "start"), 0);
  assert.equal(s.scrollToIndex(2, "end"), 0);
});

t("scrollToIndex: auto is a no-op when fully visible, minimal otherwise", () => {
  const v = mk();
  v.getRange(100); // 100..150
  assert.equal(v.scrollToIndex(10, "auto"), 100); // exactly at the top edge
  assert.equal(v.scrollToIndex(14, "auto"), 100); // exactly at the bottom edge
  assert.equal(v.scrollToIndex(12, "auto"), 100);
  assert.equal(v.scrollToIndex(9, "auto"), 90); // above -> align start
  assert.equal(v.scrollToIndex(15, "auto"), 110); // 150+10-50 = below -> align end
  assert.equal(v.scrollToIndex(40, "auto"), 360);
  assert.equal(v.getScrollTop(), 360);
  assert.equal(v.scrollToIndex(36, "auto"), 360); // 360..410 contains 360..370
});

t("scrollToIndex: auto with a partly visible row and a row taller than the viewport", () => {
  const v = mk({ count: 20, estimateSize: 10, viewportSize: 50 });
  v.measure(5, 80); // offset 50, 50..130
  v.getRange(60);
  assert.equal(v.scrollToIndex(5, "auto"), 50); // taller than viewport -> start
  v.getRange(100);
  assert.equal(v.scrollToIndex(5, "auto"), 50); // overlapping above: offset < cur -> start
  v.getRange(0);
  assert.equal(v.scrollToIndex(5, "auto"), 50); // sticks out below, tall -> start, not end (80)
  v.getRange(8); // row 0 partly above the viewport top
  assert.equal(v.scrollToIndex(0, "auto"), 0);
  v.getRange(0);
  assert.equal(v.scrollToIndex(4, "auto"), 0); // 40..50 fully visible
  assert.equal(v.scrollToIndex(5, "end"), 50 + 80 - 50);
});

t("scrollToIndex: bad index or align throws RangeError", () => {
  const v = mk({ count: 10 });
  for (const i of [-1, 10, 2.5, NaN]) assert.throws(() => v.scrollToIndex(i), RangeError, String(i));
  for (const a of ["middle", "END", "", null]) assert.throws(() => v.scrollToIndex(2, a), RangeError, String(a));
  assert.throws(() => mk({ count: 0 }).scrollToIndex(0), RangeError);
});

t("setCount: shrink and grow keep measurements of surviving rows", () => {
  const v = mk({ count: 10 });
  v.measure(2, 30);
  v.measure(8, 40);
  v.setCount(5);
  assert.equal(v.getCount(), 5);
  assert.equal(v.getTotalSize(), 70);
  assert.equal(v.getSize(2), 30);
  assert.throws(() => v.getSize(8), RangeError);
  v.setCount(12);
  assert.equal(v.getSize(2), 30);
  assert.equal(v.getSize(8), 10); // removed then re-added -> estimate again
  assert.equal(v.getTotalSize(), 140);
  assert.equal(v.getOffset(3), 50);
});

t("setCount: grown rows use estimateSize(index); offsets stay exact", () => {
  const v = mk({ count: 2, estimateSize: (i) => i + 1, viewportSize: 5 });
  v.setCount(5);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => v.getOffset(i)), [0, 1, 3, 6, 10, 15]);
  v.measure(4, 100);
  assert.equal(v.getTotalSize(), 110);
  v.setCount(0);
  assert.equal(v.getTotalSize(), 0);
  assert.deepEqual(v.getRange(0), { start: 0, end: -1, items: [], totalSize: 0 });
  v.setCount(3);
  assert.equal(v.getTotalSize(), 6);
});

t("setCount: remembered scroll position is clamped; bad count throws", () => {
  const v = mk();
  v.getRange(900);
  v.setCount(40); // total 400, max 350
  assert.equal(v.getScrollTop(), 350);
  v.setCount(2);
  assert.equal(v.getScrollTop(), 0);
  v.setCount(100);
  assert.equal(v.getScrollTop(), 0);
  for (const n of [-1, 1.5, NaN, "4"]) assert.throws(() => v.setCount(n), RangeError, String(n));
  assert.equal(v.getCount(), 100);
});

t("nextFocus: arrows, Home/End and unknown keys with clamping", () => {
  const v = mk(); // viewport 50 / 10 -> 5 rows
  assert.equal(v.nextFocus(10, "ArrowDown"), 11);
  assert.equal(v.nextFocus(10, "ArrowUp"), 9);
  assert.equal(v.nextFocus(0, "ArrowUp"), 0);
  assert.equal(v.nextFocus(99, "ArrowDown"), 99);
  assert.equal(v.nextFocus(10, "Home"), 0);
  assert.equal(v.nextFocus(10, "End"), 99);
  assert.equal(v.nextFocus(10, "Enter"), 10);
  assert.equal(v.nextFocus(10, undefined), 10);
});

t("nextFocus: page keys move by the rows fully inside the viewport", () => {
  const v = mk();
  v.getRange(0);
  assert.equal(v.nextFocus(10, "PageDown"), 15);
  assert.equal(v.nextFocus(10, "PageUp"), 5);
  assert.equal(v.nextFocus(97, "PageDown"), 99);
  assert.equal(v.nextFocus(3, "PageUp"), 0);
  v.getRange(5); // rows 0 (partial), 1..4 full, 5 partial -> 4 rows fully visible
  assert.equal(v.nextFocus(10, "PageDown"), 14);
  v.getRange(7);
  assert.equal(v.nextFocus(10, "PageUp"), 6);
});

t("nextFocus: page size follows variable row heights and is at least 1", () => {
  const v = mk({ count: 50, estimateSize: 10, viewportSize: 100 });
  [30, 10, 20, 40, 10, 10].forEach((s, i) => v.measure(i, s));
  v.getRange(0); // 30 10 20 40 -> 100 exactly, then row 4 outside: 4 rows
  assert.equal(v.nextFocus(0, "PageDown"), 4);
  v.getRange(30); // rows 1..6 (10 20 40 10 10 10) end at 130 -> 6 rows
  assert.equal(v.nextFocus(20, "PageUp"), 14);
  const tall = mk({ count: 10, estimateSize: 80, viewportSize: 50 });
  tall.getRange(0);
  assert.equal(tall.nextFocus(3, "PageDown"), 4);
  assert.equal(tall.nextFocus(3, "PageUp"), 2);
});

t("nextFocus: empty list returns -1, bad index throws", () => {
  assert.equal(mk({ count: 0 }).nextFocus(0, "ArrowDown"), -1);
  const v = mk({ count: 5 });
  for (const i of [-1, 5, 1.5, NaN]) assert.throws(() => v.nextFocus(i, "Home"), RangeError, String(i));
});

t("list.js renderWindow output is unchanged", () => {
  const v = createVirtualizer({ count: 10, estimateSize: 10, overscan: 1, viewportSize: 25 });
  assert.equal(
    renderWindow(v, 20, (i) => "r" + i),
    ["1@10+10: r1", "2@20+10: r2", "3@30+10: r3", "4@40+10: r4", "5@50+10: r5", "total=100"].join("\n"),
  );
  assert.equal(renderWindow(v, 0).split("\n")[0], "0@0+10: row 0");
});

t("scroll controller: anchoring keeps the visible content still", () => {
  const v = mk();
  const c = createScrollController(v);
  c.scrollTo(100);
  assert.equal(c.onMeasure(4, 30), 20);
  assert.equal(c.scrollTop, 120);
  assert.equal(c.onMeasure(11, 30), 0);
  assert.equal(c.scrollTop, 120);
  const r = c.range();
  assert.equal(r.items[0].index, 10);
  assert.equal(r.items[0].offset, 120);
  c.scrollTo(99999);
  assert.equal(c.scrollTop, v.getTotalSize() - 50);
  const rr = c.reveal(0, "start");
  assert.equal(c.scrollTop, 0);
  assert.equal(rr.start, 0);
});

// Independent naive model of the spec for the randomized comparison.
function model(count, est, vp, overscan) {
  const m = { n: count, meas: new Map(), cur: 0 };
  const size = (i) => (m.meas.has(i) ? m.meas.get(i) : est(i));
  const off = (i) => { let s = 0; for (let k = 0; k < i; k++) s += size(k); return s; };
  const total = () => off(m.n);
  const max = () => Math.max(0, total() - vp);
  m.range = (top) => {
    m.cur = Math.min(max(), Math.max(0, top));
    const vis = [];
    for (let i = 0; i < m.n; i++) if (off(i) < m.cur + vp && off(i) + size(i) > m.cur) vis.push(i);
    const start = Math.max(0, vis[0] - overscan);
    const end = Math.min(m.n - 1, vis[vis.length - 1] + overscan);
    const items = [];
    for (let i = start; i <= end; i++) items.push({ index: i, offset: off(i), size: size(i) });
    return { start, end, items, totalSize: total() };
  };
  m.measure = (i, s) => {
    const old = size(i);
    const above = off(i) + old <= m.cur;
    m.meas.set(i, s);
    if (s === old || !above) return 0;
    m.cur += s - old;
    return s - old;
  };
  m.scrollTo = (i, a) => {
    const o = off(i), s = size(i);
    let t;
    if (a === "start") t = o;
    else if (a === "center") t = o + s / 2 - vp / 2;
    else if (a === "end") t = o + s - vp;
    else if (o >= m.cur && o + s <= m.cur + vp) t = m.cur;
    else if (o < m.cur) t = o;
    else t = s > vp ? o : o + s - vp;
    m.cur = Math.min(max(), Math.max(0, t));
    return m.cur;
  };
  m.setCount = (k) => {
    for (const i of [...m.meas.keys()]) if (i >= k) m.meas.delete(i);
    m.n = k;
    m.cur = Math.min(m.cur, max());
  };
  m.focus = (i, key) => {
    if (m.n === 0) return -1;
    let page = 0;
    for (let k = 0; k < m.n; k++) if (off(k) >= m.cur && off(k) + size(k) <= m.cur + vp) page++;
    page = Math.max(1, page);
    const c = (x) => Math.min(m.n - 1, Math.max(0, x));
    return { ArrowUp: c(i - 1), ArrowDown: c(i + 1), PageUp: c(i - page), PageDown: c(i + page), Home: 0, End: m.n - 1 }[key] ?? i;
  };
  m.total = total;
  return m;
}

t("randomized: 3000 mixed operations match an independent naive model", () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const est = (i) => 8 + ((i * 7) % 13);
  for (const overscan of [0, 2]) {
    const v = createVirtualizer({ count: 60, estimateSize: est, overscan, viewportSize: 70 });
    const m = model(60, est, 70, overscan);
    for (let step = 0; step < 1500; step++) {
      const op = rnd(10);
      const ctx = `overscan ${overscan} step ${step} op ${op}`;
      if (op < 3 && m.n > 0) {
        const i = rnd(m.n), s = 1 + rnd(40) / (rnd(2) + 1);
        assert.equal(v.measure(i, s), m.measure(i, s), ctx + " measure");
      } else if (op < 6 && m.n > 0) {
        const top = rnd(Math.max(1, m.total() + 100)) - 20;
        assert.deepEqual(v.getRange(top), m.range(top), ctx + " range");
      } else if (op < 8 && m.n > 0) {
        const i = rnd(m.n), a = ["start", "center", "end", "auto"][rnd(4)];
        assert.equal(v.scrollToIndex(i, a), m.scrollTo(i, a), ctx + " scrollTo " + a);
      } else if (op < 9) {
        const k = rnd(80);
        v.setCount(k);
        m.setCount(k);
      } else if (m.n > 0) {
        const i = rnd(m.n), key = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "x"][rnd(7)];
        assert.equal(v.nextFocus(i, key), m.focus(i, key), ctx + " focus " + key);
      }
      assert.equal(v.getScrollTop(), m.cur, ctx + " scrollTop");
      assert.equal(v.getTotalSize(), m.total(), ctx + " total");
    }
  }
});

t("performance: 100k rows, 10k getRange + 2k measure calls within the time budget", () => {
  const N = 100000;
  const v = createVirtualizer({ count: N, estimateSize: (i) => 20 + (i % 7) * 3, overscan: 5, viewportSize: 800 });
  const total = v.getTotalSize();
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const t0 = process.hrtime.bigint();
  let sink = 0;
  for (let k = 0; k < 10000; k++) {
    const r = v.getRange(rnd(total));
    sink += r.items.length;
    if (k % 5 === 0) v.measure(rnd(N), 10 + rnd(60));
    if (k % 50 === 0) sink += v.scrollToIndex(rnd(N), "center") > 0 ? 1 : 0;
    if (k % 20 === 0 && Number(process.hrtime.bigint() - t0) / 1e6 > 1500) assert.fail("over the 1500 ms budget after " + k + " calls");
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(sink > 0);
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms (budget 1500 ms)`);
  // exactness at scale
  const w = createVirtualizer({ count: N, estimateSize: 20, overscan: 0, viewportSize: 100 });
  w.measure(12345, 520);
  assert.equal(w.getOffset(N), 20 * (N - 1) + 520);
  assert.equal(w.getOffset(12346), 12345 * 20 + 520);
  const r = w.getRange(12345 * 20 + 40);
  assert.deepEqual(idx(r), [12345, 12346, 12347].slice(0, idx(r).length));
  assert.equal(r.items[0].offset, 12345 * 20);
  assert.equal(w.getRange(20 * (N - 1) + 520 - 100).end, N - 1);
});

console.log(failed ? `${failed} case(s) failed` : "all cases passed");
