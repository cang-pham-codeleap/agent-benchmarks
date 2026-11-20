# Notifier: from switch to registry

`notify.js` (CommonJS, plain Node, no dependencies) exports `send(message)`,
which hard-codes three channels in one growing `switch`, with duplicated
validation and formatting. Every new channel means editing that function.
Redesign it so channels can be added without touching core code
(open/closed), **without changing how the existing channels behave**.

## Required API (`notify.js`)

`module.exports = { createNotifier, send }`

- `createNotifier()` returns a new, independent notifier
  `{ register(name, channel), send(message), channels() }`.
  Each notifier has its own registry: registering a channel on one notifier
  must never affect another notifier or the exported `send`.
- A **channel** is an object `{ validate(message), deliver(message) }`.
  `validate` throws if the message is invalid and returns normally otherwise.
  `deliver` performs the delivery and returns a result value.
- `register(name, channel)`:
  - `name` must be a non-empty string and `channel` must have function
    `validate` and `deliver`; otherwise throw `TypeError`.
  - Registering a name that is already registered (built-in or custom;
    names are case-sensitive) throws an `Error` whose message contains the
    name. The existing channel stays in place.
- `send(message)`:
  - `message` is an object whose `channel` field names the channel.
  - If `message.channel` is not a registered name (including missing,
    non-string, or names like `"constructor"` / `"toString"`), throw an
    `Error` whose message contains the offending name (or `String(value)`),
    and deliver nothing.
  - Otherwise call the channel's `validate(message)` first. If it throws,
    that error propagates unchanged and `deliver` is **not** called.
  - Then call `deliver(message)` once and return
    `{ channel: <name>, result: <value returned by deliver> }`.
- `channels()` returns an array of registered names in registration order.
- Every new notifier has the built-in channels `email`, `sms`, `slack`
  registered already, in that order.
- The exported `send(message)` is a default notifier's `send`
  (it has the built-ins and nothing else).

## Built-in channels (behavior must stay exactly as in the current code)

Messages have `channel`, `to`, `body`, and for email also `subject`.
Invalid messages throw `TypeError`; `deliver` returns the formatted payload
string below.

| channel | valid when | payload |
|---|---|---|
| `email` | `to` matches `name@host` (no spaces, exactly one `@`, non-empty both sides); `subject` is a non-empty string; `body` is a string with non-whitespace content | `To: <to>\nSubject: <subject>\n\n<body>` |
| `sms` | `to` is `+` followed by 8 to 15 digits; `body` is a non-empty string of at most 160 characters | `<body>` |
| `slack` | `to` is `#` followed by one or more of `a-z 0-9 _ -`; `body` is a string with non-whitespace content | `[<to>] <body>` |

The current code is the reference for anything not spelled out here.

## Design constraint

The code that dispatches a message must not branch on channel names: no
`switch` and no `if`/ternary chain comparing the channel to `"email"`,
`"sms"` or `"slack"` anywhere in your `.js` files. Built-ins are ordinary
registrations. Adding a hypothetical `pager` channel must require zero edits
to the dispatch logic.
