# Event bus

Implement `bus.js` (CommonJS) in the workspace root. It must export `createBus({ onError } = {})`, returning an object with these methods:

- `on(event, fn)` registers `fn` for the string `event` and returns an unsubscribe function. Calling unsubscribe more than once is harmless. Registering the same `fn` twice creates two independent subscriptions (it is called twice per emit; each unsubscribe removes only its own).
- `once(event, fn)` is like `on`, but `fn` is called at most one time and is removed before it is invoked (so an `emit` of the same event from inside `fn` does not call it again). It also returns an unsubscribe function, which works if called before the event fires.
- `emit(event, payload)` calls the listeners of `event` in subscription order as `fn(payload)`, then calls every wildcard listener (registered with event `'*'`) in subscription order as `fn(event, payload)`. Wildcard listeners are only called after all specific listeners. Returns `undefined`.
- If a listener throws, the remaining listeners still run, and the thrown error is passed to `onError(err, event)` where `event` is the emitted event name (also for wildcard listeners). If `onError` was not provided the error is silently ignored.
- Listeners added during an `emit` (to the same event or to `'*'`) are not called by that emit; they take part in later emits.
- Listeners removed during an `emit` (by unsubscribe, from any listener) are not called by that emit if they have not been reached yet.
- `listenerCount(event)` returns the number of active subscriptions for `event` (for `'*'`, the number of wildcard listeners); `0` for unknown events. Pending `once` listeners count until they fire or are unsubscribed.

Emitting an event with no listeners is a no-op. Use only Node built-ins.
