import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useEffect, useState } from "react";
import { ALL_DATE_RANGE } from "../src/ui/date-range.ts";
import { locationPath } from "../src/ui/link.tsx";
import type { DashboardData, McpRow, ToolCallPage, ToolCallRow, ToolRow } from "../src/ui/types.ts";
import { ToolsView } from "../src/ui/views/tools.tsx";
import {
  byText,
  click,
  type FetchStub,
  fire,
  flush,
  type PendingRequest,
  setupDom,
  stubFetch,
} from "./ui-dom.ts";

const dom = setupDom();
let fetchStub: FetchStub;
const answered = new Set<PendingRequest>();

beforeEach(() => {
  window.history.replaceState(null, "", "/tools");
  fetchStub = stubFetch();
});
afterEach(() => {
  fetchStub.restore();
  answered.clear();
});

const RAW_SERVER = "plugin_acme_search-docs";

const mcpRow: McpRow = {
  mcp_server: RAW_SERVER,
  tools: 1,
  calls: 4,
  errors: 0,
  p50_ms: 120,
  p95_ms: 300,
  last_used_at: null,
};
const toolRow: ToolRow = {
  tool_name: "mcp__search__find",
  tool_kind: "mcp",
  mcp_server: RAW_SERVER,
  calls: 4,
  errors: 0,
  p50_ms: 120,
  p95_ms: 300,
  last_used_at: null,
};

function call(patch: Partial<ToolCallRow>): ToolCallRow {
  return {
    id: 1,
    session_id: 7,
    session_title: "Refactor the parser",
    project: null,
    tool_name: "Bash",
    tool_kind: "builtin",
    mcp_server: null,
    input_preview: '{"command":"ls"}',
    input_bytes: 2048,
    output_preview: "ok",
    output_bytes: 4096,
    is_error: false,
    has_result: true,
    duration_ms: 50,
    timestamp: null,
    seq: 3,
    ...patch,
  };
}

function data(): DashboardData {
  return { dateBounds: null, mcp: [mcpRow], tools: [toolRow] } as unknown as DashboardData;
}

function page(calls: ToolCallRow[], offset = 0): ToolCallPage {
  return {
    calls,
    total: calls.length + offset,
    limit: 50,
    offset,
    summary: { calls: 4, errors: 1, p50_ms: 10, p95_ms: 20 },
  };
}

