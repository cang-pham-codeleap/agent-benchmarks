# Build the date-picker grid model in datepicker.js

Create `datepicker.js` (CommonJS, plain Node, no dependencies) exporting
`buildMonth`, `move` and `gridProps`. It is a pure model for a WAI-ARIA
date-picker grid: no DOM, no `Date.now()`, no mutation of arguments.

Dates are ISO strings `"YYYY-MM-DD"` (4-digit zero-padded year, years 0001-9999).
All calendar math must be timezone independent (use UTC). Months are 1-12.
Weekdays are 0 (Sunday) to 6 (Saturday).

## `buildMonth({ year, month, firstDayOfWeek = 0, min, max, disabled, today })`

Returns an array of weeks; each week is an array of exactly 7 cells
`{ iso, inMonth, disabled, today }` in column order starting at `firstDayOfWeek`.

- The grid has the fewest weeks that cover the whole month (4 to 6). Days
  before the 1st and after the last day come from the neighbouring months and
  have `inMonth: false`.
- `disabled` on a cell is true when its date is before `min`, after `max`
  (both optional ISO strings, inclusive bounds), is listed in `disabled`, or
  `disabled(iso)` returns truthy. `disabled` may be an array of ISO strings, a
  predicate function, or omitted. Padding cells are checked like any other.
- `today` is an optional ISO string; only the cell with that date has
  `today: true`.
- Throws `RangeError` if `month` is not an integer 1-12 or `firstDayOfWeek` is
  not an integer 0-6.

## `move(state, key)`

`state` is `{ focused, selected, firstDayOfWeek, min, max, disabled, today }`
(`focused` is an ISO string; the rest are optional with the same meaning as
above, `selected` is an ISO string or null). Returns a new state object equal
to `state` except for `focused`. The input is never mutated. An unrecognised
key, or a move that has no valid target, returns a state with `focused`
unchanged. A date is *enabled* when it is within `min`/`max` and not disabled.

Keys:

- `ArrowLeft` / `ArrowRight`: previous / next day. `ArrowUp` / `ArrowDown`:
  previous / next week (7 days). Candidates that are disabled are skipped by
  repeating the same step in the same direction until an enabled date is
  found. If the search would leave `[min, max]`, focus does not move (arrow
  keys never leave the range). Crosses month and year boundaries. A search examines at most 1000
  candidates; if none is enabled by then, focus does not move (so it always
  terminates, even with no `min`/`max`).
- `Home` / `End`: first / last day of the focused date's week, where weeks
  start on `firstDayOfWeek` (default 0).
- `PageUp` / `PageDown`: same day of the previous / next month; if that month
  is shorter the day is clamped to its last day (Jan 31 + PageDown is Feb 28,
  or 29 in a leap year). Crosses year boundaries.
- `Shift+PageUp` / `Shift+PageDown`: same month and day in the previous / next
  year, clamped the same way (Feb 29 becomes Feb 28 in a non-leap year).

For `Home`, `End`, the `Page` keys and `Shift+Page` keys the target is first
clamped into `[min, max]`. If the clamped target is disabled:

- `Home`/`End`: scan toward the originally focused date one day at a time
  (`Home` forwards, `End` backwards) and take the first enabled date; if none
  is found before reaching the focused date, focus does not move.
- `PageUp`/`Shift+PageUp`: scan backwards one day at a time; `PageDown`/
  `Shift+PageDown`: scan forwards. Take the first enabled date; if the scan
  leaves `[min, max]` or examines 1000 dates without success, focus does not
  move.

## `gridProps(state, iso)`

Returns the ARIA attributes for the cell with date `iso`:

- `"aria-selected"`: boolean, true only when `iso === state.selected`.
- `"aria-disabled"`: boolean, true when the date is disabled (same rule as
  `buildMonth`).
- `"tabindex"`: number, `0` for the focused date, `-1` for every other date
  (roving tabindex).
- `"aria-current"`: the string `"date"` when `iso === state.today`; the key is
  absent otherwise.
