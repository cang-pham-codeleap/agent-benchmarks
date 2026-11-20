"use strict";

// Cumulative offsets over a Fenwick tree: point update, prefix sum and
// "which row holds this position" are all O(log n); (re)building is O(n).

function createOffsets(count, sizeOf) {
  let n = 0;
  let tree = [0];
  let top = 0; // highest power of two <= n

  function rebuild(next) {
    n = next;
    const grown = new Float64Array(n + 1);
    // prefix sums of rows that survive a resize are unchanged, so only the
    // tree is rebuilt from the row sizes
    for (let i = 1; i <= n; i++) {
      grown[i] += sizeOf(i - 1);
      const parent = i + (i & -i);
      if (parent <= n) grown[parent] += grown[i];
    }
    tree = grown;
    top = n === 0 ? 0 : 2 ** Math.floor(Math.log2(n));
  }

  // largest pos in [0, n] whose prefix sum is < x (strict) or <= x
  function descend(x, strict) {
    let pos = 0;
    let rem = x;
    for (let step = top; step > 0; step >>= 1) {
      const next = pos + step;
      if (next <= n && (strict ? tree[next] < rem : tree[next] <= rem)) {
        pos = next;
        rem -= tree[next];
      }
    }
    return pos;
  }

  rebuild(count);

  return {
    offsetOf(index) {
      let sum = 0;
      for (let i = index; i > 0; i -= i & -i) sum += tree[i];
      return sum;
    },
    total() {
      let sum = 0;
      for (let i = n; i > 0; i -= i & -i) sum += tree[i];
      return sum;
    },
    // first row whose end offset is greater than `position`, or n if none
    firstEndingAfter(position) {
      return descend(position, false);
    },
    // last row whose start offset is smaller than `position` (position > 0)
    lastStartingBefore(position) {
      return Math.min(n - 1, descend(position, true));
    },
    // number of rows whose end offset is <= `position`
    countEndingAtOrBefore(position) {
      return descend(position, false);
    },
    // first row whose start offset is >= `position`
    firstStartingAtOrAfter(position) {
      return position <= 0 ? 0 : Math.min(n, descend(position, true) + 1);
    },
    setCount(next) {
      rebuild(next);
    },
    // the size of a row changed by `delta`
    update(index, delta) {
      for (let i = index + 1; i <= n; i += i & -i) tree[i] += delta;
    },
  };
}

module.exports = { createOffsets };
