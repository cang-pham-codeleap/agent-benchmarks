"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ws = process.env.ACH_WORKSPACE || process.cwd();
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + ": " + (e && e.message ? e.message : String(e)));
  }
}
process.on("exit", () => {
  if (failed > 0) process.exitCode = 1;
});

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "static-")));
process.on("exit", () => fs.rmSync(base, { recursive: true, force: true }));
const root = path.join(base, "root");
const evil = path.join(base, "root-evil");
const w = (p, s) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};
w(path.join(root, "index.html"), "home");
w(path.join(root, "a.txt"), "a");
w(path.join(root, "b.txt"), "b");
w(path.join(root, "nested/deep/c.txt"), "c");
w(path.join(root, "docs/index.html"), "docs");
w(path.join(root, "empty/.keep"), "");
w(path.join(root, "%41.txt"), "literal percent");
w(path.join(root, "q?x.txt"), "question");
w(path.join(evil, "x.txt"), "evil");
w(path.join(base, "secret.txt"), "secret");
fs.symlinkSync(path.join(base, "secret.txt"), path.join(root, "link-file"));
fs.symlinkSync(evil, path.join(root, "link-dir"));
fs.symlinkSync(base, path.join(root, "nested/up"));

const { resolveStatic } = require(path.join(ws, "static.js"));
const R = (u) => resolveStatic(root, u);
const J = (...p) => path.join(root, ...p);

t("plain and nested files", () => {
  assert.equal(R("/a.txt"), J("a.txt"));
  assert.equal(R("/nested/deep/c.txt"), J("nested/deep/c.txt"));
});
t("query and hash stripped", () => {
  assert.equal(R("/a.txt?v=1"), J("a.txt"));
  assert.equal(R("/a.txt#frag"), J("a.txt"));
  assert.equal(R("/a.txt?x=../../secret.txt#y"), J("a.txt"));
  assert.equal(R("/q%3Fx.txt"), J("q?x.txt"));
});
t("directories serve index.html", () => {
  assert.equal(R("/"), J("index.html"));
  assert.equal(R("/docs"), J("docs/index.html"));
  assert.equal(R("/docs/"), J("docs/index.html"));
  assert.equal(R("/empty"), null);
  assert.equal(R("/nested"), null);
});
t("missing files are null", () => {
  assert.equal(R("/nope.txt"), null);
  assert.equal(R("/nope/a.txt"), null);
});
t("dot segments inside root are normalized", () => {
  assert.equal(R("/nested/../a.txt"), J("a.txt"));
  assert.equal(R("//a.txt"), J("a.txt"));
  assert.equal(R("/./a.txt"), J("a.txt"));
});
t("dot-dot traversal is null", () => {
  assert.equal(R("/../secret.txt"), null);
  assert.equal(R("/../../../../../../etc/passwd"), null);
  assert.equal(R("/nested/../../secret.txt"), null);
});
t("percent-encoded traversal is null", () => {
  assert.equal(R("/%2e%2e/secret.txt"), null);
  assert.equal(R("/%2e%2e%2fsecret.txt"), null);
  assert.equal(R("/..%2fsecret.txt"), null);
  assert.equal(R("/nested/%2E%2E/%2E%2E/secret.txt"), null);
});
t("encoded slash is a separator", () => {
  assert.equal(R("/nested%2Fdeep%2Fc.txt"), J("nested/deep/c.txt"));
});
t("double encoding is decoded only once", () => {
  assert.equal(R("/%2541.txt"), J("%41.txt"));
  assert.equal(R("/%2561.txt"), null);
  assert.equal(R("/%252e%252e%252fsecret.txt"), null);
});
t("backslashes are null", () => {
  assert.equal(R("/..\\secret.txt"), null);
  assert.equal(R("/%5c..%5csecret.txt"), null);
  assert.equal(R("/nested\\deep\\c.txt"), null);
});
t("absolute and non-rooted paths are null", () => {
  assert.equal(R("a.txt"), null);
  assert.equal(R(""), null);
  assert.equal(R("C:\\Windows\\win.ini"), null);
  assert.equal(R("/etc/passwd"), null);
  assert.equal(R("/%2fetc%2fpasswd"), null);
  assert.equal(resolveStatic(root, undefined), null);
});
t("NUL bytes are null", () => {
  assert.equal(R("/a.txt\0.png"), null);
  assert.equal(R("/a.txt%00.png"), null);
  assert.equal(R("/%00"), null);
});
t("malformed percent-encoding is null, never throws", () => {
  for (const u of ["/%", "/%zz", "/%E0%A4%A", "/a%2", "/%C0%AF", "/%ff"]) {
    assert.equal(R(u), null, u);
  }
});
t("prefix confusion with sibling directory is null", () => {
  assert.equal(R("/../root-evil/x.txt"), null);
  assert.equal(R("/%2e%2e/root-evil/x.txt"), null);
});
t("symlinks that escape root are null", () => {
  assert.equal(R("/link-file"), null);
  assert.equal(R("/link-dir/x.txt"), null);
  assert.equal(R("/nested/up/secret.txt"), null);
});
t("trailing separator on root is accepted", () => {
  assert.equal(resolveStatic(root + path.sep, "/a.txt"), J("a.txt"));
  assert.equal(resolveStatic(root + path.sep, "/../root-evil/x.txt"), null);
});
