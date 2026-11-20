"use strict";

// Cumulative offsets of variable-size rows.
//
// This is the naive version: every query walks the rows from the start, so
// it is O(n) per call. It is far too slow for 100k rows and has to be
// replaced with something that answers offset and "which row is at this
// position" queries in better than linear time.

function createOffsets(count, sizeOf) {
  let n = count;

  return {
    // sum of the sizes of rows [0, index)
    offsetOf(index) {
      let sum = 0;
      for (let i = 0; i < index; i++) sum += sizeOf(i);
      return sum;
    },
    total() {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += sizeOf(i);
      return sum;
    },
    // first row whose end offset is greater than `position`, or n if none
    firstEndingAfter(position) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += sizeOf(i);
        if (sum > position) return i;
      }
      return n;
    },
    // last row whose start offset is smaller than `position`
    lastStartingBefore(position) {
      let sum = 0;
      let last = -1;
      for (let i = 0; i < n; i++) {
        if (sum < position) last = i;
        else break;
        sum += sizeOf(i);
      }
      return last;
    },
    setCount(next) {
      n = next;
    },
    // a row changed size
    update() {},
  };
}

module.exports = { createOffsets };
