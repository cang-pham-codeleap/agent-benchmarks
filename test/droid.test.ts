import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db.ts";
import { sync } from "../src/ingest.ts";
import { parseDroidSession } from "../src/sources/droid.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "decant-droid-test-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const fixture = (name: string) => readFileSync(join(import.meta.dir, "..", "fixtures", "droid", name), "utf8");

test("Droid reads settings usage and retains its exact custom model id", () => {
  const parsed = parseDroidSession(
    "fallback",
    fixture("sample.jsonl"),
    fixture("sample.settings.json"),
    JSON.stringify({ customModels: [{ id: "custom:gpt-5.5-0", model: "gpt-5.5", provider: "OpenAI" }] }),
  );
  expect(parsed.session).toMatchObject({
    tool: "droid", model: "custom:gpt-5.5-0", provider: "openai", title: "Example task",
    totals: { input: 100, output: 20, cacheRead: 30, cacheCreation: 40, reasoning: 5 },
  });
  expect(parsed.session.messages).toHaveLength(2);
  expect(parsed.session.rawMeta).toMatchObject({ modelAlias: true });
});

test("Droid settings-only changes trigger reingestion", () => {
  const root = join(dir, "sessions", "project");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "sample.jsonl"), fixture("sample.jsonl"));
  const settings = join(root, "sample.settings.json");
  writeFileSync(settings, fixture("sample.settings.json"));
  const db = openDb(join(dir, "archive.db"));
  const config = { claudeDir: join(dir, "claude"), codexDir: join(dir, "codex"), droidDir: join(dir, "sessions") };
  expect(sync(db, config)).toMatchObject({ scanned: 1, ingested: 1 });
  writeFileSync(settings, fixture("sample.settings.json").replace('"inputTokens":100', '"inputTokens":101'));
  expect(sync(db, config)).toMatchObject({ scanned: 1, ingested: 1 });
  expect(db.query("SELECT total_input_tokens FROM session WHERE tool='droid'").get()).toEqual({ total_input_tokens: 101 });
  closeDb(db);
});
