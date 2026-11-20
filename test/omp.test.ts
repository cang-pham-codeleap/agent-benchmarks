import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db.ts";
import { sync } from "../src/ingest.ts";
import { parseOmpSession } from "../src/sources/omp.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "decant-omp-test-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const sample = readFileSync(join(import.meta.dir, "..", "fixtures", "omp", "sample.jsonl"), "utf8");

test("OMP keeps side-call usage and latest title without unknown diagnostics", () => {
  const parsed = parseOmpSession("root-id", sample, "/tmp/sessions/project/root.jsonl");
  expect(parsed.session).toMatchObject({ tool: "omp", title: "Latest title", totals: { input: 15, output: 3, cacheRead: 5, cacheCreation: 5 } });
  const switched = [
    { type: "model_change", model: "OpenAI/gpt-5.4" },
    { type: "message", message: { role: "assistant", model: "gpt-5.4", content: [], usage: { input: 1, output: 2 } } },
    { type: "model_usage", model: "gpt-5.4", usage: { input: 1, output: 1 } },
  ].map((entry) => JSON.stringify(entry)).join("\n");
  const switchedSession = parseOmpSession("switched", switched, "/tmp/sessions/project/root.jsonl").session;
  expect([parsed.session, switchedSession]).toMatchObject([
    { provider: "openai" },
    { model: "gpt-5.4", provider: "openai", messages: [
      { model: "gpt-5.4", provider: "openai" },
      { model: "gpt-5.4", provider: "openai" },
    ] },
  ]);
  expect(parsed.session.messages.find((m) => m.model === "helper-model")?.usage?.input).toBe(5);
  expect(parsed.issues.filter((issue) => issue.code === "unknown_record_type")).toEqual([]);
});

test("OMP advisor without a parent header uses its containing session directory", () => {
  const path = "/tmp/sessions/project/2026-01-01T00-00-00Z_root-id/__advisor.jsonl";
  const parsed = parseOmpSession("advisor-id", sample, path);
  expect(parsed.session).toMatchObject({ isSubagent: true, agentId: "__advisor", agentType: "advisor", rawMeta: { parentSessionPath: "/tmp/sessions/project/2026-01-01T00-00-00Z_root-id.jsonl" } });
});
test("OMP recognizes older named advisor files and nested subagents", () => {
  const root = "/tmp/sessions/project/2026-01-01T00-00-00Z_root-id";
  expect(parseOmpSession("x", sample, `${root}/__advisor.planreviewer.jsonl`).session.agentType).toBe("advisor");
  expect(parseOmpSession("x", sample, `${root}/Worker/Worker.Child.jsonl`).session).toMatchObject({ isSubagent: true, agentType: "subagent" });
});


test("OMP links child to parent without fork usage dedupe", () => {
  const root = join(dir, "sessions", "project", "2026_root-id.jsonl");
  const child = join(dir, "sessions", "project", "2026_root-id", "Worker.jsonl");
  mkdirSync(join(dir, "sessions", "project", "2026_root-id"), { recursive: true });
  writeFileSync(root, sample);
  writeFileSync(join(dir, "sessions", "project", "2026_root-id", "changes.jsonl"), "{}");
  const db = openDb(join(dir, "archive.db"));
  writeFileSync(child, `${JSON.stringify({ type: "title", title: "Child" })}\n${JSON.stringify({ type: "session", id: "child-id", timestamp: "2026-01-01T00:00:01.000Z", cwd: "/tmp/project", parentSession: root })}\n${JSON.stringify({ type: "message", id: "c1", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "assistant", model: "gpt-5.4", usage: { input: 42, output: 1 }, content: [] } })}\n`);
  const config = { claudeDir: join(dir, "claude"), codexDir: join(dir, "codex"), ompDir: join(dir, "sessions"), sourcePaths: [join(dir, "sessions")] };
  expect(sync(db, config)).toMatchObject({ scanned: 2, ingested: 2, failed: 0 });
  expect(db.query("SELECT child.total_input_tokens, child.is_subagent, child.agent_id, child.agent_type, parent.source_session_id AS parent FROM session child LEFT JOIN session parent ON parent.id=child.parent_session_id WHERE child.source_session_id='child-id'").get()).toEqual({ total_input_tokens: 42, is_subagent: 1, agent_id: "Worker", agent_type: "subagent", parent: "root-id" });
  expect(db.query("SELECT model, input_tokens FROM session_model_usage WHERE model='helper-model'").get()).toEqual({ model: "helper-model", input_tokens: 5 });
  closeDb(db);
});
