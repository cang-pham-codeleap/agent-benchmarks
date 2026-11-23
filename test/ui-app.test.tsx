import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import {
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  DEFAULT_TEXT_WIDTH_MAP,
} from "zrender/lib/core/platform.js";
import type { Config } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { upsertSession } from "../src/ingest.ts";
import { UI_ROUTE_PATHS } from "../src/route-paths.ts";
import { handleRequest } from "../src/server.ts";
import { parseClaudeSession } from "../src/sources/claude.ts";
import { visit } from "../src/ui/link.tsx";
import { byText, click, fire, flush, installDom, press } from "./ui-dom.ts";

installDom();

const workDir = mkdtempSync(join(tmpdir(), "agent-benchmarks-ui-app-"));
const config: Config = {
  dbPath: join(workDir, "archive.db"),
  claudeDir: join(workDir, "claude"),
  codexDir: join(workDir, "codex"),
  geminiDir: join(workDir, "gemini"),
  opencodeDir: join(workDir, "opencode"),
  cursorDir: join(workDir, "cursor"),
  copilotDir: join(workDir, "copilot"),
  vscodeCopilotDir: join(workDir, "vscode"),
};
const requests: URL[] = [];
const failing: string[] = [];
const overrides = new Map<string, (body: unknown) => unknown>();
const sessionIds = new Map<string, number>();

const secondCompaction = [
  {
    type: "system",
    uuid: "s2",
    parentUuid: "s1",
    sessionId: "sess-claude-enr",
    timestamp: "2026-05-03T10:20:00.000Z",
    cwd: "/Users/dev/proj",
    subtype: "compact_boundary",
    content: "Conversation compacted",
    isCompactSummary: false,
  },
  {
    type: "user",
    uuid: "u6",
    parentUuid: "s2",
    sessionId: "sess-claude-enr",
    timestamp: "2026-05-03T10:21:00.000Z",
    cwd: "/Users/dev/proj",
    message: { role: "user", content: "Continue the refactor" },
  },
]
  .map((line) => JSON.stringify(line))
  .join("\n");

function seedArchive() {
  mkdirSync(config.claudeDir, { recursive: true });
  const db = openDb(config.dbPath);
  for (const [id, file] of [
    ["sess-claude-1", "sample.jsonl"],
    ["sess-mcp-1", "mcp.jsonl"],
    ["sess-claude-enr", "enriched.jsonl"],
    ["sess-claude-distill", "distill.jsonl"],
  ] as const) {
    const fixture = readFileSync(join(import.meta.dir, "..", "fixtures", "claude", file), "utf8");
    const content =
      id === "sess-claude-enr" ? `${fixture.trimEnd()}\n${secondCompaction}\n` : fixture;
    upsertSession(db, parseClaudeSession(id, content), `/x/${file}`, 1, 2, id);
  }
  db.exec(`INSERT INTO session_user_state(tool, source_session_id, state, updated_at)
           VALUES ('claude_code', 'sess-claude-distill', 'archived', datetime('now'))`);
  for (const row of db
    .query<{ id: number; source_session_id: string }, []>(
      "SELECT id, source_session_id FROM session",
    )
    .all()) {
    sessionIds.set(row.source_session_id, row.id);
  }
  db.close();
}

class SilentEventSource extends EventTarget {
  static readonly OPEN = 1;
  readyState = 0;
  close() {}
}

const { fetch: realFetch, EventSource: realEventSource } = globalThis;
let restoreCanvas = () => {};

beforeAll(async () => {
  seedArchive();
  // happy-dom has no canvas backend; ECharts draws into a context that accepts every call.
  // zrender caches the first context it measures text with for the whole process, so measureText
  // must return zrender's own no-canvas estimate or later report SVGs change.
  const values = new Map<PropertyKey, unknown>([["measureText", estimateTextWidth]]);
  const context = new Proxy(
    {},
    {
      get: (_, key) => (values.has(key) ? values.get(key) : () => ({ width: 0 })),
      set: (_, key, value) => values.set(key, value) !== undefined,
    },
  );
  function estimateTextWidth(text: string) {
    const font = String(values.get("font") ?? DEFAULT_FONT);
    const size = Number(/((?:\d+)?\.?\d*)px/.exec(font)?.[1]) || DEFAULT_FONT_SIZE;
    const width = font.includes("mono")
      ? size * text.length
      : [...text].reduce((sum, char) => sum + (DEFAULT_TEXT_WIDTH_MAP[char] ?? 1) * size, 0);
    return { width };
  }
  const canvas = HTMLCanvasElement.prototype;
  const getContext = canvas.getContext;
  canvas.getContext = (() => context) as unknown as typeof canvas.getContext;
  restoreCanvas = () => {
    canvas.getContext = getContext;
  };
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://127.0.0.1:3000");
      requests.push(url);
      if (url.pathname === "/api/sync") {
        return Response.json({ ok: true });
      }
      if (failing.some((part) => `${url.pathname}${url.search}`.includes(part))) {
        return Response.json({ error: "boom", code: "internal_error" }, { status: 500 });
      }
      const headers = new Headers(init.headers);
      headers.set("origin", "http://127.0.0.1:3000");
      const response = await handleRequest(new Request(url, { ...init, headers }), config);
      const override = overrides.get(url.pathname);
      return override == null ? response : Response.json(override(await response.json()));
    },
    { preconnect: () => {} },
  );
  Object.assign(globalThis, { EventSource: SilentEventSource });
  window.history.replaceState(null, "", "/analytics");
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/ui/main.tsx");
  });
  await flush(100);
});
afterAll(() => {
  restoreCanvas();
  Object.assign(globalThis, { fetch: realFetch, EventSource: realEventSource });
  rmSync(workDir, { recursive: true, force: true });
});

