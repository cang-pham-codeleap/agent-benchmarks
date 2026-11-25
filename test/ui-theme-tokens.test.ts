import { beforeEach, describe, expect, test } from "bun:test";
import { prepareAnalyticsChartState } from "../src/ui/chart-state.ts";
import { buildChartOption, chartColors } from "../src/ui/charts.tsx";
import { applyGlobalsCss, setupDom } from "./ui-dom.ts";

setupDom();

beforeEach(() => {
  applyGlobalsCss();
  document.documentElement.classList.remove("dark");
});

function themed<T>(dark: boolean, read: () => T): T {
  document.documentElement.classList.toggle("dark", dark);
  return read();
}

function declared(selector: (text: string) => boolean): string[] {
  return [...(document.styleSheets[0]?.cssRules ?? [])].flatMap((rule) =>
    rule instanceof CSSStyleRule && selector(rule.selectorText)
      ? Array.from({ length: rule.style.length }, (_, index) => rule.style.item(index))
      : [],
  );
}

describe("theme tokens", () => {
  test("every color token the light theme defines is redeclared for dark mode", () => {
    const styles = getComputedStyle(document.documentElement);
    const lightColors = declared((selector) => selector === ":root").filter((name) =>
      /^(hsl|oklch|rgb|#)/.test(styles.getPropertyValue(name).trim()),
    );
    const dark = new Set(declared((selector) => selector.includes(".dark")));

    expect(lightColors.length).toBeGreaterThan(20);
    expect(lightColors.filter((name) => !dark.has(name))).toEqual([]);
  });

  test("charts resolve every color from the active theme", () => {
    const light = themed(false, chartColors);
    const dark = themed(true, chartColors);

    for (const colors of [light, dark]) {
      expect(Object.entries(colors).filter(([, value]) => value === "")).toEqual([]);
    }
    expect(dark.fg).not.toBe(light.fg);
    expect(dark.surface).not.toBe(light.surface);
    expect(dark.line).not.toBe(light.line);
    document.documentElement.dataset.theme = "dark";
    expect(themed(false, chartColors)).toEqual(dark);
    delete document.documentElement.dataset.theme;
  });

  test("bar charts use a neutral hover band in both themes", () => {
    const state = prepareAnalyticsChartState({
      labels: ["2026-07-20", "2026-07-21"],
      metric: "int",
      period: "day",
      values: [1, 2],
      variant: "bar",
    });
    const hoverBand = (dark: boolean) =>
      themed(dark, () => {
        const tooltip = buildChartOption(state).tooltip as {
          axisPointer: { type: string; shadowStyle: { color: string } };
        };
        return tooltip.axisPointer;
      });

    expect(hoverBand(false)).toMatchObject({
      type: "shadow",
      shadowStyle: { color: "rgba(20, 20, 20, 0.05)" },
    });
    expect(hoverBand(true)).toMatchObject({
      type: "shadow",
      shadowStyle: { color: "rgba(255, 255, 255, 0.05)" },
    });
  });
});
