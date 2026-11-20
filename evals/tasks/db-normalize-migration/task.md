# Normalize the contacts schema

`v1.sql` describes a SQLite database (schema version 1) with one table, `contacts`, whose `tags` column is a comma-separated string. The strings are messy: stray spaces around items, mixed case, duplicates, empty items (e.g. `' Friend, work ,friend,,'`), empty strings, and NULLs.

Write `migrate.sql` in this directory. It will be executed (as a whole, with SQLite's multi-statement `exec`) against an existing v1 database and must transform it **in place** into schema version 2:

- `contacts(id, full_name, email)`: same rows and same `id`/`full_name`/`email` values as before; the `tags` column must be gone.
- `tags(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)`: one row per distinct tag. Names are trimmed of spaces and lowercased (ASCII case folding, as SQLite's `lower()` does). Empty names must never appear. Non-ASCII characters are kept as they are.
- `contact_tags(contact_id, tag_id)`: one row per (contact, tag) link, `PRIMARY KEY (contact_id, tag_id)`, with foreign keys to `contacts(id)` and `tags(id)`. A contact gets each of its tags once, even if repeated in different cases; contacts with empty or NULL tags get no links.
- No other tables may remain (temporary tables must be dropped; indexes are fine).
- The whole migration must run inside a single transaction (`BEGIN` ... `COMMIT`), so a failure leaves the v1 database untouched. Foreign key enforcement is ON when it runs.

Use only plain SQLite SQL (SQLite 3.35+); no external tools. The migration is run exactly once per database.
