# Build an accessible toast manager

Write `toasts.js` (CommonJS, plain Node, no dependencies) exporting
`createToaster`. It is the state machine behind a toast/notification UI; it
renders nothing. All time goes through injected functions so it is testable.

## `createToaster({ maxVisible = 3, now, setTimer, clearTimer, prefersReducedMotion = false })`

- `now()` returns milliseconds. `setTimer(fn, ms)` returns a handle;
  `clearTimer(handle)` cancels it. Never use the real clock or real timers.
- `maxVisible` must be a positive integer, otherwise throw `RangeError`.
- Returns an object with the methods below.

### `show({ message, kind = "info", durationMs = 5000, id })` -> id (string)

- `kind` is one of `info`, `success`, `warning`, `error`; anything else throws
  `RangeError`. `message` must be a non-empty string (`TypeError` otherwise).
  `durationMs` must be a positive finite number (`RangeError` otherwise).
  Validate before changing any state.
- Without `id`, generate a unique string id. Returns the toast's id.
- A new toast is visible immediately if fewer than `maxVisible` toasts are
  visible, otherwise it is queued.
- Non-error toasts auto-dismiss `durationMs` after they become visible (a
  queued toast's countdown starts when it is promoted to visible, with its full
  duration). **Error toasts never auto-dismiss**: no timer is ever set for them.
- Queue order: first come first served, except an `error` toast goes ahead of
  every queued non-error toast (but behind errors already queued). Errors never
  evict toasts that are already visible.
- **Dedupe by id**: showing an id that is currently visible or queued does not
  create a second toast. The existing toast gets `count + 1` and takes the new
  `message`, `kind` and `durationMs`. If it is visible its countdown restarts
  with the full new duration (if it is now an error the timer is cleared; if it
  is currently paused it stays paused with remaining time equal to the new full
  duration). Its visible position does not change. If it is queued it keeps its
  queue position, except that a non-error that becomes an `error` is
  re-inserted using the error rule above. An id that was dismissed earlier is a
  brand-new toast (`count` 1).

### `dismiss(id)` -> boolean
Removes a visible or queued toast (clearing its timer); returns `false` for an
unknown id. When a visible toast is removed, the head of the queue becomes
visible (appended last in `visible()`) and starts its countdown at the current
`now()`. Auto-dismissal when a timer fires behaves exactly like `dismiss`.

### `pause(id)` / `resume(id)` -> boolean (hover/focus support)
- `pause` applies only to a visible toast with a running countdown. It clears
  the timer and remembers the remaining time (`deadline - now()`). Returns
  `false` for unknown, queued, error, or already-paused toasts.
- `resume` applies only to a paused toast: it schedules a new timer for exactly
  the remembered remaining time, and returns `true`; otherwise `false`.
  Pausing and resuming repeatedly must never lose or add time.

### `visible()` and `queued()`
Arrays of toast snapshots, `visible()` in the order the toasts became visible,
`queued()` in queue order. A snapshot is a plain object:
`{ id, message, kind, count, durationMs, paused, remainingMs, role, ariaLive, animate }`
- `remainingMs`: `null` for errors; the remembered time while paused;
  otherwise `deadline - now()` for visible toasts and `durationMs` for queued
  ones.
- `role`/`ariaLive`: errors get `"alert"`/`"assertive"`, all others
  `"status"`/`"polite"`.
- `animate`: `!prefersReducedMotion`.
Snapshots are copies; mutating them must not affect the toaster.

### `liveRegionProps(toast)`
Takes a snapshot (or any object with a valid `kind`) and returns
`{ role, "aria-live": ariaLive, "aria-atomic": "true" }` using the same
role/politeness mapping as above.