function Routed({ reloadKey }: { reloadKey: number }) {
  const [, setPath] = useState(locationPath);
  useEffect(() => {
    const onPop = () => setPath(locationPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return (
    <ToolsView
      data={data()}
      dateRange={ALL_DATE_RANGE}
      mcpStatus="ready"
      onDateRangeChange={() => {}}
      reloadKey={reloadKey}
      toolsStatus="ready"
    />
  );
}

async function mount(calls: ToolCallRow[] = [call({})], reloadKey = 0, offset = 0) {
  const view = await dom.render(<Routed reloadKey={reloadKey} />);
  await answer(calls, offset);
  return view;
}

async function answer(calls: ToolCallRow[], offset = 0) {
  for (const request of fetchStub.pending) {
    if (!answered.has(request)) {
      answered.add(request);
      request.respond(page(calls, offset));
    }
  }
  await flush();
}

function urls() {
  return fetchStub.pending.map((request) => request.url);
}

async function openDetail(view: HTMLElement, call_: ToolCallRow) {
  const inspect = view.querySelector(`button[aria-label="Inspect ${call_.tool_name} call"]`);
  await click(inspect);
  return document.querySelector('[role="dialog"]') as HTMLElement;
}

describe("ToolsView", () => {
  test("an archive refresh re-requests call rows", async () => {
    const { rerender } = await mount();
    expect(urls().filter((url) => url.includes("limit=50"))).toHaveLength(1);

    await rerender(<Routed reloadKey={1} />);
    await answer([call({})]);
    expect(urls().filter((url) => url.includes("limit=50"))).toHaveLength(2);
  });

  test("an archive refresh on a later page re-requests the summary separately", async () => {
    window.history.replaceState(null, "", "/tools?offset=50");
    const { rerender } = await mount([call({})], 0, 50);
    expect(urls().filter((url) => url.includes("limit=1&"))).toHaveLength(1);

    await rerender(<Routed reloadKey={1} />);
    await answer([call({})], 50);
    expect(urls().filter((url) => url.includes("limit=1&"))).toHaveLength(2);
    expect(urls().filter((url) => url.includes("limit=50"))).toHaveLength(2);
  });

  test("an elided preview says the middle was elided", async () => {
    const elided = "head\n[… 1234 chars omitted …]\ntail";
    const { container } = await mount([call({ input_preview: elided, output_preview: "short" })]);
    const dialog = await openDetail(container, call({}));
    expect(dialog.textContent).toContain("Middle elided, 1,234 characters omitted");
    expect(dialog.querySelectorAll("p")).toHaveLength(1);
  });

  test("statuses show an icon-and-text label and a screen-reader explanation", async () => {
    const calls = [
      call({ id: 1, tool_name: "A", is_error: true }),
      call({ id: 2, tool_name: "B", is_error: null, has_result: false }),
    ];
    const { container } = await mount(calls);
    const rows = [...container.querySelectorAll("tbody tr")].filter((row) =>
      row.querySelector("button[aria-label^=Inspect]"),
    );
    expect(rows[0]?.textContent).toContain("Error");
    expect(rows[0]?.querySelector("svg")).not.toBeNull();
    expect(rows[0]?.querySelector(".sr-only")).toBeNull();
    expect(rows[1]?.textContent).toContain("No result");
    expect(rows[1]?.querySelector(".sr-only")?.textContent).toBe(
      "No result was recorded for this call.",
    );

    const dialog = await openDetail(container, calls[1] as ToolCallRow);
    expect(dialog.textContent).toContain("No result");
    expect(dialog.querySelector(".sr-only")?.textContent).toBe(
      "No result was recorded for this call.",
    );
  });

  test("tool and MCP drilldowns drop stale call filters from the next request", async () => {
    window.history.replaceState(null, "", "/tools?tool=Bash&server=old&errors_only=1&min_ms=100");
    const { container } = await mount();
    expect(urls().at(-1)).toContain("errors_only=true");

    await click(container.querySelector('tr[aria-label="Show calls to tool mcp__search__find"]'));
    await answer([call({})]);
    expect(window.location.search).toBe("?tool=mcp__search__find");
    const toolRequest = urls().at(-1) ?? "";
    expect(toolRequest).toContain("tool=mcp__search__find");
    expect(toolRequest).not.toMatch(/server=|errors_only|min_ms/);

    window.history.replaceState(null, "", "/tools?tool=Bash&errors_only=1&min_ms=100");
    await fire(window, new PopStateEvent("popstate"));
    await answer([call({})]);
    await click(container.querySelector('tr[aria-label^="Show calls from MCP server"]'));
    await answer([call({})]);
    expect(window.location.search).toBe(`?server=${RAW_SERVER}`);
    expect(urls().at(-1)).not.toMatch(/tool=|errors_only|min_ms/);
  });

  test("call details offer sizes and a transcript link, opened from a keyboard-reachable button", async () => {
    const target = call({ input_bytes: 2048, output_bytes: 4096 });
    const { container } = await mount([target]);
    const inspect = container.querySelector('button[aria-label="Inspect Bash call"]');
    expect(inspect).toBeInstanceOf(HTMLButtonElement);
    expect((inspect as HTMLButtonElement).type).toBe("button");
    expect((inspect as HTMLButtonElement).tabIndex).toBeGreaterThanOrEqual(0);

    await click(inspect);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.querySelector("dt")?.textContent).toBe("Status");
    expect(byText(dialog as HTMLElement, "dt", "Input size")?.nextElementSibling?.textContent).toBe(
      "2.0 KB",
    );
    expect(
      byText(dialog as HTMLElement, "dt", "Output size")?.nextElementSibling?.textContent,
    ).toBe("4.0 KB");
    const link = byText(dialog as HTMLElement, "a", /View in transcript/);
    expect(link?.getAttribute("href")).toBe("/sessions/7#message-3");
  });

  test("every table has a colgroup whose column widths fill the table", async () => {
    const { container } = await mount();
    const tables = [...container.querySelectorAll("table")];
    expect(tables).toHaveLength(3);
    for (const table of tables) {
      const widths = [...table.querySelectorAll("colgroup > col")].map((col) =>
        Number.parseFloat((col as HTMLElement).style.width),
      );
      expect(widths.length).toBeGreaterThan(0);
      expect(widths.reduce((sum, width) => sum + width, 0)).toBe(100);
    }
  });

  test("server names are formatted for display while requests and links keep the raw id", async () => {
    const { container } = await mount([call({ mcp_server: RAW_SERVER, tool_name: "find" })]);
    const row = container.querySelector('tr[aria-label^="Show calls from MCP server"]');
    expect(row?.getAttribute("aria-label")).toBe("Show calls from MCP server Search Docs");
    expect(row?.querySelector(`[title="${RAW_SERVER}"]`)?.textContent).toBe("Search Docs");

    await click(row);
    await answer([call({})]);
    expect(window.location.search).toBe(`?server=${RAW_SERVER}`);
    expect(urls().at(-1)).toContain(`server=${RAW_SERVER}`);
    expect(urls().at(-1)).not.toContain("Search+Docs");
    const trigger = container.querySelector('[aria-label="Server"]');
    expect(trigger?.textContent).toBe("Search Docs");
  });
});
