import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyGlobalsCss, setupDom } from "./ui-dom.ts";

const root = join(import.meta.dir, "..");
const globals = readFileSync(join(root, "src", "ui", "globals.css"), "utf8");

test("Inter is vendored locally and never fetched remotely", () => {
  expect(globals).not.toMatch(
    /fonts\.googleapis|fonts\.gstatic|use\.typekit|src: url\(["']?https?:/,
  );
  expect(globals).toMatch(
    /@font-face\s*\{[^}]*font-family: "Inter";[^}]*font-weight: 100 900;[^}]*src: url\("(\.\/fonts\/Inter-Variable-Latin\.woff2)"\)/,
  );
  expect(existsSync(join(root, "src", "ui", "fonts", "Inter-Variable-Latin.woff2"))).toBe(true);
});

test("the bundled Inter face includes its OFL license", () => {
  const license = readFileSync(join(root, "src", "ui", "fonts", "Inter-OFL.txt"), "utf8");
  expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
});

describe("rendered text", () => {
  setupDom();

  test("body text uses the vendored Inter face first", () => {
    applyGlobalsCss();
    expect(getComputedStyle(document.body).fontFamily).toMatch(/^"?Inter"?,/);
  });

  test("code text uses the system monospace stack", () => {
    applyGlobalsCss();
    const mono = getComputedStyle(document.documentElement).getPropertyValue("--app-font-mono");
    expect(mono.trim()).toStartWith("ui-monospace,");
  });
});
