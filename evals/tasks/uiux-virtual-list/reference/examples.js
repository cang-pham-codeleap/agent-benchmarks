"use strict";

// Run with `node examples.js` to eyeball the engine: a 1000 row list whose
// rows get measured to a different size than their estimate as they render.

const { createVirtualizer } = require("./virtual");
const { createScrollController } = require("./lib/scroll-controller");
const { renderWindow } = require("./list");

const v = createVirtualizer({
  count: 1000,
  estimateSize: (i) => 20 + (i % 3) * 5,
  overscan: 2,
  viewportSize: 100,
});
const controller = createScrollController(v);

console.log(renderWindow(v, 500, (i) => `item ${i}`));

const range = controller.scrollTo(500);
for (const item of range.items) {
  // pretend the DOM said every row is a little taller than estimated
  const delta = controller.onMeasure(item.index, item.size + 4);
  if (delta !== 0) console.log(`row ${item.index} shifted the view by ${delta}`);
}
console.log("scrollTop is now", controller.scrollTop);
console.log("jump target for row 700 centered:", v.scrollToIndex(700, "center"));
console.log("focus after PageDown from 10:", v.nextFocus(10, "PageDown"));
