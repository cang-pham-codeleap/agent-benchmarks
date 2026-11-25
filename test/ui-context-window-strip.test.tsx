import { describe, expect, test } from "bun:test";
import { ContextWindowStrip, contextStripKeyIndex } from "../src/ui/context-window-strip.tsx";
import type { ContextWindowTimelineData } from "../src/ui/types.ts";
import { click, press, setupDom } from "./ui-dom.ts";

const dom = setupDom();

const timeline: ContextWindowTimelineData = {
  session_id: 1,
  tool: "claude_code",
  window_tokens: 200_000,
  window_inferred: false,
  peak_tokens: 150_000,
  peak_pct: 0.75,
  turn_count: 4,
  points: Array.from({ length: 40 }, (_, index) => ({
    seq: (index + 1) * 10,
    timestamp: null,
    turn: Math.floor(index / 10) + 1,
    context_tokens: 20_000 + index * 3_000,
    input_tokens: 1_000,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    output_tokens: 100,
  })),
  compactions: [
    { seq: 101, timestamp: null, trigger: "auto", pre_tokens: 150_000, post_tokens: 30_000 },
    { seq: 102, timestamp: null, trigger: "auto", pre_tokens: 40_000, post_tokens: 20_000 },
    { seq: 351, timestamp: null, trigger: "manual", pre_tokens: 120_000, post_tokens: 25_000 },
  ],
};

async function renderStrip() {
  const jumps: number[] = [];
  const { container } = await dom.render(
    <ContextWindowStrip
      onJump={(seq) => void jumps.push(seq)}
      timeline={timeline}
      windowTokens={200_000}
    />,
  );
  return { container, jumps };
}

describe("ContextWindowStrip", () => {
  test("exposes each compaction as a named link to its message", async () => {
    const { container, jumps } = await renderStrip();
    expect(container.querySelector('[role="img"]')).toBeNull();
    const group = container.querySelector('a[aria-label="Compactions 1 through 2"]');
    const single = container.querySelector('a[aria-label^="Compaction 3:"]');
    expect(group?.getAttribute("href")).toBe("#message-101");
    expect(single?.getAttribute("href")).toBe("#message-351");

    await click(single);
    expect(jumps).toEqual([351]);

    await click(group);
    const choice = [...container.querySelectorAll('a[href="#message-102"]')].find((link) =>
      link.textContent?.includes("Compaction 2"),
    );
    await click(choice ?? null);
    expect(jumps).toEqual([351, 102]);
  });

  test("keyboard users can scrub the strip and jump to a call", async () => {
    const { container, jumps } = await renderStrip();
    const strip = container.querySelector("svg");
    expect(strip?.getAttribute("aria-label")).toBe(
      "Context window usage across 40 API calls and 4 turns; peak 75% of 200.0K",
    );
    const scrub = container.querySelector('a[aria-label^="Jump to call"]');
    expect(scrub?.getAttribute("aria-label")).toStartWith("Jump to call 40 of 40");

    await press(scrub, "Home");
    expect(scrub?.getAttribute("aria-label")).toStartWith("Jump to call 1 of 40, turn 1");
    await press(scrub, "ArrowRight");
    expect(scrub?.getAttribute("href")).toBe("#message-20");
    await click(scrub);
    expect(jumps).toEqual([20]);
  });
});

test("contextStripKeyIndex clamps at both ends and ignores other keys", () => {
  expect(contextStripKeyIndex("ArrowRight", null, 4)).toBe(0);
  expect(contextStripKeyIndex("ArrowRight", 2, 4)).toBe(3);
  expect(contextStripKeyIndex("ArrowRight", 3, 4)).toBe(3);
  expect(contextStripKeyIndex("ArrowLeft", null, 4)).toBe(3);
  expect(contextStripKeyIndex("ArrowLeft", 0, 4)).toBe(0);
  expect(contextStripKeyIndex("Home", 2, 4)).toBe(0);
  expect(contextStripKeyIndex("End", 0, 4)).toBe(3);
  expect(contextStripKeyIndex("Enter", 1, 4)).toBeNull();
  expect(contextStripKeyIndex("ArrowRight", null, 0)).toBeNull();
});
