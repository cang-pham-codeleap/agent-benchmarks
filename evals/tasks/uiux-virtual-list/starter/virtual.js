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
    for (let index = start; index <= end; index++) {
      items.push({ index, offset: offsets.offsetOf(index), size: cache.sizeOf(index) });
    }
    return { start, end, items, totalSize };
  }

  // TODO: scroll anchoring. The caller currently has to live with jumps.
  function measure(index, size) {
    assertIndex(index, n);
    assertPositiveSize(size);
    cache.set(index, size);
    offsets.update(index);
    return 0;
  }

  // Only "start" is supported so far.
  function scrollToIndex(index) {
    assertIndex(index, n);
    scrollTop = clamp(offsets.offsetOf(index), 0, maxScroll());
    return scrollTop;
  }

  function setCount(next) {
    assertCount(next);
    n = next;
    cache.truncate(n);
    offsets.setCount(n);
  }

  function nextFocus(index, key) {
    return nextFocusIndex(index, key, n, 1);
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
