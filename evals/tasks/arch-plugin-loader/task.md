# Implement a plugin loader

Create `loader.js` (CommonJS, plain Node, no dependencies) exporting
`async function loadPlugins(plugins, host)`.

A plugin is `{ name, version, requires, init(ctx), dispose? }`:
- `name`: unique string. `version`: string `MAJOR.MINOR.PATCH` (digits only).
- `requires`: optional object `{ [pluginName]: range }`.
- `init(ctx)`: sync or async, returns the plugin's API (any value, may be `undefined`).
- `dispose()`: optional, sync or async.

`ctx` is `{ host, name, get(depName) }`. `ctx.host` is the same `host` object
passed to `loadPlugins`; `ctx.name` is the plugin's own name. `ctx.get(depName)`
returns the API that dependency's `init` returned. It may only be used for
dependencies the plugin declared in `requires`; any other name (even a loaded
plugin) throws an `Error`.

## Ranges
A range is a full `X.Y.Z` (digits only) optionally prefixed by one operator.
Compare version parts numerically (`1.10.0 > 1.9.0`).
- `X.Y.Z`: exactly that version.
- `>=X.Y.Z`: that version or higher.
- `~X.Y.Z`: `>=X.Y.Z <X.(Y+1).0`.
- `^X.Y.Z`: `>=X.Y.Z` below the next version that changes the left-most
  non-zero part: `^1.2.3` is `<2.0.0`, `^0.2.3` is `<0.3.0`, `^0.0.3` is
  exactly `0.0.3`.

## Loading
Validation happens first and no `init` runs if any check fails. Checks run in
this order, rejecting with the first failure found (scan plugins in input
order, and each plugin's `requires` in key order):
1. Duplicate plugin name: `Error` with `code === "DUPLICATE_PLUGIN"`, message containing the name.
2. A plugin version or any range not matching the formats above: `TypeError`.
3. A required plugin that is not in the list: `Error` with
   `code === "MISSING_DEPENDENCY"`, message containing both plugin names. A
   required plugin whose version does not satisfy the range: `Error` with
   `code === "INCOMPATIBLE_VERSION"`, message containing both names, the range
   and the found version.
4. A dependency cycle (including a plugin requiring itself): `Error` with
   `code === "DEPENDENCY_CYCLE"` and `err.cycle`, an array of names whose first
   and last entries are equal and where each entry requires the next, e.g.
   `["a", "b", "c", "a"]`. The message contains the path joined with `" -> "`.

Initialization is sequential (each `init` is awaited before the next starts).
Order: repeatedly init the not-yet-initialized plugin that is earliest in the
input array among those whose dependencies are all initialized. So independent
plugins keep input order, and a plugin is delayed only until its dependencies
are done.

If an `init` throws or rejects, dispose every plugin whose `init` already
succeeded, in reverse init order (awaiting each; plugins without `dispose` are
skipped; the failed plugin is not disposed and no later plugin is initialized).
A `dispose` that throws during this rollback must not stop the others and its
error is discarded. Then reject with the original init error (same object).

On success resolve to `{ order, get(name), unloadAll() }`:
- `order`: array of names in init order.
- `get(name)`: the plugin's API, or `undefined` for an unknown name.
- `unloadAll()`: async; calls `dispose` of every plugin in reverse init order,
  awaiting each one. If some dispose calls throw or reject, it still disposes
  all the others, then rejects with an `AggregateError` whose `errors` are the
  collected errors in the order they happened. Each plugin is disposed at most
  once: a second `unloadAll()` does nothing and resolves.
