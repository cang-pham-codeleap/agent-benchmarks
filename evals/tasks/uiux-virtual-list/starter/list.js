"use strict";

// Text renderer used by the demo and snapshot tests: one line per rendered
// row, "<index>@<offset>+<size>: <label>".

function renderWindow(virtualizer, scrollTop, labelOf) {
  const label = typeof labelOf === "function" ? labelOf : (i) => `row ${i}`;
  const { items, totalSize } = virtualizer.getRange(scrollTop);
  const lines = items.map((it) => `${it.index}@${it.offset}+${it.size}: ${label(it.index)}`);
  lines.push(`total=${totalSize}`);
  return lines.join("\n");
}

module.exports = { renderWindow };
