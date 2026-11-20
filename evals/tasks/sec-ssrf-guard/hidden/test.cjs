"use strict";
const path = require("node:path");
const ws = process.env.ACH_WORKSPACE || process.cwd();
let g;
try { g = require(path.join(ws, "guard.js")); } catch (e) { console.log("FAIL load: " + e.message); process.exit(1); }

const DNS = {
  "example.com": ["93.184.216.34"],
  "v6.example.com": ["2606:4700:4700::1111"],
  "mixed.example.com": ["93.184.216.34", "10.0.0.5"],
  "mixed2.example.com": ["8.8.8.8", "::1"],
  "rebind.example.com": ["1.1.1.1", "169.254.169.254"],
  "empty.example.com": [],
  "mapped.example.com": ["::ffff:127.0.0.1"],
  "mappedpub.example.com": ["::ffff:8.8.8.8"],
  "zone.example.com": ["fe80::1%eth0"],
  "garbage.example.com": ["not-an-ip"],
  "evil.com": ["203.0.113.7"],
  "cgnat.example.com": ["100.64.0.1"],
  "uld.example.com": ["fd12:3456::1"],
  "sync.example.com": ["8.8.4.4"],
};
let calls = [];
const resolve = async (h) => {
  calls.push(h);
  if (h === "throws.example.com") throw new Error("ENOTFOUND");
  if (h === "sync.example.com") return DNS[h];
  if (h === "notarray.example.com") return "8.8.8.8";
  return DNS[h] || [];
};
const opts = { resolve };

let failed = 0, n = 0;
async function t(name, fn) {
  n++;
  try { await fn(); console.log("ok " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).split("\n")[0]); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ""} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };

async function expectOk(url) {
  const r = await g.checkUrl(url, opts);
  eq(r.ok, true, url + " ok"); eq(r.reason, null, url + " reason");
}
async function expectBlock(url, reason) {
  const r = await g.checkUrl(url, opts);
  eq(r.ok, false, url + " ok");
  if (reason) eq(r.reason, reason, url + " reason");
}

