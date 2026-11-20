"use strict";

const {
  assertCount,
  assertIndex,
  assertPositiveSize,
  assertOverscan,
  clamp,
} = require("./lib/validate");
const { createSizeCache } = require("./lib/size-cache");
const { createOffsets } = require("./lib/offsets");
const { nextFocus: nextFocusIndex } = require("./lib/keyboard");

const ALIGNS = new Set(["start", "center", "end", "auto"]);

function createVirtualizer({ count, estimateSize, overscan = 0, viewportSize } = {}) {
  assertCount(count);
  assertOverscan(overscan);
  assertPositiveSize(viewportSize, "viewportSize");
  if (typeof estimateSize !== "function") assertPositiveSize(estimateSize, "estimateSize");

  let n = count;
  let scrollTop = 0;
  const cache = createSizeCache(estimateSize);
  const offsets = createOffsets(n, (i) => cache.sizeOf(i));

  const maxScroll = () => Math.max(0, offsets.total() - viewportSize);

  function getOffset(index) {
    if (index !== n) assertIndex(index, n);
    return offsets.offsetOf(index);
  }

  function getSize(index) {
    assertIndex(index, n);
    return cache.sizeOf(index);
  }

  function getRange(top) {
    scrollTop = clamp(top, 0, maxScroll());
    const totalSize = offsets.total();
    if (n === 0) return { start: 0, end: -1, items: [], totalSize };
    const first = offsets.firstEndingAfter(scrollTop);
    const last = offsets.lastStartingBefore(scrollTop + viewportSize);
    const start = Math.max(0, first - overscan);
    const end = Math.min(n - 1, last + overscan);
    const items = [];
    let offset = offsets.offsetOf(start);
    for (let index = start; index <= end; index++) {
      const size = cache.sizeOf(index);
      items.push({ index, offset, size });
      offset += size;
    }
    return { start, end, items, totalSize };
  }

  function measure(index, size) {
    assertIndex(index, n);
    assertPositiveSize(size);
    const old = cache.sizeOf(index);
    cache.set(index, size);
    if (size === old) return 0;
    const delta = size - old;
    offsets.update(index, delta);
    // the row was entirely above the viewport (judged on the pre-measure layout)
    const endBefore = offsets.offsetOf(index) + old;
    if (endBefore > scrollTop) return 0;
    scrollTop += delta;
    return delta;
  }

  function scrollToIndex(index, align = "start") {
    assertIndex(index, n);
    if (!ALIGNS.has(align)) throw new RangeError(`unknown align ${String(align)}`);
    const offset = offsets.offsetOf(index);
    const size = cache.sizeOf(index);
    let target;
    if (align === "start") target = offset;
    else if (align === "center") target = offset + size / 2 - viewportSize / 2;
    else if (align === "end") target = offset + size - viewportSize;
    else if (offset >= scrollTop && offset + size <= scrollTop + viewportSize) target = scrollTop;
    else if (offset < scrollTop || size > viewportSize) target = offset;
    else target = offset + size - viewportSize;
    scrollTop = clamp(target, 0, maxScroll());
    return scrollTop;
  }

  function setCount(next) {
    assertCount(next);
    n = next;
    cache.truncate(n);
    offsets.setCount(n);
    scrollTop = Math.min(scrollTop, maxScroll());
  }

  function nextFocus(index, key) {
    if (n === 0) return -1;
    assertIndex(index, n);
    const firstFull = offsets.firstStartingAtOrAfter(scrollTop);
    const pageRows = Math.max(1, offsets.countEndingAtOrBefore(scrollTop + viewportSize) - firstFull);
    return nextFocusIndex(index, key, n, pageRows);
  }

  return {
    getCount: () => n,
    getScrollTop: () => scrollTop,
    getOffset,
    getSize,
    getTotalSize: () => offsets.total(),
    measure,
    getRange,
    scrollToIndex,
    setCount,
    nextFocus,
  };
}

module.exports = { createVirtualizer };
