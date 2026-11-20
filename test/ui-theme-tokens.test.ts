import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readUiSource } from "./ui-source.ts";

const root = join(import.meta.dir, "..");
const globals = readFileSync(join(root, "src", "ui", "globals.css"), "utf8");
const main = readUiSource();

const SHADCN_THEME_TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--primary",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--border",
  "--ring",
] as const;

const CHART_TOKENS = [
  "--card-foreground", "--muted-foreground", "--border", "--card",
  "--chart-1", "--chart-2", "--chart-3", "--chart-4",
] as const;

describe("theme tokens", () => {
  test("globals.css owns the complete shadcn light and dark token sets", () => {
    for (const token of SHADCN_THEME_TOKENS) {
      const matches = globals.match(new RegExp(`^\\s*${token}:`, "gm")) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }
    expect(globals).toMatch(/\.dark,\s*\[data-theme="dark"\]\s*\{/);
  });

  test("the theme toggle applies .dark and persists explicit choices", () => {
    expect(main).toContain('root.classList.toggle("dark", prefersDark)');
    expect(main).toContain('root.classList.toggle("dark", theme === "dark")');
    expect(main).toContain('writeStorage("agent-benchmarks-theme", theme)');
    expect(main).toContain('removeStorage("agent-benchmarks-theme")');
  });


  test("chart tokens match what chartColors() reads", () => {
    const readNames = [...main.matchAll(/value\("(--[a-z0-9-]+)"\)/g)].map((match) => match[1]);
    expect([...new Set(readNames)].sort()).toEqual([...CHART_TOKENS].sort());
  });

  test("bar charts use a neutral hover band in both themes", () => {
    expect(main).toContain("shadowStyle: { color: colors.hover }");
    expect(main).toContain('styles.colorScheme === "dark"');
    expect(main).toContain('"rgba(255, 255, 255, 0.05)"');
    expect(main).toContain('"rgba(20, 20, 20, 0.05)"');
  });

});
