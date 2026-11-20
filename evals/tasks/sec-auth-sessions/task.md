# Harden the authentication module

`src/` holds a small CommonJS auth stack (plain Node 24, built-ins only, no
dependencies): `store.js`, `passwords.js`, `sessions.js`, `csrf.js`, `login.js`,
`guard.js`, `cookies.js`, `index.js`. It works, but it is insecure. Fix it so it
follows the rules below. Keep every file name, export and function signature;
`store.js`, `guard.js` and `index.js` need no changes unless you want them.
Everything must stay synchronous and deterministic: time only comes from the
injected `now()` function.

## Data model (unchanged)

- `store.users`: `Map<normalizedUsername, { id, username, passwordHash, role }>`.
  Usernames are case-insensitive and trimmed (`normalizeUsername`). Roles are
  `"user"`, `"moderator"`, `"admin"`.
- `store.sessions`: `Map<sessionKey, { userId, createdAt, lastSeenAt }>`.
- `store.attempts`: `Map<attemptKey, ...>`, free for you to use for lockout state.

## passwords.js

- `hashPassword(password)` returns `scrypt$N$r$p$saltHex$hashHex` with `N=16384`,
  `r=8`, `p=1`, a fresh random 16-byte salt every call and a 32-byte derived key,
  both hex (lowercase). A non-string password throws `TypeError`.
- `verifyPassword(password, stored)` returns a boolean and never throws. It
  accepts (a) scrypt strings using the parameters stored in the string and (b)
  legacy hashes: exactly 64 hex characters (either case), the sha256 of the UTF-8
  password. Anything else is `false`: non-strings, wrong segment count, hex that
  is not valid even-length hex, salt shorter than 8 or longer than 64 bytes,
  hash shorter than 16 or longer than 64 bytes, and parameters outside
  `N` a power of two in `1024..65536`, `r` in `1..16`, `p` in `1..4` (checked
  before any expensive work). The derived key length equals the stored hash
  length. Every secret comparison is constant time (`crypto.timingSafeEqual`).
  Note that `N=65536, r=8` needs more than scrypt's default memory limit.
- `needsRehash(stored)` is `true` for legacy hashes, malformed or out-of-range
  strings, and scrypt strings whose `N`, `r`, `p` or hash length differ from the
  current ones; `false` only for a current-format hash.

## sessions.js (`createSessions({ store, now, idleMs, absoluteMs })`)

Defaults: `idleMs` 30 minutes, `absoluteMs` 12 hours.

- Tokens are `crypto.randomBytes(32)` encoded as base64url (43 characters). The
  token is never stored: `store.sessions` is keyed by the lowercase sha256 hex
  digest (UTF-8) of the token, and the record contains no token material.
- `create(userId)` returns a token with `createdAt = lastSeenAt = now()`.
- `validate(token)` returns `{ userId, createdAt, lastSeenAt }` or `null`
  (unknown, malformed or non-string token, or expired). A session is expired when
  `now() - lastSeenAt >= idleMs` or `now() - createdAt >= absoluteMs`; expired
  sessions are deleted from the store when seen. A successful `validate` sets
  `lastSeenAt = now()` (sliding idle window), which never extends the absolute limit.
- `rotate(token)` invalidates the token and returns a new token for the same
  user, keeping the original `createdAt` (rotation does not extend the absolute
  lifetime). `null` if the token is not a live session.
- `destroy(token)` removes one session. `destroyAllForUser(userId, exceptToken)`
  removes every session of the user except the one for the optional
  `exceptToken`, and returns the number removed.

## csrf.js (`createCsrf(secret)`)

`secret` must be a non-empty string or Buffer, else `TypeError`.

- `issue(sessionToken)` returns `nonce.mac`: a fresh random nonce and an
  HMAC-SHA256 (keyed with `secret`) over the session token and the nonce, so the
  token is bound to one session and one secret. Two calls return different
  tokens, both valid. A missing/non-string session token throws `TypeError`.
- `verify(sessionToken, csrfToken)` is `true` only for a token issued by this
  secret for exactly this session. Garbage, truncated, tampered, empty or
  non-string input is `false` and never throws.
- `validate({ method, sessionToken, cookie, header })` (double submit): `GET`,
  `HEAD` and `OPTIONS` (any case) always pass. Any other method (default
  `POST`) passes only if `cookie` and `header` are both strings, are equal, and
  verify for the session. Two different valid tokens do not pass.
- All comparisons are constant time.

## cookies.js

