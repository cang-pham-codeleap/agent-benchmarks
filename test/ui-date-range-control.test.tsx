import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { useState } from "react";
import { ALL_DATE_RANGE, REVERSED_RANGE_MESSAGE } from "../src/ui/date-range.ts";
import { DateRangeControl, useTodayRollover } from "../src/ui/date-range-control.tsx";
import type { DateRangeSelection } from "../src/ui/types.ts";
import { byText, click, fire, setupDom, type } from "./ui-dom.ts";

const dom = setupDom();
afterEach(() => {
  setSystemTime();
});

function Owner({ changes }: { changes: DateRangeSelection[] }) {
  const [range, setRange] = useState(ALL_DATE_RANGE);
  return (
    <DateRangeControl
      bounds={null}
      onChange={(next) => {
        changes.push(next);
        setRange(next);
      }}
      range={range}
    />
  );
}

function Today({ initial }: { initial: DateRangeSelection }) {
  const [range, setRange] = useState(initial);
  useTodayRollover(range.preset === "today", setRange);
  return <output>{`${range.from}..${range.to}`}</output>;
}

async function openControl() {
  const changes: DateRangeSelection[] = [];
  const { container } = await dom.render(<Owner changes={changes} />);
  const trigger = container.querySelector('button[aria-label^="Time range:"]');
  await click(trigger);
  return { changes, trigger };
}

describe("DateRangeControl", () => {
  test("opens labelled From and To fields beside the presets", async () => {
    const { trigger } = await openControl();
    expect(trigger?.getAttribute("aria-label")).toBe("Time range: All time");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('input[aria-label="From date"]')).not.toBeNull();
    expect(document.querySelector('input[aria-label="To date"]')).not.toBeNull();
    const panel = document.querySelector('[role="dialog"]');
    expect(panel?.textContent?.match(/Custom range/g)).toHaveLength(1);
    expect(byText(document, "button", "Custom range")).toBeNull();
  });

  test("announces a reversed range and only reports a valid one", async () => {
    const { changes } = await openControl();
    const from = document.querySelector('input[aria-label="From date"]');
    const to = document.querySelector('input[aria-label="To date"]');

    await type(from, "2026-10-23");
    expect(changes).toEqual([{ preset: "custom", from: "2026-10-23", to: null }]);
    await type(to, "2026-10-01");
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe(REVERSED_RANGE_MESSAGE);
    expect(to?.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(to?.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      REVERSED_RANGE_MESSAGE,
    );
    expect(changes).toHaveLength(1);

    await type(to, "2026-10-30");
    expect(live?.textContent).toBe("");
    expect(changes.at(-1)).toEqual({ preset: "custom", from: "2026-10-23", to: "2026-10-30" });
  });

  test("a preset reports its range and closes the popover", async () => {
    setSystemTime(new Date("2026-11-23T12:00:00Z"));
    const { changes, trigger } = await openControl();
    await click(byText(document, "button", "Today"));
    expect(changes).toEqual([{ preset: "today", from: "2026-11-23", to: "2026-11-23" }]);
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("useTodayRollover", () => {
  test("a Today selection follows the UTC date when the tab becomes visible again", async () => {
    setSystemTime(new Date("2026-11-23T23:59:00Z"));
    const { container } = await dom.render(
      <Today initial={{ preset: "today", from: "2026-11-23", to: "2026-11-23" }} />,
    );
    setSystemTime(new Date("2026-11-24T08:00:00Z"));
    await fire(document, new Event("visibilitychange"));
    expect(container.textContent).toBe("2026-11-24..2026-11-24");
  });

  test("other ranges stay put", async () => {
    setSystemTime(new Date("2026-11-24T08:00:00Z"));
    const { container } = await dom.render(
      <Today initial={{ preset: "7d", from: "2026-11-17", to: "2026-11-23" }} />,
    );
    await fire(document, new Event("visibilitychange"));
    expect(container.textContent).toBe("2026-11-17..2026-11-23");
  });
});