async function go(href: string) {
  requests.length = 0;
  await act(async () => visit(href));
  await flush(100);
}

function requested(pathname: string) {
  return requests.filter((url) => url.pathname === pathname);
}

async function chooseRange(label: string) {
  await click(document.querySelector('button[aria-label^="Time range:"]'));
  requests.length = 0;
  await click(byText(document, "button", label));
  await flush(100);
}

function sessionRows() {
  return [...document.querySelectorAll("tbody tr")].map((row) => row.textContent ?? "");
}

describe("App on a seeded archive", () => {
  test("archived sessions stay hidden until Show archived, and a reload keeps that scope", async () => {
    await go("/sessions");
    expect(sessionRows()).toHaveLength(3);
    expect(sessionRows().join()).not.toContain("Archived");

    const showArchived = byText(document, "label", "Show archived")?.querySelector(
      '[role="checkbox"]',
    );
    await click(showArchived ?? null);
    await flush(100);
    expect(window.location.search).toContain("include_archived=true");
    expect(requested("/api/sessions").at(-1)?.searchParams.get("include_archived")).toBe("true");
    expect(sessionRows()).toHaveLength(4);
    expect(sessionRows().filter((row) => row.includes("Archived"))).toHaveLength(1);

    requests.length = 0;
    await click(document.querySelector("[data-sync-label]")?.closest("button") ?? null);
    await flush(300);
    const reloaded = requested("/api/sessions");
    expect(reloaded.length).toBeGreaterThan(0);
    expect(reloaded.every((url) => url.searchParams.get("include_archived") === "true")).toBe(true);
    expect(sessionRows()).toHaveLength(4);
  });

  test("the shell session count stays archive-wide while the sessions list is scoped", async () => {
    await go("/sessions?project=%2Fnowhere&include_archived=true");
    await chooseRange("Last 30 days");
    await chooseRange("All time");
    expect(sessionRows().join()).not.toContain("Claude");
    const shellCount = document.querySelector('[title^="Top-level sessions"] strong');
    expect(shellCount?.textContent).toBe("3");
  });

  test("every date-scoped view has exactly one date range control", async () => {
    for (const view of ["/sessions", "/analytics", "/tools", "/files"]) {
      await go(view);
      expect(document.querySelectorAll('button[aria-label^="Time range:"]')).toHaveLength(1);
    }
  });
});

afterEach(() => {
  failing.length = 0;
  overrides.clear();
});

function alertWith(text: string) {
  return byText(document, '[role="alert"]', new RegExp(text));
}

async function openMenu(trigger: Element | null) {
  await press(trigger, "Enter");
  await flush(20);
}

async function syncNow() {
  await click(document.querySelector("[data-sync-label]")?.closest("button") ?? null);
  await flush(300);
}

