# Variable-height virtual list engine

`virtual.js` (CommonJS, plain Node, no dependencies) is the windowing engine
behind a long list UI. Today it only does a naive version of the job: it
re-sums every row on each call (too slow for 100k rows) and has no scroll
anchoring, no `scrollToIndex` alignment and no keyboard helper. Finish it.

Other files in the workspace use it and must keep working with the same
exports and behavior: `list.js` (`renderWindow`) and
`lib/scroll-controller.js` (`createScrollController`). You may restructure
`lib/` freely, but `virtual.js` must keep exporting `createVirtualizer`.

## `createVirtualizer({ count, estimateSize, overscan = 0, viewportSize })`

- `count`: non-negative integer. `estimateSize`: a positive number, or a
  function `(index) => positive number`, used for rows that were never
  measured. `overscan`: non-negative integer, extra rows rendered on each
  side. `viewportSize`: positive number (viewport height).
- Invalid arguments throw `RangeError`. Every size passed to or returned by
  `estimateSize` must be finite and `> 0` (a bad `estimateSize` result throws
  `RangeError` as soon as it is read).
- Row `i` has `offset(i)` = sum of the sizes of rows `0..i-1`, and a size that
  is its measured size if it has one, else its estimate. Rows are laid out
  back to back with no gaps. `totalSize` = sum of all sizes.

Returned object:

- `getOffset(index)`, `getSize(index)`: for `0 <= index < count`
  (`getOffset(count)` is allowed and equals `totalSize`); other indexes throw
  `RangeError`.
- `getTotalSize()`.
- `getCount()`, `getScrollTop()` (the remembered scroll position).
- `measure(index, size)`: record the real size of a row (`index` must be an
  integer in `[0, count)` and `size` finite and `> 0`, else `RangeError`).
  Returns a scroll delta (see anchoring). Measuring the same size again is a
  no-op returning `0`.
- `getRange(scrollTop)`: see below.
- `scrollToIndex(index, align = "start")`: returns the target `scrollTop`.
- `setCount(n)`.
- `nextFocus(index, key)`.

## `getRange(scrollTop)`

`scrollTop` is first clamped to `[0, max(0, totalSize - viewportSize)]`; the
clamped value is **remembered** as the current scroll position. The visible
rows are those intersecting `[scrollTop, scrollTop + viewportSize)`: row `i`
is visible when `offset(i) < scrollTop + viewportSize` and
`offset(i) + size(i) > scrollTop`. Returns

```
{ start, end, items: [{ index, offset, size }, ...], totalSize }
```

where `start` is the first visible index minus `overscan` and `end` is the
last visible index plus `overscan`, clamped to `[0, count - 1]`; `end` is
**inclusive**; `items` has one entry per row `start..end` in order. With
`count === 0` it returns `{ start: 0, end: -1, items: [], totalSize: 0 }`.

It must stay fast with 100k rows: `getRange`, `measure`, `getOffset` and
`scrollToIndex` have to be sub-linear (use binary search over cumulative
offsets, not a scan over all rows).

## Scroll anchoring

When a row **entirely above the first visible row** is measured with a
different size, the content the user is looking at would jump. `measure`
then returns `newSize - oldSize` (the amount the caller must add to its
scroll position). "Entirely above" is judged against the remembered scroll
position, using the layout *before* this measurement: row `index` is above
when `offset(index) + size(index) <= scrollTop`. In every other case (row
intersecting the viewport, below it, or an unchanged size) it returns `0`.
When a non-zero delta is returned, the remembered scroll position is advanced
by that delta so consecutive `measure` calls stay consistent (no clamping on
that advance). Before any `getRange` call the remembered position is `0`.

## `scrollToIndex(index, align)`

`index` must be an integer in `[0, count)` else `RangeError`; `align` is one
of `"start"`, `"center"`, `"end"`, `"auto"` else `RangeError`. Let
`offset`, `size` be the row's. The unclamped target is

- `start`: `offset`
- `center`: `offset + size / 2 - viewportSize / 2`
- `end`: `offset + size - viewportSize`
- `auto`: minimal movement from the remembered position `cur`:
  if the row is fully visible (`offset >= cur` and
  `offset + size <= cur + viewportSize`) the target is `cur`; else if
  `offset < cur` the target is `offset`; else the row sticks out below: the
  target is `offset + size - viewportSize`, except that a row taller than the
  viewport (`size > viewportSize`) uses `offset`.

The result is clamped to `[0, max(0, totalSize - viewportSize)]`, becomes the
new remembered scroll position, and is returned.

## `setCount(n)`

`n` non-negative integer else `RangeError`. Shrinking drops the measurements
of removed rows; growing keeps the measurements of all surviving rows and
gives new rows their estimates. If the remembered scroll position is now
beyond `max(0, totalSize - viewportSize)` it is clamped to it. (A row that is
removed and re-added is un-measured.)

## `nextFocus(index, key)`

Returns the index to focus after `key`. `index` must be an integer in
`[0, count)` else `RangeError` (with `count === 0` always return `-1`).
`pageRows` = the number of rows **fully** inside
`[cur, cur + viewportSize]` at the remembered scroll position `cur`, but at
least `1`.

- `ArrowUp` / `ArrowDown`: `index - 1` / `index + 1`
- `PageUp` / `PageDown`: `index - pageRows` / `index + pageRows`
- `Home` / `End`: `0` / `count - 1`
- any other key: `index` unchanged

Results are clamped to `[0, count - 1]`.

## Existing consumers

`lib/scroll-controller.js` keeps a `scrollTop`, applies the delta returned by
`measure`, and `list.js` renders a window as text lines; both rely on the
contract above.
