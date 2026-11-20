import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readUiSource } from "./ui-source.ts";

const root = join(import.meta.dir, "..");
const globals = readFileSync(join(root, "src", "ui", "globals.css"), "utf8");
const styles = readFileSync(join(root, "src", "ui", "styles.css"), "utf8");
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
  "--fg",
  "--muted",
  "--faint",
  "--line",
  "--surface",
  "--accent",
  "--info",
  "--success",
  "--warning",
] as const;

describe("theme tokens", () => {
  test("globals.css owns the complete shadcn light and dark token sets", () => {
    for (const token of SHADCN_THEME_TOKENS) {
      const matches = globals.match(new RegExp(`^\\s*${token}:`, "gm")) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }
    expect(globals).toMatch(/\.dark,\s*\[data-theme="dark"\]\s*\{/);
    expect(styles).not.toMatch(/^\s*--(background|foreground|card|primary|border|ring):/m);
  });

  test("the theme toggle applies .dark and persists explicit choices", () => {
    expect(main).toContain('root.classList.toggle("dark", prefersDark)');
    expect(main).toContain('root.classList.toggle("dark", theme === "dark")');
    expect(main).toContain('writeStorage("decant-theme", theme)');
    expect(main).toContain('removeStorage("decant-theme")');
  });

  test("legacy view tokens are aliases owned by globals.css", () => {
    for (const token of CHART_TOKENS) {
      expect(globals).toMatch(new RegExp(`^\\s*${token.replace("--", "\\-\\-")}:`, "m"));
      expect(styles).not.toMatch(new RegExp(`^\\s*${token}:`, "m"));
    }
    expect(globals).toContain("--fg: var(--foreground)");
    expect(globals).toContain("--canvas: var(--background)");
    expect(globals).toContain("--line: var(--border)");
    expect(globals).toContain("--surface: var(--card)");
  });

  test("chart tokens match what chartColors() reads", () => {
    const readNames = [...main.matchAll(/value\("(--[a-z-]+)"\)/g)].flatMap(
      (match) => match[1] ?? [],
    );
    expect(readNames.sort()).toEqual([...CHART_TOKENS].sort());
  });

  test("bar charts use a neutral hover band in both themes", () => {
    expect(main).toContain("shadowStyle: { color: colors.hover }");
    expect(main).toContain('styles.colorScheme === "dark"');
    expect(main).toContain('"rgba(255, 255, 255, 0.05)"');
    expect(main).toContain('"rgba(20, 20, 20, 0.05)"');
  });

  test("fill-grade colours are never used as text", () => {
    for (const token of ["accent", "success", "warning", "danger", "info", "claude"]) {
      expect(styles).not.toContain(`color: var(--${token});`);
      expect(globals).toContain(`--${token}-text:`);
    }
  });
});