- `parseCookies(header)` returns an object **without a prototype**
  (`Object.create(null)`). Pairs are split on `;`, name and value split at the
  first `=` and trimmed; pairs without `=` or with an empty name are skipped;
  values are `decodeURIComponent`-decoded, but a malformed escape leaves the raw
  value (no throw); the first occurrence of a name wins. A non-string header
  gives an empty object.
- `serializeCookie(name, value, { httpOnly, maxAgeMs })` returns a `Set-Cookie`
  value: `name=<encodeURIComponent(value)>` then the attributes `Path=/`,
  `Secure` and `SameSite=Strict` always, `Max-Age=<whole seconds, rounded down,
  never negative>` when `maxAgeMs` is given, and `HttpOnly` when requested. A
  name that is not `[A-Za-z0-9_-]+` throws `TypeError`.

## login.js (`createAuth({ store, now, csrfSecret, idleMs, absoluteMs, lockout, onEvent })`)

`lockout` overrides the defaults `{ threshold: 5, baseMs: 1000, maxMs: 900000,
resetMs: 3600000 }`. `onEvent` defaults to a no-op.

- `register(username, password, { role })`: password shorter than 8 characters
  throws `RangeError`, unknown role `RangeError`, duplicate username (after
  normalization) `Error`, empty username `TypeError`. Passwords are stored with
  `hashPassword`. Returns the public user `{ id, username, role }`. **No
  function may return or expose `passwordHash`.**
- `login(username, password, { ip, token })`:
  - Non-string username or password: `{ ok: false, error: "invalid_credentials" }`.
  - Unknown user and wrong password return exactly the same
    `{ ok: false, error: "invalid_credentials" }` and do comparable work (an
    unknown user still pays for one password verification).
  - Lockout state is kept per account **and** client IP (`ip` missing means
    `"unknown"`), keyed on the normalized attempted username whether or not that
    account exists. After the failure that makes the count reach `threshold`,
    the pair is locked until `now + min(baseMs * 2^(failures - threshold),
    maxMs)`; each further failure after the lock expires doubles the lock up to
    `maxMs`. While locked (`now < lockedUntil`) every attempt, even with the
    right password, returns `{ ok: false, error: "locked", retryAfterMs }` with
    `retryAfterMs = lockedUntil - now`, and does not count as a failure. A
    success clears the pair's state. If `resetMs` or more passed since the
    pair's last failure, the failure count restarts from zero. Other IPs and
    other usernames are unaffected.
  - On success: if `needsRehash(passwordHash)`, the stored hash is replaced by a
    fresh `hashPassword(password)` (transparent upgrade of legacy hashes). Then a
    new session is created and, if a `token` was passed, that old session is
    destroyed (no session fixation). Returns `{ ok: true, token, csrfToken, user }`
    where `csrfToken = csrf.issue(token)` and `user` is the public user.
- `authenticate(token)` returns the public user (role read live from the store)
  or `null`; a session whose user no longer exists is destroyed.
- `logout(token)` destroys **all** sessions of that session's user and returns
  `true`; for a token that is not a live session it returns `false` and changes
  nothing.
- `setRole(username, role, { token })`: unknown role throws `RangeError`; unknown
  user `{ ok: false, error: "no_such_user" }`. Otherwise the role is changed,
  the caller's session is rotated if `token` is a live session of that same user,
  and every other session of the user is destroyed. Returns `{ ok: true, token,
  csrfToken }` with the new pair, or `token: null, csrfToken: null` when no valid
  caller session was given.
- `changePassword(username, oldPassword, newPassword)`: non-string arguments, an
  unknown user or a wrong old password return the same
  `{ ok: false, error: "invalid_credentials" }` (unknown user still pays for one
  verification; this does not count towards lockout). A new password shorter than
  8 characters (checked after the old password) returns
  `{ ok: false, error: "weak_password" }`. Success stores a new `hashPassword`,
  destroys all sessions of the user and returns `{ ok: true }`.
- The `auth` object also exposes `sessions` and `csrf`.
- `onEvent` receives exactly these plain objects and never any password, token,
  CSRF token or hash: `{ type: "login_success", username, ip }`,
  `{ type: "login_failure", username, ip }`, `{ type: "login_locked", username,
  ip }` (`username` normalized, `ip` is `"unknown"` when absent),
  `{ type: "logout", username }`, `{ type: "role_changed", username, role }`,
  `{ type: "password_changed", username }`. No event for non-string `login`
  arguments.

`guard.js` must keep working: `401` without a live session, `403` on a failed
CSRF check, otherwise `200`.