describe("App recovery", () => {
  test("a failed slice is named over the data that did load, and Retry clears it", async () => {
    await go("/analytics");
    failing.push("/api/stats/by-dimension?dim=model");
    await syncNow();
    const banner = alertWith("Some dashboard data could not be loaded");
    expect(banner?.textContent).toContain("Failed: byModel.");
    expect(document.querySelector("main")?.textContent).toContain(
      "Usage and cost across your sessions.",
    );
    expect(document.querySelector('[title^="Top-level sessions"] strong')?.textContent).toBe("3");

    failing.length = 0;
    await click(byText(banner ?? document, "button", "Retry"));
    await flush(100);
    expect(alertWith("Some dashboard data could not be loaded")).toBeNull();
  });

  test("a failed session-list refresh keeps the shown sessions and offers Retry", async () => {
    await go("/sessions");
    expect(sessionRows()).toHaveLength(3);
    failing.push("/api/sessions?");
    await syncNow();
    const notice = alertWith("The session list could not be refreshed");
    expect(notice).not.toBeNull();
    expect(sessionRows()).toHaveLength(3);

    failing.length = 0;
    await click(byText(notice ?? document, "button", "Retry"));
    await flush(100);
    expect(alertWith("The session list could not be refreshed")).toBeNull();
  });

  test("a failed Files request offers Retry, which reloads the files", async () => {
    failing.push("/api/files");
    await go("/files");
    const failure = alertWith("could not complete the request");
    expect(failure).not.toBeNull();

    failing.length = 0;
    requests.length = 0;
    await click(byText(document, "button", "Retry"));
    await flush(100);
    expect(requested("/api/files")).toHaveLength(1);
    expect(alertWith("could not complete the request")).toBeNull();
  });

  test("an empty Projects list offers Sync now", async () => {
    overrides.set("/api/projects", () => []);
    await go("/projects");
    await syncNow();
    requests.length = 0;
    await click(byText(document.querySelector("main") ?? document, "button", /Sync now/));
    await flush(100);
    expect(requested("/api/sync")).toHaveLength(1);
  });

  test("an Analytics range with no data offers All time", async () => {
    await go("/analytics");
    await chooseRange("Today");
    const empty = byText(document, "h3", "No data in range")?.parentElement?.parentElement ?? null;
    expect(empty).not.toBeNull();
    await click(byText(empty ?? document, "button", "All time"));
    await flush(100);
    expect(byText(document, "h3", "No data in range")).toBeNull();
    expect(
      document.querySelector('button[aria-label^="Time range:"]')?.getAttribute("aria-label"),
    ).toBe("Time range: All time");
  });
});

