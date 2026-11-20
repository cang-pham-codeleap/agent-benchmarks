# Fix the path traversal in `static.js`

`static.js` (CommonJS, plain Node, no dependencies) exports
`resolveStatic(root, urlPath)`, used by a small file server to map a request
URL path to a file on disk. It currently just joins the two paths, so crafted
requests can read files outside the web root. Fix it.

Contract: `root` is an absolute directory path (a trailing separator is
allowed). `resolveStatic` returns the absolute path of the file to serve, or
`null`. It must never throw.

1. `urlPath` must be a string starting with `/`; otherwise return `null`.
2. Drop everything from the first `?` or `#` onward.
3. Percent-decode the rest exactly once (so `%2F` is `/`, and `%2541` becomes
   the literal text `%41`; it is not decoded again). Malformed percent
   encoding returns `null`.
4. Return `null` if the decoded path contains a NUL character or a backslash.
5. Resolve the decoded path against `root` (`.` and `..` segments and repeated
   slashes are normalized, so `/a/../b.txt` is `b.txt` in root). If the result
   is not inside `root`, return `null`. A sibling directory whose name merely
   starts with the root's name (`root-evil` next to `root`) is not inside it.
6. If the target is a directory, serve its `index.html` instead; `null` if it
   has none.
7. Return `null` if nothing exists there or it is not a regular file.
8. Symlinks must not be a way out: if the real location of the target (after
   following symlinks) is outside the real location of `root`, return `null`.
9. On success return the normalized joined path (`path.join(root, ...)`), not
   the symlink-resolved one.
