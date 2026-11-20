"use strict";

// Glue between a DOM-like scroll container and a virtualizer. It mirrors the
// scroll position the user sees (the virtualizer's remembered position, which
// already includes the anchoring delta returned by measure) so measuring rows
// above the viewport does not make the content jump.

function createScrollController(virtualizer) {
  let scrollTop = 0;

  return {
    get scrollTop() {
      return scrollTop;
    },
    scrollTo(top) {
      const range = virtualizer.getRange(top);
      scrollTop = virtualizer.getScrollTop();
      return range;
    },
    // Called when a rendered row reports its real height.
    onMeasure(index, size) {
      const delta = virtualizer.measure(index, size);
      scrollTop = virtualizer.getScrollTop();
      return delta;
    },
    // Jump so that `index` is shown, then report the new window.
    reveal(index, align) {
      scrollTop = virtualizer.scrollToIndex(index, align);
      return virtualizer.getRange(scrollTop);
    },
    range() {
      return virtualizer.getRange(scrollTop);
    },
  };
}

module.exports = { createScrollController };
