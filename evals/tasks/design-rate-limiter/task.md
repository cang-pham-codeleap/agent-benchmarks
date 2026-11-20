# Rate limiters

Implement `limiter.js` (CommonJS) in the workspace root. It exports `tokenBucket`, `slidingWindowLog`, `fixedWindow` and `all`. Every limiter returned has two methods with the same signature, `(key, cost = 1)`, and the same result shape `{ allowed, retryAfterMs, remaining }`:

- `tryAcquire(key, cost)` decides and, only when allowed, consumes `cost`.
- `peek(key, cost)` returns exactly what `tryAcquire` would return right now, but never consumes anything.

`key` is any value (compared like a `Map` key). Every key has its own independent state, created lazily. Time comes only from the injected `now()` function (milliseconds, never goes backwards). If `now` is omitted it defaults to `Date.now`.

Result fields: `allowed` is a boolean. `retryAfterMs` is `0` when allowed; when denied it is the smallest whole number of milliseconds to wait (counted from the current `now()`) after which the same request would be allowed, assuming no other acquires happen. It is `Infinity` if the request can never be allowed (cost larger than the capacity/limit). `remaining` is the whole units still available after the call (after consuming if allowed; unchanged state if denied).

## Strategies

`tokenBucket({ capacity, refillPerSec, now })`: each key starts full with `capacity` tokens. Tokens refill continuously and fractionally at `refillPerSec` per second, never above `capacity`. Fractions are kept (do not round the stored balance); `remaining` is `Math.floor` of the balance. Allowed when `cost <= balance`. When denied, `retryAfterMs = Math.ceil((cost - balance) / refillPerSec * 1000)`. Denied requests consume nothing.

`slidingWindowLog({ limit, windowMs, now })`: every allowed call is logged with its timestamp and cost. An entry logged at time `t` counts toward the limit while `now < t + windowMs` and has expired at `now >= t + windowMs`. Allowed when `used + cost <= limit`; `remaining = limit - used` (including this call if allowed). When denied, `retryAfterMs` is the smallest wait after which enough entries have expired (oldest first) for the request to fit. Denied requests are not logged.

`fixedWindow({ limit, windowMs, now })`: windows are aligned to the clock: window number is `Math.floor(now / windowMs)`; the count resets when the window changes. Allowed when `count + cost <= limit`. `remaining = limit - count` (including this call if allowed). When denied, `retryAfterMs` is the time until the next window boundary. Denied requests do not count.

For all strategies a request with `cost` larger than the capacity/limit is denied with `retryAfterMs: Infinity` and never consumes; `remaining` is still reported as above.

## `all(limiters)`

Takes a non-empty array of limiters (anything with `tryAcquire` and `peek`) and returns a limiter with the same interface. It allows only if every limiter would allow, and it consumes from none of them when any denies. Implementation requirement: first `peek` every limiter; only if all would allow, call `tryAcquire` on each (once, in array order). If any denies, `tryAcquire` is never called on any of them. Result: `allowed` is the conjunction; `retryAfterMs` is `0` if allowed, otherwise the maximum `retryAfterMs` among the denying limiters; `remaining` is the minimum `remaining` over all limiters. The combined limiter's own `peek` returns the same result without calling any `tryAcquire`. Combined limiters can be nested.

## Validation

Throw `RangeError` at construction for: `capacity`, `refillPerSec`, `windowMs` not finite positive numbers; `limit` not a positive integer; `now` provided but not a function (`TypeError` is not accepted, use `RangeError`); `all` given a non-array or empty array. For `tryAcquire`/`peek`, throw `RangeError` when `cost` is not a finite number > 0 (`undefined` means 1); for `slidingWindowLog` and `fixedWindow` cost must also be an integer. Validation errors must not change any state.

Use only Node built-ins.
