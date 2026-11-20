"use strict";

const { assertPositiveSize } = require("./validate");

// Holds the measured size of rows and falls back to the estimate.
// `estimate` is a positive number or a function (index) => positive number.

function createSizeCache(estimate) {
  const measured = new Map();

  function estimateOf(index) {
    const value = typeof estimate === "function" ? estimate(index) : estimate;
    return assertPositiveSize(value, "estimateSize result");
  }

  return {
    estimateOf,
    sizeOf(index) {
      const m = measured.get(index);
      return m === undefined ? estimateOf(index) : m;
    },
    isMeasured(index) {
      return measured.has(index);
    },
    set(index, size) {
      measured.set(index, size);
    },
    // Forget every measurement at or beyond `count`.
    truncate(count) {
      for (const index of [...measured.keys()]) {
        if (index >= count) measured.delete(index);
      }
    },
  };
}

module.exports = { createSizeCache };
