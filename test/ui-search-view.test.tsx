import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useEffect, useState } from "react";
import { ALL_DATE_RANGE } from "../src/ui/date-range.ts";
import { locationPath } from "../src/ui/link.tsx";
import type { DateRangeSelection, SearchHit } from "../src/ui/types.ts";
import { SearchView } from "../src/ui/views/search.tsx";
import { click, type FetchStub, flush, press, setupDom, stubFetch, type } from "./ui-dom.ts";

const dom = setupDom();
let fetchStub: FetchStub;

beforeEach(() => {
  window.history.replaceState(null, "", "/search");
  fetchStub = stubFetch();
});
afterEach(() => fetchStub.restore());

function RoutedSearch({ dateRange = ALL_DATE_RANGE }: { dateRange?: DateRangeSelection }) {
  const [path, setPath] = useState(locationPath);
  useEffect(() => {
    const onPop = () => setPath(locationPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return <SearchView dateRange={dateRange} path={path} />;
}

function hits(query: string, count: number, offset = 0): SearchHit[] {
  return Array.from({ length: count }, (_, index) => ({
    block_id: offset + index + 1,
    block_type: "text",
    href: `/sessions/${query}#message-${offset + index}`,
    message_seq: offset + index,
    project: "/work/demo",
    role: "user",
    session_id: 1,
    session_title: `${query} session`,
    snippet: `${query} hit ${offset + index}`,
    timestamp: "2026-11-01T00:00:00Z",
    tool: "codex",
  }));
}

function page(results: SearchHit[], total: number | null = null) {
  return { elapsed_ms: 3, results, total, total_is_capped: false };
}

function request(includeTotal: boolean, query: string) {
  const match = fetchStub.pending.findLast(
    (entry) =>
      (entry.body as { include_total: boolean; query: string }).include_total === includeTotal &&
      (entry.body as { query: string }).query === query,
  );
  if (match == null) throw new Error(`no ${includeTotal ? "total" : "page"} request for ${query}`);
  return match;
}

async function search(view: HTMLElement, query: string) {
  await type(view.querySelector('[role="combobox"]'), query);
  await flush(200);
}

function snippets(view: HTMLElement) {
  return [...view.querySelectorAll('[role="option"]')].map((option) =>
    option.textContent?.replace(/.*message \d+/, ""),
  );
}

function button(view: HTMLElement, label: RegExp) {
  return [...view.querySelectorAll("button")].find((node) => label.test(node.textContent ?? ""));
}

describe("SearchView", () => {
  test("aborts and ignores a load-more response that lands after the query changed", async () => {
    const { container } = await dom.render(<RoutedSearch />);
    await search(container, "alpha");
    await request(false, "alpha").respond(page(hits("alpha", 25)));
    await flush();

    await click(button(container, /Load more/) ?? null);
    const loadMore = fetchStub.pending.at(-1);
    expect(loadMore?.body).toMatchObject({ offset: 25 });

    await search(container, "beta");
    request(false, "beta").respond(page(hits("beta", 1)));
    loadMore?.respond(page(hits("alpha", 25, 25)));
    await flush();

    expect(snippets(container)).toEqual(["beta hit 0"]);
    expect(loadMore?.signal?.aborted).toBe(true);
  });

  test("Enter never opens a result from the previous query while the next one loads", async () => {
    const { container } = await dom.render(<RoutedSearch />);
    const input = container.querySelector('[role="combobox"]');
    await search(container, "alpha");
    request(false, "alpha").respond(page(hits("alpha", 2)));
    await flush();

    expect(input?.getAttribute("aria-controls")).toBe("search-results-listbox");
    expect(input?.getAttribute("aria-activedescendant")).toBe("search-hit-1");
    await press(input, "ArrowDown");
    expect(input?.getAttribute("aria-activedescendant")).toBe("search-hit-2");
    const options = container.querySelectorAll('#search-results-listbox [role="option"]');
    expect([...options].map((option) => option.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
    ]);

    await type(input, "alphabet");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    await press(input, "Enter");
    expect(window.location.pathname).toBe("/search");

    await flush(200);
    request(false, "alphabet").respond(page(hits("alphabet", 1)));
    await flush();
    await press(input, "Enter");
    expect(window.location.pathname).toBe("/sessions/alphabet");
  });

  test("a scoped fast page settles its total later without replacing results, and a failed total stays silent", async () => {
    window.history.replaceState(null, "", "/search?tool=codex");
    const october = { preset: "custom", from: "2026-10-01", to: "2026-10-31" } as const;
    const scope = { tool: "codex", from: "2026-10-01", to: "2026-10-31" };
    const { container } = await dom.render(<RoutedSearch dateRange={october} />);
    await search(container, "alpha");
    const fast = request(false, "alpha");
    expect(fast.body).toMatchObject({ ...scope, include_total: false, limit: 25, offset: 0 });
    fast.respond(page(hits("alpha", 25), 999));
    await flush();
    expect(container.textContent).toContain("Showing 25 matches");
    expect(button(container, /Load more/)?.textContent).toBe("Load more");

    await flush(400);
    expect(request(true, "alpha").body).toMatchObject(scope);
    request(true, "alpha").respond(page(hits("other", 1), 40));
    await flush();
    expect(container.textContent).toContain("40 results");
    expect(snippets(container)).toHaveLength(25);
    expect(snippets(container)[0]).toBe("alpha hit 0");
    expect(button(container, /Load more/)?.textContent).toBe("Load more · 15 remaining");

    await search(container, "gamma");
    request(false, "gamma").respond(page(hits("gamma", 3)));
    await flush(400);
    request(true, "gamma").respond({ error: "boom", code: "internal_error" }, 500);
    await flush();
    expect(snippets(container)).toHaveLength(3);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Retry");
  });
});
