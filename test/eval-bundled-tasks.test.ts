import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED_TASKS_DIR, readEvalTasks } from "../src/eval/catalog.ts";

const taskIds = readdirSync(BUNDLED_TASKS_DIR).sort();

function workspace(taskDir: string, overlay: "starter" | "reference" | "broken"): string {
  const ws = mkdtempSync(join(tmpdir(), "ab-task-"));
  const setup = Bun.spawnSync(["sh", join(taskDir, "setup.sh")], {
    cwd: ws,
    env: { ...process.env, ACH_TASK_DIR: taskDir, ACH_WORKSPACE: ws },
  });
  if (setup.exitCode !== 0) throw new Error(`setup.sh failed: ${setup.stderr.toString()}`);
  if (overlay !== "starter") cpSync(join(taskDir, overlay), ws, { recursive: true });
  return ws;
}

function verify(taskDir: string, ws: string): { passed: boolean; output: string } {
  const run = Bun.spawnSync(["sh", join(taskDir, "verify.sh")], {
    cwd: ws,
    env: { ...process.env, ACH_TASK_DIR: taskDir, ACH_WORKSPACE: ws },
  });
  return { passed: run.exitCode === 0, output: `${run.stdout}${run.stderr}` };
}

test("every bundled task is in the catalog under its own category", () => {
  const sources = readEvalTasks(join(tmpdir(), "no-ach-checkout"));
  expect(sources.map((source) => source.task.id).sort()).toEqual(taskIds);
  const mix: Record<string, string[]> = {};
  for (const { task } of sources) {
    expect(task.category).not.toBe(task.language);
    expect(task.description.length).toBeLessThanOrEqual(110);
    mix[task.category] = [...(mix[task.category] ?? []), task.difficulty ?? "none"];
  }
  for (const difficulties of Object.values(mix))
    expect(difficulties.sort()).toEqual(["easy", "easy", "hard", "medium", "medium"]);
});

describe.each(taskIds)("%s", (taskId) => {
  const taskDir = join(BUNDLED_TASKS_DIR, taskId);

  test("setup copies only the starter, which fails verify", () => {
    const ws = workspace(taskDir, "starter");
    try {
      for (const leak of ["reference", "broken", "hidden", "verify.sh", "meta.json"])
        expect(existsSync(join(ws, leak))).toBe(false);
      expect(verify(taskDir, ws).passed).toBe(false);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 60_000);

  test("the reference passes verify", () => {
    const ws = workspace(taskDir, "reference");
    try {
      const result = verify(taskDir, ws);
      expect(result.output).toBeString();
      expect(result.passed, result.output).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 60_000);

  test("the planted bug in broken/ fails verify", () => {
    const meta = JSON.parse(readFileSync(join(taskDir, "meta.json"), "utf8"));
    expect(meta.broken).toBeString();
    const ws = workspace(taskDir, "broken");
    try {
      expect(verify(taskDir, ws).passed).toBe(false);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 60_000);
});
