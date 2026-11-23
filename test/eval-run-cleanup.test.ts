import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRunManifests } from "../src/eval/runner.ts";

const root = mkdtempSync(join(tmpdir(), "eval-run-cleanup-"));
const hermeticParent = "/private/tmp/agent-benchmarks-hermetic";
const onMac = process.platform === "darwin";
const runIds = { done: crypto.randomUUID(), cancelled: crypto.randomUUID() };
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const id of Object.values(runIds))
    rmSync(join(hermeticParent, id), { recursive: true, force: true });
});

function fakeRun(evals: string, id: string, status: string): string {
  const runDir = join(evals, id);
  for (const dir of ["tasks/t1", "repo", "cwd", "ach-state/worktrees/w", "ach-state/runs"])
    mkdirSync(join(runDir, dir), { recursive: true });
  mkdirSync(join(runDir, "ledger.clean.work", "cell"), { recursive: true });
  mkdirSync(join(runDir, "cells", "clean", "cell"), { recursive: true });
  mkdirSync(join(runDir, "home", "codex", "sessions"), { recursive: true });
  writeFileSync(join(runDir, "home", "codex", "auth.json"), '{"token":"secret"}');
  writeFileSync(join(runDir, "home", "codex", "sessions", "s.jsonl"), "{}\n");
  writeFileSync(join(runDir, "ledger.clean.jsonl"), "{}\n");
  writeFileSync(join(runDir, "cells", "clean", "cell", "result.json"), "{}");
  writeFileSync(join(runDir, "ach-state", "runs", "r.json"), "{}");
  writeFileSync(
    join(runDir, "manifest.json"),
    JSON.stringify({
      id,
      status,
      createdAt: new Date().toISOString(),
      input: { kind: "benchmark", name: id, setups: [], taskIds: [], trials: 1, wallMs: 1 },
      provenance: { hermeticRoot: join(hermeticParent, id) },
    }),
  );
  if (onMac) mkdirSync(join(hermeticParent, id, "ach-hermetic-x"), { recursive: true });
  return runDir;
}

test("a finished run keeps its results and loses its working copies and credential copies", () => {
  const dbPath = join(root, "archive", "archive.db");
  const evals = join(root, "archive", "evals");
  mkdirSync(evals, { recursive: true, mode: 0o755 });
  const done = fakeRun(evals, runIds.done, "completed");
  const cancelled = fakeRun(evals, runIds.cancelled, "cancelled");

  expect(listRunManifests(dbPath)).toHaveLength(2);

  for (const gone of ["tasks", "repo", "cwd", "ach-state/worktrees", "ledger.clean.work"])
    expect(existsSync(join(done, gone))).toBe(false);
  for (const kept of [
    "manifest.json",
    "ledger.clean.jsonl",
    "cells/clean/cell/result.json",
    "ach-state/runs/r.json",
    "home/codex/sessions/s.jsonl",
  ])
    expect(existsSync(join(done, kept))).toBe(true);
  for (const runDir of [done, cancelled])
    expect(existsSync(join(runDir, "home", "codex", "auth.json"))).toBe(false);
  expect(existsSync(join(cancelled, "tasks", "t1"))).toBe(true);
  if (onMac) {
    expect(existsSync(join(hermeticParent, runIds.done))).toBe(false);
    expect(existsSync(join(hermeticParent, runIds.cancelled))).toBe(true);
  }
  expect(statSync(evals).mode & 0o777).toBe(0o700);
});
