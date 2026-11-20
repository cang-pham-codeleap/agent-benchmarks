# Multi-tenant document store (SQLite)

`v1.sql` is a single-tenant document store (schema version 1). `v1_sample_data.sql` has a few rows to try your migration on. Turn it into a multi-tenant schema version 2 and write two files in this directory:

- `schema.sql`: creates the v2 schema in an **empty** database.
- `migrate_v1.sql`: upgrades an existing v1 database **in place** to the same v2 schema.

Both are run as a whole with SQLite's multi-statement `exec`, using Node's `node:sqlite`, with `PRAGMA foreign_keys = ON` already set by the caller. Plain SQLite SQL only (3.35+).

## Tables and columns (exact names)

- `tenants(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)`. Names are non-empty.
- `users(id, tenant_id, email, name)`. `email` is unique **per tenant, ignoring ASCII case**, but is stored exactly as given. It must contain an `@` that is not its first character. `name` is `NOT NULL`.
- `folders(id, tenant_id, parent_id, name)`. `parent_id` is NULL for a root folder. `name` is non-empty.
- `documents(id, tenant_id, folder_id, owner_id, title, body)`. `folder_id` and `owner_id` are required. `body` is `NOT NULL DEFAULT ''`.
- `shares(tenant_id, folder_id, user_id, role)`. `role` is `'viewer'` or `'editor'`. A user has at most one share per folder (`PRIMARY KEY (folder_id, user_id)`).

`id` columns are `INTEGER PRIMARY KEY`; inserts omit them. Tests insert only with explicit column lists such as `INSERT INTO folders(tenant_id, parent_id, name) VALUES (?,?,?)`.

## Rules (with `foreign_keys = ON`, enforced by the database itself)

1. **No cross-tenant references, by construction.** A folder's parent, a document's folder and owner, and a share's folder and user must all belong to the row's own `tenant_id`. Use composite foreign keys that include `tenant_id`; do not rely on triggers for this. Every `tenant_id` references `tenants(id)`. A tenant that still has rows cannot be deleted.
2. `tenant_id` is immutable on `users`, `folders` and `documents`: an `UPDATE` that changes it must fail.
3. **Folders form a forest per tenant.** A folder can never be its own ancestor. Enforce this with triggers, on insert and on every move (`UPDATE ... SET parent_id`): making a folder its own parent, or moving it under any of its descendants at any depth, must fail. Legal moves (to a root, under a sibling, under an unrelated folder) must work, including after earlier moves.
4. Deleting a folder deletes its whole subtree: sub-folders at any depth, their documents, and their shares. Rows outside the subtree, and other tenants, are untouched.
5. Deleting a user who still owns documents is **refused** (the user and all their rows stay). Deleting a user without documents succeeds and deletes their shares.
6. **Indexes.** These tenant-scoped queries must each be answered by an index lookup that uses *both* named columns, so `EXPLAIN QUERY PLAN` shows `SEARCH ... USING INDEX ... (<col1>=? AND <col2>=?)` and no `SCAN`:
   - `SELECT * FROM folders WHERE tenant_id = ? AND parent_id = ? ORDER BY name` (also with `parent_id IS NULL`, and the sort must not need a separate sorting step)
   - `SELECT * FROM documents WHERE tenant_id = ? AND folder_id = ?`
   - `SELECT * FROM documents WHERE tenant_id = ? AND owner_id = ?`
   - `SELECT * FROM shares WHERE tenant_id = ? AND user_id = ?`
   - `SELECT * FROM users WHERE tenant_id = ? AND email = ?`
7. `PRAGMA user_version` is `2` after `schema.sql` and after `migrate_v1.sql`.

## Migration (`migrate_v1.sql`)

The v1 database has tables `users`, `folders`, `documents`, `shares` exactly as in `v1.sql` and `user_version = 1`. After the migration:

- A tenant `(id 1, name 'default')` exists and all migrated rows belong to it.
- **All ids are preserved** for users, folders and documents, and the folder tree is identical (`parent_id` unchanged), including trees where a child has a lower id than its parent.
- Emails keep their stored case. A NULL user `name` becomes the user's email. A NULL document `body` becomes `''`. Share roles map `'read'` -> `'viewer'` and `'write'` -> `'editor'`. Folder names, titles, shares (folder, user) and all other values are kept.
- The result is the same schema as `schema.sql` (same constraints, indexes and triggers: every rule above holds afterwards). Only `tenants`, `users`, `folders`, `documents`, `shares` remain: no leftover v1 or temporary tables.
- The whole migration runs in a single transaction (`BEGIN` ... `COMMIT`); a failure leaves the v1 database untouched. Beware: `PRAGMA foreign_keys` cannot be changed inside a transaction.
- `PRAGMA foreign_key_check` returns no rows afterwards. The migration runs exactly once per database.