(async () => {
  await t("public http/https names allowed", async () => {
    await expectOk("http://example.com/a?b=c");
    await expectOk("https://example.com/");
    await expectOk("HTTPS://EXAMPLE.com:8080/x");
  });
  await t("public IPv4 and IPv6 literals allowed, no DNS", async () => {
    calls = [];
    await expectOk("http://8.8.8.8/");
    await expectOk("https://[2606:4700:4700::1111]/");
    await expectOk("http://172.32.0.1/");
    await expectOk("http://100.128.0.1/");
    await expectOk("http://169.255.0.1/");
    await expectOk("http://223.255.255.255/");
    eq(calls.length, 0, "resolve calls");
  });
  await t("resolve called once with hostname; sync resolve ok", async () => {
    calls = [];
    await expectOk("https://sync.example.com/");
    eq(calls.join(), "sync.example.com");
  });
  await t("invalid urls", async () => {
    for (const u of ["", "not a url", "http://", "http://exa mple.com", "http://1.2.3.4.5/", 42, null, undefined])
      await expectBlock(u, "invalid-url");
  });
  await t("schemes", async () => {
    for (const u of ["file:///etc/passwd", "ftp://example.com/", "gopher://example.com", "javascript:alert(1)", "data:text/plain,hi", "ws://example.com/"])
      await expectBlock(u, "scheme");
  });
  await t("userinfo", async () => {
    await expectBlock("http://user@example.com/", "userinfo");
    await expectBlock("http://user:pw@example.com/", "userinfo");
    await expectBlock("http://:pw@example.com/", "userinfo");
    await expectBlock("http://127.0.0.1@evil.com/", "userinfo");
    await expectBlock("http://example.com@127.0.0.1/", "userinfo");
  });
  await t("backslash confusion judged on parsed host", async () => {
    calls = [];
    await expectOk("http://evil.com\\@127.0.0.1/");
    eq(calls.join(), "evil.com");
  });
  await t("ports", async () => {
    await expectOk("http://example.com:80/");
    await expectOk("http://example.com:443/");
    await expectOk("https://example.com:80/");
    await expectOk("http://example.com:8080/");
    await expectOk("http://example.com:0080/");
    for (const p of [22, 25, 81, 8000, 8443, 3000, 6379, 65535, 1])
      await expectBlock(`http://example.com:${p}/`, "port");
  });
  await t("port checked before host", async () => {
    await expectBlock("http://127.0.0.1:22/", "port");
    await expectBlock("ftp://127.0.0.1/", "scheme");
  });
  await t("IPv4 loopback", async () => {
    for (const a of ["127.0.0.1", "127.255.255.254", "127.1.2.3"])
      await expectBlock(`http://${a}/`, "blocked-address");
  });
  await t("IPv4 private RFC1918 and edges", async () => {
    for (const a of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.168.255.255"])
      await expectBlock(`http://${a}/`, "blocked-address");
  });
  await t("IPv4 link-local / metadata", async () => {
    await expectBlock("http://169.254.169.254/latest/meta-data/", "blocked-address");
    await expectBlock("http://169.254.0.1/", "blocked-address");
  });
  await t("IPv4 CGNAT 100.64/10 boundaries", async () => {
    await expectBlock("http://100.64.0.1/", "blocked-address");
    await expectBlock("http://100.127.255.255/", "blocked-address");
    await expectOk("http://100.63.255.255/");
    await expectOk("http://100.128.0.0/");
  });
  await t("IPv4 0/8, multicast, reserved, broadcast", async () => {
    for (const a of ["0.0.0.0", "0.1.2.3", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255"])
      await expectBlock(`http://${a}/`, "blocked-address");
  });
  await t("IPv4 range boundaries just outside are allowed", async () => {
    for (const a of ["9.255.255.255", "11.0.0.0", "126.255.255.255", "128.0.0.1", "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0", "169.253.255.255"])
      await expectOk(`http://${a}/`);
  });
  await t("decimal / octal / hex / short IPv4 forms", async () => {
    for (const u of [
      "http://2130706433/", "http://017700000001/", "http://0x7f000001/",
      "http://0177.0.0.1/", "http://0x7f.1/", "http://127.1/", "http://127.0.1/",
      "http://0x7f.0x0.0x0.0x1/", "http://0/", "http://0.0/",
      "http://3232235521/", "http://0xC0A80001/", "http://012.0.0.1/", "http://2852039166/",
      "http://167772161/", "http://0300.0250.0.1/",
    ]) await expectBlock(u, "blocked-address");
  });
  await t("non-canonical forms of public IPs stay allowed", async () => {
    await expectOk("http://0x08080808/");
    await expectOk("http://134744072/");
  });
  await t("fullwidth-dot IPv4 normalized", async () => {
    await expectBlock("http://127。0。0。1/", "blocked-address");
  });
  await t("IPv6 loopback and unspecified", async () => {
    for (const a of ["::1", "::", "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001"])
      await expectBlock(`http://[${a}]/`, "blocked-address");
  });
  await t("IPv6 ULA fc00::/7", async () => {
    for (const a of ["fc00::1", "fd00::1", "fdff:ffff::1", "FD12:3456::1"])
      await expectBlock(`http://[${a}]/`, "blocked-address");
    await expectOk("http://[fe00::1]/");
    await expectOk("http://[fb00::1]/");
  });
  await t("IPv6 link-local fe80::/10 and boundaries", async () => {
    for (const a of ["fe80::1", "febf::1", "fe80::dead:beef"]) await expectBlock(`http://[${a}]/`, "blocked-address");
    await expectOk("http://[fec0::1]/");
  });
  await t("IPv6 multicast ff00::/8", async () => {
    await expectBlock("http://[ff02::1]/", "blocked-address");
    await expectBlock("http://[ff00::]/", "blocked-address");
  });
  await t("IPv4-mapped IPv6 literals", async () => {
    for (const a of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.1.2.3", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:c0a8:1", "::FFFF:192.168.1.1", "::ffff:0.0.0.0", "::ffff:100.64.0.1"])
      await expectBlock(`http://[${a}]/`, "blocked-address");
  });
  await t("IPv4-mapped public IPv6 allowed", async () => {
    await expectOk("http://[::ffff:8.8.8.8]/");
    await expectOk("http://[::ffff:808:808]/");
  });
  await t("IPv4-compatible ::/96 and NAT64", async () => {
    await expectBlock("http://[::7f00:1]/", "blocked-address");
    await expectBlock("http://[::8.8.8.8]/", "blocked-address");
    await expectBlock("http://[64:ff9b::127.0.0.1]/", "blocked-address");
    await expectBlock("http://[64:ff9b::a00:1]/", "blocked-address");
    await expectOk("http://[64:ff9b::8.8.8.8]/");
  });
  await t("global IPv6 allowed", async () => {
    await expectOk("http://[2001:db8::1]/");
    await expectOk("http://[2a00:1450::1]:8080/");
  });
  await t("localhost names", async () => {
    calls = [];
    for (const u of ["http://localhost/", "http://LOCALHOST:8080/", "http://localhost./", "http://foo.localhost/", "http://a.b.localhost./"])
      await expectBlock(u, "blocked-host");
    eq(calls.length, 0, "resolve calls");
    await expectOk("http://notlocalhost.example.com/".replace("notlocalhost.example.com", "example.com"));
  });
  await t("resolved addresses: any bad one blocks", async () => {
    await expectBlock("http://mixed.example.com/", "blocked-address");
    await expectBlock("http://mixed2.example.com/", "blocked-address");
    await expectBlock("http://rebind.example.com/", "blocked-address");
  });
  await t("resolved IPv6 / mapped / zone / CGNAT / ULA", async () => {
    await expectOk("http://v6.example.com/");
    await expectOk("http://mappedpub.example.com/");
    await expectBlock("http://mapped.example.com/", "blocked-address");
    await expectBlock("http://zone.example.com/", "blocked-address");
    await expectBlock("http://cgnat.example.com/", "blocked-address");
    await expectBlock("http://uld.example.com/", "blocked-address");
  });
  await t("unparseable resolved address fails closed", async () => {
    await expectBlock("http://garbage.example.com/", "blocked-address");
  });
  await t("resolve failures", async () => {
    await expectBlock("http://throws.example.com/", "resolve-failed");
    await expectBlock("http://empty.example.com/", "resolve-failed");
    await expectBlock("http://notarray.example.com/", "resolve-failed");
    await expectBlock("http://unknown.example.org/", "resolve-failed");
  });
  await t("checkUrl never throws", async () => {
    const r = await g.checkUrl("http://throws.example.com/", { resolve: () => { throw new Error("sync boom"); } });
    eq(r.ok, false); eq(r.reason, "resolve-failed");
  });

  const chain = (u) => g.checkRedirectChain(u, opts);
  await t("chain: all safe", async () => {
    const r = await chain(["http://example.com/a", "https://example.com/b", "https://v6.example.com/"]);
    eq(r.ok, true); eq(r.reason, null);
  });
  await t("chain: single url", async () => { eq((await chain(["https://example.com/"])).ok, true); });
  await t("chain: redirect to metadata IP", async () => {
    const r = await chain(["http://example.com/", "http://169.254.169.254/latest/"]);
    eq(r.ok, false); eq(r.reason, "blocked-address"); eq(r.index, 1);
  });
  await t("chain: initial hop bad, index 0", async () => {
    const r = await chain(["ftp://example.com/", "http://example.com/"]);
    eq(r.reason, "scheme"); eq(r.index, 0);
  });
  await t("chain: stops at first failure", async () => {
    const r = await chain(["http://example.com/", "http://example.com:22/", "http://127.0.0.1/"]);
    eq(r.reason, "port"); eq(r.index, 1);
  });
  await t("chain: https to http downgrade", async () => {
    const r = await chain(["https://example.com/", "http://evil.com/"]);
    eq(r.ok, false); eq(r.reason, "downgrade"); eq(r.index, 1);
  });
  await t("chain: http to https and http to http fine", async () => {
    eq((await chain(["http://example.com/", "https://example.com/", "https://evil.com/"])).ok, true);
    eq((await chain(["http://example.com/", "http://evil.com/"])).ok, true);
  });
  await t("chain: unsafe hop beats downgrade on same hop", async () => {
    const r = await chain(["https://example.com/", "http://127.0.0.1/"]);
    eq(r.reason, "blocked-address"); eq(r.index, 1);
  });
  await t("chain: limits", async () => {
    const u = "https://example.com/";
    eq((await chain([u, u, u, u, u, u])).ok, true);
    const r = await chain([u, u, u, u, u, u, u]);
    eq(r.reason, "too-many-redirects"); eq(r.index, undefined);
    const r2 = await chain([u, u, u, u, u, u, "ftp://x/"]);
    eq(r2.reason, "too-many-redirects");
  });
  await t("chain: empty / non-array", async () => {
    for (const x of [[], null, undefined, "http://example.com/"]) {
      const r = await chain(x);
      eq(r.ok, false); eq(r.reason, "empty-chain"); eq(r.index, undefined);
    }
  });

  console.log(`${n - failed}/${n} cases passed`);
  process.exit(failed ? 1 : 0);
})();
