# Write an SSRF guard in guard.js

A service fetches user-supplied URLs. `guard.js` (CommonJS, plain Node, no
dependencies) must decide whether a URL is safe to fetch. The starter only
checks the scheme and the literal host `localhost`. Complete it. Keep the file
name and exports: `checkUrl` and `checkRedirectChain`.

## `async checkUrl(url, { resolve })`

`resolve(hostname)` is an injected DNS function (sync or async) returning an
array of address strings (IPv4 dotted decimal or IPv6 in any textual form, an
IPv6 zone suffix like `%eth0` may appear). It is never called for IP-literal
hosts or for blocked `localhost` names, and is called at most once, with
`new URL(url).hostname`.

Returns `{ ok: true, reason: null }` or `{ ok: false, reason }`. Never throws
(a non-string `url` is `invalid-url`). Parse with
the WHATWG `URL` class and judge the parsed result. Checks run in this order and
the first failure decides `reason`:

1. `"invalid-url"`: `new URL(url)` throws (or `url` is not a string).
2. `"scheme"`: protocol is not `http:` or `https:`.
3. `"userinfo"`: the URL has a non-empty username or password.
4. `"port"`: effective port (explicit, else 80 for http / 443 for https) is not
   one of 80, 443, 8080.
5. Host:
   - IPv4 literal (the parsed `hostname` is already canonical dotted decimal, so
     forms like `2130706433`, `0177.0.0.1`, `0x7f.1`, `127.1` arrive as
     `127.0.0.1`) or bracketed IPv6 literal: `"blocked-address"` if the address
     is blocked.
   - Name `localhost`, or ending in `.localhost` (a single trailing dot is
     ignored): `"blocked-host"`, no resolution.
   - Any other name: call `resolve`. If it throws/rejects, or does not return a
     non-empty array: `"resolve-failed"`. If ANY returned address is blocked
     (or cannot be parsed as IPv4/IPv6; fail closed): `"blocked-address"`.
6. Otherwise `{ ok: true, reason: null }`.

Blocked IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT),
`127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, and
everything from `224.0.0.0` up (multicast, reserved, broadcast).

Blocked IPv6: unspecified `::`, loopback `::1` and the whole deprecated
IPv4-compatible range `::/96` (first 96 bits zero), unique-local `fc00::/7`,
link-local `fe80::/10`, multicast `ff00::/8`. IPv4-mapped `::ffff:a.b.c.d`
(also written `::ffff:7f00:1` or fully expanded) and NAT64 `64:ff9b::a.b.c.d`
are judged by the embedded IPv4 address with the IPv4 rules above: blocked only
if that IPv4 is blocked. All other IPv6 addresses are allowed.

## `async checkRedirectChain(urls, opts)`

`urls` is the initial URL followed by every redirect target, in order.
`opts` is passed to `checkUrl`. Returns `{ ok: true, reason: null }` or
`{ ok: false, reason, index }`:

- not an array or empty: `{ ok: false, reason: "empty-chain" }` (no `index`).
- more than 6 entries (5 redirects max): `"too-many-redirects"` (no `index`),
  checked before any URL is looked at.
- otherwise go hop by hop; for hop `i` first run `checkUrl` (failure: its
  reason with `index: i`), then if hop `i-1` is `https:` and hop `i` is `http:`
  fail with `"downgrade"` and `index: i`. Stop at the first failure.
