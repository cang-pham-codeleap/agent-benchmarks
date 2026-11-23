import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SLICE_LOADERS } from "../src/ui/data-slices.ts";
import type { Recommendation } from "../src/ui/types.ts";
import { InsightsView } from "../src/ui/views/insights.tsx";
import { byText, click, type FetchStub, flush, press, setupDom, stubFetch } from "./ui-dom.ts";

const dom = setupDom();
let fetchStub: FetchStub;

beforeEach(() => {
  fetchStub = stubFetch();
});
afterEach(() => fetchStub.restore());

function rec(overrides: Partial<Recommendation>): Recommendation {
  return {
    key: "catalog:skills",
    kind: "catalog",
    status: "open",
    category: "Reusable workflows",
    title: "Skills",
    detail: "Package repeatable work as a skill.",
    suggestion: "Write a skill for the release checklist.",
    prompt: "Create a skill for the release checklist.",
    url: "https://example.test/skills",
    link_label: "Skills guide",
    icon: "hero-book-open",
    impact_label: "Setup idea",
    tone: "accent",
    score: 1,
    action: null,
    memory_layer: null,
    promotion_target: null,
    trigger: null,
    evidence: "Seen in the docs.",
    success_metric: null,
    note: null,
    implemented_at: null,
    ...overrides,
  };
}

const hero = rec({
  key: "signal:a",
  kind: "signal",
  category: null,
  title: "Hot file A",
  score: 20,
  url: null,
  detail: "Read often.",
  suggestion: "Hero advice.",
  evidence: "Hero evidence.",
  prompt: null,
});
const second = rec({
  key: "signal:b",
  kind: "signal",
  category: null,
  title: "Hot file B",
  score: 10,
  detail: "Read B.",
  suggestion: "B advice.",
  evidence: "B evidence.",
  prompt: null,
});
const catalog = rec({});

function view(props: Partial<Parameters<typeof InsightsView>[0]> = {}) {
  return dom.render(
    <InsightsView
      loadFailed={false}
      loading={false}
      onMarked={() => {}}
      rows={[hero, second, catalog]}
      settingsInfo={null}
      {...props}
    />,
  );
}

describe("Insights view", () => {
  test("explains how archive evidence becomes future-agent improvements", async () => {
    const { container } = await view();
    const text = container.textContent ?? "";
    expect(text).toContain("Agent Benchmarks finds recurring patterns in your local sessions");
    expect(text).toContain("Detected in your session logs");
    expect(byText(container, "h2", "Patterns worth acting on")).not.toBeNull();
    expect(text).toContain("Not from your session logs");
    expect(byText(container, "h2", "Setup ideas")).not.toBeNull();
    expect(text).toContain("General suggestions that apply to any project.");
    expect(text).not.toContain("Set up for future runs");
  });

  test("uses expandable comparison rows instead of featured catalog cards", async () => {
    const { container } = await view();
    const row = byText(container, "button[aria-expanded]", /Skills/);
    if (row == null) throw new Error("row missing");
    expect(row.textContent).toContain("Setup idea");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Write a skill for the release checklist.");
    await click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Write a skill for the release checklist.");
    await click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Write a skill for the release checklist.");
  });

  test("moves secondary links into an accessible compact overflow menu", async () => {
    const { container } = await view();
    await click(byText(container, "button[aria-expanded]", /Skills/));
    const trigger = container.querySelector('button[aria-label="More actions for Skills"]');
    if (trigger == null) throw new Error("overflow trigger missing");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(document.querySelector('a[href="https://example.test/skills"]')).toBeNull();
    await press(trigger, "Enter");
    await flush();
    const link = document.querySelector('[role="menu"] a[href="https://example.test/skills"]');
    expect(link?.textContent).toContain("Skills guide");
    await press(document.querySelector('[role="menu"]'), "Escape");
    await flush();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  describe("copying the setup prompt", () => {
    let original: typeof document.execCommand;
    beforeEach(() => {
      original = document.execCommand;
    });
    afterEach(() => {
      document.execCommand = original;
    });

    async function copy() {
      const { container } = await view();
      await click(byText(container, "button[aria-expanded]", /Skills/));
      await click(byText(container, "button", "Copy setup prompt"));
      await flush();
      return container;
    }

    test("falls back to execCommand without the clipboard API and announces success", async () => {
      const copied: string[] = [];
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      document.execCommand = (command: string) => {
        copied.push(
          `${command}:${(document.querySelector("textarea") as HTMLTextAreaElement).value}`,
        );
        return true;
      };
      const container = await copy();
      expect(copied).toHaveLength(1);
      expect(copied[0]).toStartWith("copy:Create a skill for the release checklist.");
      const status = container.querySelector('[role="status"]');
      expect(status?.textContent).toBe("Copied the setup prompt for “Skills”.");
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    test("announces an alert when no copy method works", async () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      document.execCommand = () => false;
      const container = await copy();
      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("Could not copy the setup prompt.");
      expect(container.querySelector('[role="status"]')).toBeNull();
    });
  });

  test("shows a skeleton instead of an empty state while recommendations load", async () => {
    const { container } = await view({ loading: true, rows: [] });
    expect(container.querySelector('[aria-label="Loading insights"]')).not.toBeNull();
    expect(container.textContent).not.toContain("No signals yet");
  });

  test("shows no empty state when loading failed", async () => {
    const { container } = await view({ loadFailed: true, rows: [] });
    expect(container.querySelector('[aria-label="Loading insights"]')).toBeNull();
    expect(container.textContent).not.toContain("No signals yet");
  });

  test("shows the empty state once loaded with no signals", async () => {
    const { container } = await view({ rows: [] });
    expect(container.textContent).toContain("No signals yet");
  });
});

describe("recommendations slice", () => {
  test("is archive-wide: every date query fetches the same undated URL", async () => {
    const loader = SLICE_LOADERS.recommendations;
    expect(loader.dateScoped).toBe(false);
    for (const query of ["", "from=2026-01-01&to=2026-01-31", "from=2026-02-01"]) {
      const before = fetchStub.pending.length;
      const loading = loader.load(query);
      await flush();
      const request = fetchStub.pending[before];
      expect(request?.url).toBe("/api/recommendations?status=all");
      request?.respond([]);
      await loading;
    }
  });
});
