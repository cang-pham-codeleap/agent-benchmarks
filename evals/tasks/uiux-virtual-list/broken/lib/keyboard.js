"use strict";

const { clamp } = require("./validate");

// Keyboard navigation over `count` rows; `pageRows` is how far PageUp and
// PageDown travel.

function nextFocus(index, key, count, pageRows) {
  switch (key) {
    case "ArrowUp":
      return clamp(index - 1, 0, count - 1);
    case "ArrowDown":
      return clamp(index + 1, 0, count - 1);
    case "PageUp":
      return clamp(index - pageRows, 0, count - 1);
    case "PageDown":
      return clamp(index + pageRows, 0, count - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return index;
  }
}

module.exports = { nextFocus };
