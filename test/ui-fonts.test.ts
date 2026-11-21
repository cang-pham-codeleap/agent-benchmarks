import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

test("globals.css owns the sans and code font stacks", () => {
  expect(globals).toMatch(/--app-font-sans:\s*"Inter", ui-sans-serif/);
  expect(globals).toMatch(/--app-font-mono: ui-monospace/);
  expect(globals).toMatch(/--font-sans: var\(--app-font-sans\)/);
  expect(globals).toMatch(/--font-mono: var\(--app-font-mono\)/);
  expect(globals).not.toMatch(/Northrup|Geist Mono|--font-serif/);
});
