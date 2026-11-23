import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { upsertSession } from "../src/ingest.ts";
import { API_ROUTE_PATHS } from "../src/route-paths.ts";
import { serve } from "../src/server.ts";
import { parseClaudeSession } from "../src/sources/claude.ts";

const root = mkdtempSync(join(tmpdir(), "agent-benchmarks-route-responses-"));
const priorConfigDir = process.env.AGENT_BENCHMARKS_CONFIG_DIR;
process.env.AGENT_BENCHMARKS_CONFIG_DIR = join(root, "config");
let server: ReturnType<typeof serve>;
let sessionId = 0;
let dbPath = "";

beforeAll(() => {
  const dirs = ["claude", "codex", "gemini", "opencode"].map((name) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  });
  const config: Config = {
    dbPath: join(root, "archive.db"),
    claudeDir: dirs[0] as string,
    codexDir: dirs[1] as string,
    geminiDir: dirs[2] as string,
    opencodeDir: dirs[3] as string,
    cursorDir: join(root, "cursor"),
    copilotDir: join(root, "copilot"),
    vscodeCopilotDir: join(root, "vscode"),
  };
  dbPath = config.dbPath;
  const db = openDb(config.dbPath);
  sessionId = upsertSession(
    db,
    parseClaudeSession(
      "route-responses",
      readFileSync(join(import.meta.dir, "..", "fixtures", "claude", "sample.jsonl"), "utf8"),
    ),
    "/synthetic/claude.jsonl",
    1,
    2,
    "route-responses",
  );
  db.close();
  server = serve({ config, hostname: "127.0.0.1", port: 0 });
});

afterAll(() => {
  server.stop(true);
  if (priorConfigDir == null) delete process.env.AGENT_BENCHMARKS_CONFIG_DIR;
  else process.env.AGENT_BENCHMARKS_CONFIG_DIR = priorConfigDir;
  rmSync(root, { recursive: true, force: true });
});

interface Probe {
  label: string;
  path: string;
  init: RequestInit;
}

function probes(): Probe[] {
  const result: Probe[] = [];
  for (const template of API_ROUTE_PATHS) {
    const path = template.replace("{id}", String(sessionId)).replace("{cellId}", "missing");
    const badId = template.replace("{id}", "not-an-id").replace("{cellId}", "missing");
    result.push({ label: `GET ${template}`, path, init: { method: "GET" } });
    result.push({ label: `GET ${template} (bad id)`, path: badId, init: { method: "GET" } });
    result.push({
      label: `POST ${template} (wrong media type)`,
      path,
      init: { method: "POST", headers: { "content-type": "text/plain" }, body: "x" },
    });
    result.push({
      label: `POST ${template} (malformed JSON)`,
      path,
      init: { method: "POST", headers: { "content-type": "application/json" }, body: "{" },
    });
  }
  result.push({ label: "GET unknown route", path: "/api/does-not-exist", init: { method: "GET" } });
  result.push({ label: "DELETE known route", path: "/api/health", init: { method: "DELETE" } });
  return result;
}

async function walk(leak: RegExp): Promise<{ failures: string[]; statuses: number[] }> {
  const failures: string[] = [];
  const statuses: number[] = [];
  for (const { label, path, init } of probes()) {
    const abort = new AbortController();
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
      ...init,
      signal: abort.signal,
    });
    statuses.push(response.status);
    if (response.headers.get("x-content-type-options") !== "nosniff") {
      failures.push(`${label}: missing x-content-type-options: nosniff (${response.status})`);
    }
    if (response.ok) {
      abort.abort();
      continue;
    }
    const body = await response.text();
    if (body.includes(root) || leak.test(body)) {
      failures.push(`${label}: error body leaks internals: ${body.slice(0, 200)}`);
    }
  }
  return { failures, statuses };
}

const STACK_OR_PATH = /\n\s+at |\.tsx?:\d+|node_modules/;

describe("every API route answers through the guarded response helper", () => {
  test("sends nosniff on every response and leaks no internals in error bodies", async () => {
    expect((await walk(STACK_OR_PATH)).failures).toEqual([]);
  }, 60_000);

  test("keeps database error text out of 500 bodies", async () => {
    const db = new Database(dbPath);
    db.run("DROP TABLE session");
    db.close();
    const { failures, statuses } = await walk(/no such table|SQLITE/i);
    expect(statuses).toContain(500);
    expect(failures).toEqual([]);
  }, 60_000);
});
