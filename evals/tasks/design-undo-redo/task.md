# Build an undo/redo history in history.js

Implement `history.js` (CommonJS, plain Node, no dependencies) exporting
`createHistory({ doc, limit = Infinity, now = Date.now })`, the command history
behind a text editor.

A **command** is an object `{ apply(doc), revert(doc), mergeWith?(next) }`.
`apply` and `revert` mutate `doc`; the history never inspects `doc` itself. A
command either throws before changing anything or completes; the history does
not need to repair a command that throws halfway. `limit` is `Infinity` or a
positive integer, otherwise `createHistory` throws a `RangeError`. `now()`
returns milliseconds.

The history holds an undo stack and a redo stack of **steps**. A step is one or
more commands that undo and redo together.

## API

- `execute(cmd)`: calls `cmd.apply(doc)`. If `apply` throws, nothing is
  recorded and the error propagates. Otherwise the command is recorded (see
  below) and the redo stack is cleared.
- `undo()`: reverts the newest undo step by calling `revert(doc)` on its
  commands in reverse order, moves the step to the redo stack and returns
  `true`. With nothing to undo it returns `false`.
- `redo()`: calls `apply(doc)` on the newest redo step's commands in their
  original order, moves the step back to the undo stack and returns `true`.
  With nothing to redo it returns `false`.
- `canUndo`, `canRedo`: boolean getters (properties, not methods) reflecting
  the committed stacks.
- `transaction(fn)`: calls `fn()` synchronously and returns its result.

## Merging

When a command is executed outside a transaction, it merges into the newest undo
step instead of creating a new step if ALL of these hold:

1. That step was made by a single plain `execute` (never a transaction step,
   even a transaction that ran one command), possibly already merged with
   earlier commands.
2. No `undo()` or `redo()` call happened since that step was last created or
   extended, and no transaction was committed since.
3. The step's current command has a `mergeWith` function, and
   `mergeWith(next)` returns a truthy command. The returned command replaces
   the step's command and stands for "this command, then `next`": undoing the
   step calls only its `revert` once, redoing calls only its `apply` once.
   `next.apply(doc)` has already run normally when `execute` is called; the
   returned command's `apply` is used only for later redos. If `mergeWith`
   returns a falsy value, no merge happens and `next` becomes a new step.
4. The time `now()` reads when `next` is executed is at most 1000 ms after the
   `now()` reading of the previous execute that created or extended the step
   (a sliding window: a long chain of fast edits keeps merging).

A merge does not create a new step, so it does not count against `limit`.
Commands executed inside a transaction never merge with anything.

## Transactions

- Commands executed inside `transaction(fn)` apply immediately but form ONE
  step, committed when `fn` returns. Undo reverts them all in reverse order,
  redo re-applies them in order.
- If no command ran, no step is created, the redo stack is NOT cleared and
  nothing else changes. Redo is cleared only when a non-empty step commits.
- Nested transactions flatten: commands from an inner transaction join the
  outer transaction's single step, and only the outermost one commits.
- If `fn` throws, every command applied inside that transaction is reverted in
  reverse order, nothing is recorded, undo/redo stacks and merge eligibility
  are untouched, and the original error is rethrown. For a nested transaction,
  only the commands executed since that inner transaction started are reverted
  and the error is rethrown to the caller; if the outer `fn` catches it and
  carries on, the outer transaction still commits its remaining commands.
- If `cmd.apply` throws inside a transaction, that command is not recorded; the
  error propagates through `fn` like any other.
- Calling `undo()` or `redo()` inside a transaction throws an `Error` and
  changes nothing.
- `canUndo`/`canRedo` while a transaction runs reflect the committed stacks.

## Limit

After a step is added, if the undo stack holds more than `limit` steps, the
oldest steps are dropped (they can no longer be undone). The limit applies to
the undo stack only.
