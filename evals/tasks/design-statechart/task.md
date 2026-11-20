# Statechart interpreter

Implement `machine.js` (CommonJS, plain Node, no dependencies) exporting
`createMachine(config)` and `assign(update)`. It is a small hierarchical
statechart interpreter (think SCXML/XState, without parallel states). The
workspace also holds `README.md` and two example configs in `examples/`; read
them, but the contract below is authoritative.

## Config

```js
createMachine({
  context: { ... },            // optional, default {}; cloned, never mutated
  initial: "idle",             // required: key of a top-level state
  on: { EVENT: <transition> }, // optional, root-level transitions
  states: {
    name: {
      type: "final" | "history", // optional; omit for normal states
      initial: "child",          // required iff the state has non-empty `states`
      states: { ... },           // makes the state compound
      entry: <actions>, exit: <actions>,
      on: { EVENT: <transition> },
      target: "sibling",         // history states only: default (see below)
    },
  },
});
```

A state with non-empty `states` is compound: exactly one child is active.
Otherwise it is atomic (or `final`/`history`). The machine always rests in
exactly one *leaf* (an atomic or final state). State keys are non-empty and
contain no `.`, and do not start with `#`. A state's *path* is its keys
joined by `.` from the top level (`"payment.card.pending"`). The root has path
`""`, it is never entered or exited and has no `entry`/`exit`.

`<actions>` is one action or an array of actions. An action is either a
function `(context, event) => void` (side effects only, return value ignored)
or the object returned by `assign(update)`. `update` is either a function
`(context, event) => partialContext`, or an object whose values are either
functions `(context, event) => value` or literal values (all evaluated
against the context as it was before that assign). The result is shallow
merged into a **new** context object. Assigns take effect immediately, so
later actions and guards see the new context.

`<transition>` is a target string, a transition object, or an array of
transition objects (a target string is shorthand for `{ target }`):

```js
{ target?: string, cond?: (context, event) => boolean,
  actions?: <actions>, internal?: boolean }
```

### Target strings

- `"name"`: a sibling of the state that declares the transition (a top-level
  state, when declared on the root). It may be a dotted path below that
  sibling (`"payment.card"`). A state may target itself by its own key.
- `".name"`: a child (or dotted descendant path) of the declaring state.
- `"#a.b.c"`: absolute path from the root.

A target may be any kind of state: atomic, compound (entered through its
`initial`, recursively), `final`, or `history`.

## Events

`send(event)` takes a string `"X"` or an object `{ type: "X", ...payload }`
(a string is normalized to `{ type: "X" }`; the normalized object is what
guards and actions receive). Anything else (non-string `type`, null, ...)
throws `TypeError`.

### Selecting a transition

Starting at the active leaf and moving outward through its ancestors up to
the root, take the first state whose `on` has the event type. In an array of
transitions the first whose `cond` is absent or returns truthy is chosen
(guards are evaluated against the current context before any action of this
step runs). If every candidate of that state fails its guard, keep looking
at the parent. If nothing is found, the event is ignored. A transition
without `target` is *targetless*: only its actions run, nothing is exited or
entered.

### Running a transition (exact order)

Let S be the declaring state and T the target.

1. **Domain D.** For an external transition (the default) D is the nearest
   proper ancestor of both S and T; when T is S or a descendant of S, or an
   ancestor of S, this means S (resp. T) is exited and re-entered. If S is
   the root, D is the root. With `internal: true` and T a **proper
   descendant** of S, D is S itself, so S is neither exited nor re-entered;
   `internal` with any other target behaves as external. For a `history`
   target, T is the history state's parent for purposes of the entry path
   (see below) but D is computed as if T were the history state itself.
2. Run the **exit** actions of every active state strictly below D,
   **innermost first** (leaf up to the child of D).
3. Run the transition's **actions**, in order.
4. Run the **entry** actions of the states on the path from D (exclusive) down
   to T, **outermost first**; then, if T is compound, keep entering initial
   children (each: entry, then its initial child) until a leaf is reached.

A state key is recorded as the parent's history whenever that state is exited
(the parent remembers the child that was most recently exited).

### History

A `history` state (`type: "history"`) is shallow and a pseudo-state: it is never
active, never entered (no entry actions) and cannot have `states`, `on`,
`entry`, `exit` or `initial`. Transitioning to it enters its parent's
remembered child, and then continues through that child's own `initial`
chain, not through remembered grandchildren. If the parent has no remembered
child, use the history state's `target` (a sibling key, not a history state)
if given, else the parent's `initial`. The path entered runs from D down to
the parent (those states that are not already active), then the chosen child
and its initial descent.

### Final states and `done.state.*`

A `final` state cannot have `states` or `on`. When a final state is entered
(after its entry actions ran) and its parent is not the root, the event
`{ type: "done.state.<parentPath>" }` is queued, e.g. `done.state.checkout`
or `done.state.checkout.payment`. Queued events are processed one at a time,
in FIFO order, after the whole transition that raised them has finished
(including its entries), each by the normal selection rules from the
then-active leaf, and `changed` accounts for the whole macrostep. If a
top-level state is final the machine is *done*: all further events are
ignored (and queued ones dropped).

## Machine object

- Entry actions of the initial configuration run during `createMachine`, with
  event `{ type: "init" }` (outermost first; done events are processed too).
- `send(event)` returns `{ value, context, changed }`: `value` is the active
  leaf's path, `context` the current context, `changed` is true iff the value
  differs from before the event or any context key differs (`Object.is`) after
  the whole macrostep. Ignored events return `changed: false`.
- `snapshot()` returns `{ value, context, history }`, a deep copy that is
  JSON-serializable: `history` maps the path of a parent (`""` for the root)
  to the remembered child key. Mutating a snapshot never affects the machine.
- `restore(snapshot)` replaces value, context and history (deep-copied)
  without running any action and discards queued events. It throws (leaving
  the machine unchanged) if `value` is not the path of a leaf (atomic or
  final) state, or `history` mentions an unknown parent or child. It returns
  `{ value, context, changed: false }`.
- Every `createMachine` call makes an independent machine; the config object
  is never mutated.

## Validation

`createMachine` throws an `Error` for: a missing/non-object `states` or `initial`
that is missing or unknown (root and compound states); an `initial` that
points at a history state; a state definition that isn't an object; unknown
`type`; `final`/`history` with disallowed fields (above); a history `target`
that is unknown or a history state; any unresolvable transition target;
`cond` not a function; an action that is neither a function nor an
`assign(...)` result; illegal state keys; `entry`/`exit` on the root.
`assign()` itself throws `TypeError` when given neither a function nor a
plain object.