describe("App shell", () => {
  test("the command palette opens from both header buttons and both shortcuts", async () => {
    await go("/sessions");
    const palette = () =>
      document.querySelector('input[aria-label="Search sessions and commands"]');
    const openers: Array<() => Promise<void>> = [
      () => click(document.querySelector('button[aria-label="Open command palette"]')),
      () => click(document.querySelector('button[aria-label="Search"]')),
      () =>
        fire(
          document.body,
          new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
        ),
      () => fire(document.body, new KeyboardEvent("keydown", { key: "/", bubbles: true })),
    ];
    for (const open of openers) {
      expect(palette()).toBeNull();
      await open();
      await flush(20);
      expect(palette()).not.toBeNull();
      await press(palette(), "Escape");
      await flush(20);
    }
  });

  test("the theme menu applies and remembers a choice, and System follows the OS again", async () => {
    await go("/sessions");
    const choose = async (label: string) => {
      await openMenu(document.querySelector('button[aria-label="Choose theme"]'));
      await click(byText(document, '[role="menuitemradio"]', label));
      await flush(20);
    };
    await choose("Dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("agent-benchmarks-theme")).toBe("dark");
    await choose("Light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("agent-benchmarks-theme")).toBe("light");
    await choose("Dark");
    await choose("System");
    expect(localStorage.getItem("agent-benchmarks-theme")).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.classList.contains("dark")).toBe(
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  });
});

describe("Analytics source scope", () => {
  test("one source choice scopes every Analytics request and both report links", async () => {
    await go("/analytics");
    await openMenu(document.querySelector('button[aria-label="Source"]'));
    requests.length = 0;
    await press(byText(document, '[role="option"]', "Claude Code"), "Enter");
    await flush(200);

    const scoped = requests.map((url) => {
      const params = new URLSearchParams(url.search);
      const source = params.get("source");
      params.delete("source");
      return { request: `${url.pathname}?${params}`, source };
    });
    expect(scoped.map(({ request }) => request).sort()).toEqual([
      "/api/analytics/activity?",
      "/api/analytics/model-sparklines?",
      "/api/analytics/token-economics?",
      "/api/stats/by-dimension?dim=day",
      "/api/stats/by-dimension?dim=model",
      "/api/stats/by-dimension?dim=outcome",
      "/api/stats/by-dimension?dim=repo",
      "/api/stats/summary?",
    ]);
    expect(scoped.every(({ source }) => source === "claude_code")).toBe(true);

    await click(byText(document, "button", "View report"));
    const review = document.querySelector('[role="dialog"]');
    const links = [...(review?.querySelectorAll("a") ?? [])].map(
      (link) => link.getAttribute("href") ?? "",
    );
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(
      links.every((href) => new URL(href, "http://x").searchParams.get("source") === "claude_code"),
    ).toBe(true);
    await press(review, "Escape");
    await flush(20);
  });
});

describe("Session detail", () => {
  const enriched = () => sessionIds.get("sess-claude-enr");
  const diagnostics = () => document.querySelector('button[aria-label$="ingest diagnostics"]');
  const withSummary = (fields: Record<string, number>) => (body: unknown) => {
    const detail = body as { summary: Record<string, unknown> };
    return { ...detail, summary: { ...detail.summary, ...fields } };
  };

  test("only actionable dropped lines show the ingest badge, and a failed diagnostics load retries", async () => {
    overrides.set(
      `/api/sessions/${enriched()}`,
      withSummary({ ingest_issue_count: 0, informational_ingest_issue_count: 3 }),
    );
    await go(`/sessions/${enriched()}`);
    expect(diagnostics()).toBeNull();

    overrides.set(
      `/api/sessions/${enriched()}`,
      withSummary({ ingest_issue_count: 2, informational_ingest_issue_count: 0 }),
    );
    await go("/sessions");
    await go(`/sessions/${enriched()}`);
    failing.push(`/api/sessions/${enriched()}/issues`);
    await click(diagnostics());
    await flush(50);
    expect(byText(document, "button", /Re-sync/)).not.toBeNull();
    failing.length = 0;
    requests.length = 0;
    await click(byText(document, "button", "Retry"));
    await flush(50);
    expect(requested(`/api/sessions/${enriched()}/issues`)).toHaveLength(1);
  });

  test("the strip and the thread give each compaction the same number and anchor", async () => {
    await go(`/sessions/${enriched()}`);
    const stripLinks = [...document.querySelectorAll('a[href^="#message-"]')].filter((link) =>
      /^Compaction/.test(link.getAttribute("aria-label") ?? ""),
    );
    expect(
      stripLinks.map((link) => [link.getAttribute("href"), link.getAttribute("aria-label")]),
    ).toEqual([["#message-7", "Compactions 1 through 2"]]);
    const thread = (seq: number) => document.getElementById(`message-${seq}`)?.textContent ?? "";
    expect(thread(7)).toStartWith("Compaction 1");
    expect(thread(10)).toStartWith("Compaction 2");
  });

  test("the More actions menu archives, unarchives, and asks before deleting", async () => {
    await go(`/sessions/${enriched()}`);
    const menuItem = async (label: string) => {
      await openMenu(document.querySelector('button[aria-label^="More actions for"]'));
      return byText(document, '[role="menuitem"]', label);
    };
    const stateRequests = () =>
      requests.filter((url) => url.pathname === `/api/sessions/${enriched()}/state`);

    requests.length = 0;
    await click(await menuItem("Archive session"));
    await flush(100);
    expect(stateRequests()).toHaveLength(1);
    await click(await menuItem("Unarchive session"));
    await flush(100);
    expect(stateRequests()).toHaveLength(2);
    expect(await menuItem("Archive session")).not.toBeNull();

    await click(byText(document, '[role="menuitem"]', "Delete session"));
    await flush(50);
    const confirm = document.querySelector('[role="alertdialog"]');
    expect(confirm?.textContent).toContain("Delete session?");
    expect(stateRequests()).toHaveLength(2);
    await click(byText(confirm ?? document, "button", "Cancel"));
    await flush(20);
  });
});

describe("Report preview routes", () => {
  const sandbox = "allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox";

  test("both report routes render the report in a script-free sandbox under a review-first toolbar", async () => {
    const id = sessionIds.get("sess-claude-enr");
    for (const [href, route, title, source] of [
      [
        "/reports/analytics?source=claude_code",
        "/reports/analytics",
        "Analytics report",
        "/api/reports/analytics.html?source=claude_code",
      ],
      [
        `/reports/session/${id}`,
        "/reports/session/{id}",
        "Session report",
        `/api/reports/session/${id}.html`,
      ],
    ] as const) {
      expect(UI_ROUTE_PATHS).toContain(route);
      await go(href);
      expect(requests.map((url) => `${url.pathname}${url.search}`)).toContain(source);
      const frame = document.querySelector("iframe");
      expect(frame?.getAttribute("title")).toBe(`${title} preview`);
      expect(frame?.getAttribute("sandbox")).toBe(sandbox);
      expect(frame?.getAttribute("srcdoc")).toContain("<html");

      await click(byText(document, "button", "Download HTML"));
      const review = document.querySelector('[role="dialog"]');
      expect(byText(review ?? document, "a", "Download HTML")?.getAttribute("href")).toBe(source);
      if (title === "Session report") {
        expect(review?.textContent).toContain("first user-prompt preview (up to 180 characters)");
        expect(review?.textContent).toContain(
          "Transcript messages beyond the disclosed prompt preview",
        );
      }
      await click(byText(review ?? document, "button", "Close"));
      await flush(20);
    }
  });
});
