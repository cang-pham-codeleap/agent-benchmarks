# Accessible listbox keyboard reducer

Implement `listbox.js` (CommonJS, plain Node, no dependencies) exporting
`listboxReducer(state, action)` and `getOptionProps(state, id)`. They model
the keyboard behavior of a WAI-ARIA single-select listbox.

## State

```js
{
  options: [{ id, label, disabled }],   // ordered; ids are unique strings
  activeId: string | null,              // option with (virtual) focus
  selectedId: string | null,            // chosen option
  typeahead: { buffer: string, at: number }   // e.g. { buffer: '', at: 0 }
}
```

## Actions

- `{ type: 'key', key, now }` — `key` is a `KeyboardEvent.key` value
  (`'ArrowDown'`, `' '`, `'b'`, ...); `now` is a millisecond timestamp.
- `{ type: 'click', id }`

`listboxReducer` is pure: it returns a new state object and never mutates
the state (or options) passed in. Unhandled keys and no-op actions may return
the same state or an equal copy.

## Rules

Disabled options are never made active by keyboard navigation or typeahead.

- **ArrowDown / ArrowUp**: make the next / previous *enabled* option (by
  position in `options`) active, skipping disabled ones. No wrapping: at the
  last/first enabled option nothing changes. If `activeId` is `null`,
  ArrowDown activates the first enabled option and ArrowUp the last enabled
  one. If `activeId` currently points at a disabled option, move relative to
  its position.
- **Home / End**: activate the first / last enabled option.
- **Enter / `' '` (space)**: set `selectedId` to `activeId`. Does nothing if
  `activeId` is `null` or refers to a disabled option. `activeId` is unchanged.
- **Escape**: set `activeId` to `selectedId` (which may be `null`).
- **Typeahead**: a key that is a single character other than `' '` (any
  `key.length === 1`) is typeahead input. Matching is case-insensitive on the
  start (prefix) of `label`, considering enabled options only.
  - If `now - typeahead.at > 500` the buffer is first reset to `''`
    (a gap of exactly 500 ms continues the buffer).
  - Then the lower-cased key is appended to the buffer and `typeahead` becomes
    `{ buffer, at: now }` (even when nothing matches).
  - If the buffer is one character, or the same character repeated (`'a'`,
    `'aa'`, `'aaa'`), the user is cycling: look for enabled options whose label
    starts with that character, beginning with the option *after* the active
    one and wrapping around the list (ending with the active option itself).
    The first one found becomes active.
  - Otherwise (a multi-character buffer such as `'ba'`) look for enabled
    options whose label starts with the whole buffer, beginning *at* the
    active option (inclusive) and wrapping around. The first one found
    becomes active.
  - When `activeId` is `null` the search starts at the first option.
  - No match: `activeId` is unchanged. Typeahead never changes `selectedId`.
- **click `{ id }`**: if `id` names an enabled option, it becomes both
  `activeId` and `selectedId`. Clicking a disabled or unknown id changes
  nothing.

## getOptionProps(state, id)

Returns exactly
`{ role: 'option', id, 'aria-selected': <boolean>, 'aria-disabled': <boolean> }`
where `aria-selected` is `true` iff `id === state.selectedId` and
`aria-disabled` is `true` iff that option is disabled (a missing `disabled`
means enabled).
