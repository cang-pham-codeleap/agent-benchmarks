import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db.ts";
import { upsertSession } from "../src/ingest.ts";
import { parseClaudeSession } from "../src/sources/claude.ts";

const workDir = mkdtempSync(join(tmpdir(), "agent-benchmarks-mcp-test-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const SOURCE_ID = "5b0c7d6e-0000-4000-8000-00000000abcd";
const dbPath = join(workDir, "archive.db");
let sessionId = 0;

function line(type: "user" | "assistant", second: number, text: string): string {
  return JSON.stringify({
    type,
    sessionId: SOURCE_ID,
    timestamp: `2026-08-01T10:00:${String(second).padStart(2, "0")}.000Z`,
    cwd: "/work/demo",
    message: { role: type, content: [{ type: "text", text }] },
  });
}

beforeAll(() => {
  const db = openDb(dbPath);
  try {
    const transcript = [
      line("user", 0, "Investigate the zebrafish regression"),
      line("assistant", 1, "The zebrafish cache was stale."),
    ].join("\n");
    sessionId = upsertSession(
      db,
      parseClaudeSession(SOURCE_ID, transcript),
      "/work/demo/s.jsonl",
      1,
      2,
      "hash-mcp",
    );
  } finally {
    closeDb(db);
  }
});

interface Reply {
  jsonrpc: string;
  id: number | null;
  result?: {
    isError?: boolean;
    content: { text: string }[];
    tools: { name: string }[];
    protocolVersion: string;
  };
  error?: { code: number; message: string };
}

async function serve(
  lines: string[],
  server = "http://127.0.0.1:1",
): Promise<{ replies: Reply[]; code: number }> {
  const home = join(workDir, "home");
  mkdirSync(home, { recursive: true });
  const proc = Bun.spawn(
    ["bun", "run", "src/cli.ts", "--db", dbPath, "mcp", "serve", "--server", server],
    {
      cwd: join(import.meta.dir, ".."),
      stdin: new Blob([`${lines.join("\n")}\n`]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: home,
        AGENT_BENCHMARKS_NO_SYNC: "1",
        CLAUDE_CONFIG_DIR: join(home, "claude"),
        CODEX_HOME: join(home, "codex"),
      },
    },
  );
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const replies = out
    .split("\n")
    .filter((text) => text !== "")
    .map((text) => JSON.parse(text) as Reply);
  return { replies, code };
}

const textOf = (result: Reply["result"]): string => result?.content[0]?.text ?? "";

const request = (id: number, method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params });

const callTool = (id: number, name: string, args: unknown): string =>
  request(id, "tools/call", { name, arguments: args });

describe("mcp serve", () => {
  test("handshake, tool list, and silence for notifications", async () => {
    const { replies, code } = await serve([
      request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {} }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      request(2, "tools/list"),
      request(3, "initialize", { protocolVersion: "1999-01-01" }),
      request(4, "bogus/method"),
    ]);
    expect(code).toBe(0);
    expect(replies.map((reply) => reply.id)).toEqual([1, 2, 3, 4]);
    expect(replies[0]?.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "agent-benchmarks" },
    });
    const names = replies[1]?.result?.tools.map((tool) => tool.name) ?? [];
    expect(names.slice(0, 4)).toEqual([
      "search_sessions",
      "list_sessions",
      "show_session",
      "usage_stats",
    ]);
    expect(names).toContain("start_evaluation_run");
    expect(names).toContain("inspect_evaluation_repository");
    expect(names).not.toContain("stream_events");
    expect(new Set(names).size).toBe(names.length);
    expect(replies[2]?.result?.protocolVersion).toBe("2025-11-25");
    expect(replies[3]?.error?.code).toBe(-32601);
  });

  test("answers an unparseable line with -32700 and keeps serving", async () => {
    const { replies } = await serve(["{not json", request(1, "ping")]);
    expect(replies[0]).toMatchObject({ id: null, error: { code: -32700 } });
    expect(replies[1]).toMatchObject({ id: 1, result: {} });
  });

  test("tools return archive data", async () => {
    const { replies } = await serve([
      callTool(1, "search_sessions", { query: "zebrafish", limit: 5 }),
      callTool(2, "show_session", { id: String(sessionId), outline: true }),
      callTool(3, "list_sessions", { tool: "claude_code" }),
      callTool(4, "usage_stats", {}),
    ]);
    const [search, show, list, stats] = replies.map((reply) => reply.result);
    expect(search?.isError).toBe(false);
    expect(JSON.parse(textOf(search))[0].snippet).toContain("zebrafish");
    expect(show?.isError).toBe(false);
    expect(textOf(show)).toContain("Investigate the zebrafish regression");
    expect(JSON.parse(textOf(list))).toHaveLength(1);
    expect(JSON.parse(textOf(stats)).sessions).toBe(1);
  });

  test("CLI validation failures come back as isError with the JSON error", async () => {
    const { replies } = await serve([
      callTool(1, "list_sessions", { limit: "x" }),
      callTool(2, "show_session", { id: "999999" }),
    ]);
    for (const reply of replies) {
      expect(reply.result?.isError).toBe(true);
      expect(JSON.parse(textOf(reply.result)).error).toBeDefined();
    }
  });

  test("a query starting with a dash is a query, not a flag", async () => {
    const { replies } = await serve([callTool(1, "search_sessions", { query: "--zebrafish" })]);
    const text = textOf(replies[0]?.result);
    expect(replies[0]?.result?.isError).toBe(false);
    expect(JSON.parse(text)[0].session_title).toContain("zebrafish");
  });

  test("arguments a tool does not declare never reach the CLI as flags", async () => {
    const { replies } = await serve([
      callTool(1, "search_sessions", { query: "zebrafish", db: join(workDir, "missing.db") }),
    ]);
    expect(replies[0]?.result?.isError).toBe(false);
    expect(JSON.parse(textOf(replies[0]?.result))[0].snippet).toContain("zebrafish");
  });

  test("unknown tools and non-object arguments are -32602", async () => {
    const { replies } = await serve([
      callTool(1, "rm_session", {}),
      callTool(2, "usage_stats", [1]),
    ]);
    expect(replies.map((reply) => reply.error?.code)).toEqual([-32602, -32602]);
  });

  test("API tools call the running server and pass its answer through", async () => {
    const seen: { method: string; url: string; body: string }[] = [];
    const fake = Bun.serve({
      port: 0,
      async fetch(request) {
        seen.push({ method: request.method, url: request.url, body: await request.text() });
        return request.method === "POST"
          ? Response.json(
              { error: "branch main already exists", code: "invalid_request" },
              { status: 400 },
            )
          : Response.json({ ok: true });
      },
    });
    try {
      const base = `http://127.0.0.1:${fake.port}`;
      const { replies } = await serve(
        [
          callTool(1, "get_evaluation_cell_artifacts", { id: "run-1", cellId: "current/a:b" }),
          callTool(2, "inspect_evaluation_repository", { path: "/repo", sha: "abc" }),
          callTool(3, "start_evaluation_run", { body: { kind: "real" } }),
        ],
        base,
      );
      expect(seen).toEqual([
        { method: "GET", url: `${base}/api/evals/run-1/cells/current%2Fa%3Ab`, body: "" },
        { method: "GET", url: `${base}/api/evals/repo?path=%2Frepo&sha=abc`, body: "" },
        { method: "POST", url: `${base}/api/evals`, body: '{"kind":"real"}' },
      ]);
      expect(replies.map((reply) => reply.result?.isError)).toEqual([false, false, true]);
      expect(JSON.parse(textOf(replies[2]?.result)).code).toBe("invalid_request");
    } finally {
      fake.stop(true);
    }
  });

  test("API tools explain how to start the server when it is not running", async () => {
    const { replies } = await serve([callTool(1, "get_evaluation_catalog", {})]);
    expect(replies[0]?.result?.isError).toBe(true);
    expect(JSON.parse(textOf(replies[0]?.result)).code).toBe("server_unreachable");
  });
});
