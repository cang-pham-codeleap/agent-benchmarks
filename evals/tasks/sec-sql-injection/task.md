# Fix the SQL injection in users.js

`users.js` (CommonJS, plain Node, no dependencies) exports three functions that
query a `node:sqlite` `DatabaseSync` handle `db` holding a table
`users(id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT)`. They build
SQL by string concatenation and are injectable. Make all three injection-safe
without changing their results for normal input. Keep the file name and exports.

- `findUserByEmail(db, email)`: returns the row whose `email` equals the
  argument exactly (case-sensitive), or `undefined` if there is none.
- `searchUsers(db, term)`: returns an array of rows, ordered by `id`, whose
  `name` or `email` contains `term` as a case-insensitive substring. The term
  is matched literally: `%` and `_` in the term are ordinary characters, not
  wildcards (so `"100%"` matches only text containing `100%`). An empty term
  matches every row.
- `listUsers(db, { sortBy = "id", order = "asc" } = {})`: returns all rows
  sorted by column `sortBy` (one of `id`, `name`, `email`, `role`) in `order`
  (`asc` or `desc`, case-insensitive). Ties are broken by `id` ascending. Any
  other `sortBy` or `order` value must throw a `RangeError` before any query
  runs.

Values must never be able to alter the structure of a query, and the `users`
table must be unaffected by any input.
