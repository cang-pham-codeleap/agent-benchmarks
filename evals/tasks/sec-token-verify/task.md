# Harden JWT-style token verification in token.js

`token.js` (CommonJS, plain Node, no dependencies) signs and verifies compact
HS256 tokens of the form `base64url(header).base64url(payload).base64url(signature)`.
`sign` is correct; `verify` is naive and can be forged. Rewrite `verify` so it
is safe. Keep the file name and the exports `sign` and `verify`. Do not change
what `sign` produces.

## Format

- Header: JSON object `{"alg":"HS256","typ":"JWT","kid":<kid>}`. Payload: a JSON object.
- Signature: HMAC-SHA256, keyed with the secret for `kid`, over the ASCII string
  `<header segment>.<payload segment>` (the segments exactly as they appear in the token).
- `base64url` is the unpadded URL-safe alphabet `A-Za-z0-9_-`.
- `sign(payload, keys, kid)`: `keys` is a plain object mapping kid to secret string.
  Throws if `kid` is not an own key of `keys`.

## `verify(token, { keys, now, issuer, audience, clockSkewSec = 0 })`

`keys` maps kid to secret (several kids may be present, for rotation). `now` is
the current time in whole seconds (a number supplied by the caller; never read the
clock). `issuer` and `audience` are optional strings. `verify` never throws; it returns
`{ ok: true, payload }` (payload is the decoded object) or `{ ok: false, reason }`
where `reason` is exactly one of:

`malformed`, `bad_alg`, `unknown_kid`, `bad_signature`, `invalid_claim`,
`expired`, `not_yet_valid`, `bad_issuer`, `bad_audience`.

Checks run in this order and the first failing check decides the reason:

1. `malformed`: `token` is not a string; it does not have exactly three
   `.`-separated segments; any segment is empty; any segment is not strict
   base64url (characters outside the alphabet, `=` padding, a length that no
   byte sequence encodes, or a non-canonical encoding, i.e. re-encoding the decoded
   bytes does not give back the same segment text); the header segment is not UTF-8 JSON
   whose value is a plain object (arrays, `null` and primitives are not).
2. `bad_alg`: header `alg` is not exactly the string `"HS256"` (`none`, `hs256`,
   `HS256 `, a missing or non-string `alg`, ... are all rejected).
3. `unknown_kid`: header `kid` is not a string naming an **own** property of `keys`
   (so `"__proto__"`, `"constructor"`, `"toString"` are unknown unless truly in `keys`).
4. `bad_signature`: the signature does not match, or does not decode to 32 bytes.
   Compare in constant time.
5. `malformed` again: the signature is valid but the payload segment is not UTF-8
   JSON whose value is a plain object.
6. `invalid_claim`: `exp`, `nbf` or `iat` is present but is not a finite number.
7. `expired`: `exp` is present and `now >= exp + clockSkewSec`.
8. `not_yet_valid`: `nbf` is present and `now < nbf - clockSkewSec`, or `iat` is
   present and `now < iat - clockSkewSec`.
9. `bad_issuer`: `issuer` option is given and payload `iss` is not exactly that string.
10. `bad_audience`: `audience` option is given and payload `aud` is neither that
    string nor an array of strings containing it.

If no `issuer`/`audience` option is given, `iss`/`aud` are not checked.
