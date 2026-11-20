# Audit log, soft delete and unique emails for `accounts`

`base.sql` creates the SQLite table
`accounts(id INTEGER PRIMARY KEY, email TEXT NOT NULL, name TEXT, deleted_at TEXT, updated_at TEXT)`.
Write `audit.sql` (SQLite SQL only; do not edit `base.sql`). It is executed
with `db.exec()` right after `base.sql` on an empty database, once with
`PRAGMA recursive_triggers = OFF` and once with it `ON`. Both must behave
identically. Never use a timestamp other than `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
(call it *now*) for `updated_at` and `deleted_at`.

## 1. Audit log

Create `audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT NOT NULL, row_id INTEGER NOT NULL, old_values TEXT, new_values TEXT, changed TEXT)`.
Triggers on `accounts` append one row per affected `accounts` row:

- Row snapshots are JSON objects built with `json_object` holding exactly the
  keys `id`, `email`, `name`, `deleted_at`, `updated_at` (SQL NULL becomes JSON `null`).
- **INSERT**: `op='INSERT'`, `old_values` NULL, `new_values` = snapshot of the
  stored row, `changed` NULL.
- **DELETE** (a real `DELETE FROM accounts`): `op='DELETE'`, `old_values` =
  snapshot before, `new_values` NULL, `changed` NULL.
- **UPDATE**: `op='UPDATE'`, `old_values`/`new_values` = snapshots before and
  after, `changed` = JSON array of the column names among `email`, `name`,
  `deleted_at` whose value differs (compare NULL-safely: NULL to NULL is no
  change; a case-only change of `email` is a change), listed in that order.
  An UPDATE that changes none of those three columns writes **no** audit row
  (this includes `SET name = name` and setting a column to its current value).
  `row_id` is the row's `id`.
- Snapshots are final: `new_values.updated_at` must equal the `updated_at`
  actually stored once the statement finishes.
- Rows are logged per row, so a statement touching 3 rows but changing 2 logs 2.
- If a statement fails (e.g. a unique violation) it is rolled back as a whole,
  audit rows included.

## 2. `updated_at`

Maintained by triggers (not by callers): on INSERT it is set to *now*
whatever the caller supplied. On UPDATE it is set to *now* whenever the update
changes `email`, `name` or `deleted_at` (even if the caller also assigned
`updated_at`), and left alone otherwise. An UPDATE that assigns **only**
`updated_at` is a plain write: stored as given, not audited, not touched. The
trigger must not fire itself (no recursion, no "too many levels of trigger
recursion" error, no duplicate audit rows) in either recursive_triggers mode.

## 3. Soft delete

Create view `active_accounts(id, email, name, updated_at)` listing the rows
with `deleted_at IS NULL`. `DELETE FROM active_accounts [WHERE ...]` must not
remove anything: it sets `deleted_at` to *now* on each matching row (only
active ones, so deleted rows are never re-stamped), and that goes through the
audit log as an ordinary `UPDATE` with `changed = ["deleted_at"]`. Restoring
(`UPDATE accounts SET deleted_at = NULL`) is an ordinary update too.

## 4. Unique email

Among rows with `deleted_at IS NULL`, `email` is unique ignoring ASCII case
(`Ann@X.com` and `ann@x.COM` conflict). The stored text keeps its original
case. Deleted rows are exempt: a deleted address can be reused by a new
account, several deleted rows may share an address, and restoring a deleted
row whose address is now taken by an active row must fail (leaving it deleted).
Enforce this with an index, not triggers.
