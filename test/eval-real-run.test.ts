import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type Config, resolveConfig } from "../src/config.ts";
import { closeDb, openDb } from "../src/db.ts";
import { artifactDir } from "../src/eval/paths.ts";
import { discover, sync } from "../src/ingest.ts";

// Dynamic imports: the registry reads the null-harness opt-in when it evaluates, and another
// test file may already have loaded it, so the entry is also added below and removed after.
const allowNull = process.env.AGENT_BENCHMARKS_EVAL_ALLOW_NULL;
process.env.AGENT_BENCHMARKS_EVAL_ALLOW_NULL = "1";
const { EVAL_HARNESSES } = await import("../src/eval/registry.ts");
const {
  cancelEvalRun,
  defaultGroupSyncConfig,
  readEvalResults,
  readRunManifest,
  resumeEvalRun,
  startEvalRun,
} = await import("../src/eval/runner.ts");
EVAL_HARNESSES.null ??= {
  label: "Null (smoke)",
  achAgent: "null",
  descriptor: null,
  versionArgs: ["--version"],
  metered: false,
  sessionTool: "null",
  qualifiedModels: false,
  defaultConfig: {},
  clean: { args: [] },
};

const achDir = join(homedir(), "Documents", "sources", "_oss-study", "agentic-coding-harness");
const achMissing =
  existsSync(join(achDir, "src", "cli", "ach.ts")) && existsSync(join(achDir, "node_modules"))
    ? null
    : `ach checkout with node_modules not found at ${achDir}`;

const root = mkdtempSync(join(tmpdir(), "eval-real-run-"));
const repo = join(root, "repo");
const saved = {
  AGENT_BENCHMARKS_EVAL_ALLOW_NULL: allowNull,
  AGENT_BENCHMARKS_CONFIG_DIR: process.env.AGENT_BENCHMARKS_CONFIG_DIR,
  PATH: process.env.PATH,
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
};

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(
    ["git", "-c", "user.email=eval@example.test", "-c", "user.name=Eval Test", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.toString().trim();
}

function repoState(): string {
  return [
    git(repo, "rev-parse", "HEAD"),
    git(repo, "for-each-ref", "--format=%(refname) %(objectname)"),
    git(repo, "status", "--porcelain", "--ignored"),
    git(repo, "stash", "list"),
  ].join("\n");
}

function testConfig(name: string): Config {
  const home = join(root, name, "home");
  mkdirSync(home, { recursive: true });
  return resolveConfig({
    dbPath: join(root, name, "archive", "archive.db"),
    homeDir: home,
    env: {},
  });
}

beforeAll(() => {
  const configDir = join(root, "settings");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "settings.json"), JSON.stringify({ achDir }));
  process.env.AGENT_BENCHMARKS_CONFIG_DIR = configDir;
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), "#!/bin/sh\necho 0.0.0-test\n");
  chmodSync(join(bin, "claude"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;

  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "lib.txt"), "1\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  writeFileSync(join(repo, "lib.txt"), "2\n");
  mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "test", "check.sh"), "grep -q 2 lib.txt\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "bump lib to 2");
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  if (allowNull !== "1") delete EVAL_HARNESSES.null;
  rmSync(root, { recursive: true, force: true });
});

// Runs finish in a detached ach child; the files it writes are the only completion signal.
async function waitUntil(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 150_000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the evaluation run");
    await Bun.sleep(100);
  }
}

function inProcessSync(syncs: Config[]) {
  return {
    runSync: async (target: Config) => {
      syncs.push(target);
      const db = openDb(target.dbPath);
      try {
        return sync(db, target);
      } finally {
        closeDb(db);
      }
    },
  };
}

describe("real-task evaluation runs", () => {
  test.skipIf(achMissing != null)(
    `replays a commit across config groups${achMissing == null ? "" : ` (skipped: ${achMissing})`}`,
    async () => {
      const config = testConfig("e2e");
      const syncs: Config[] = [];
      const context = inProcessSync(syncs);
      const sha = git(repo, "rev-parse", "HEAD");
      const before = repoState();
      const started = await startEvalRun(config, context, {
        kind: "real",
        name: "replay smoke",
        setups: [
          { harness: "null", model: "smoke", config: "current" },
          { harness: "null", model: "smoke", config: "default" },
          { harness: "claude", model: "sonnet", config: "default" },
        ],
        trials: 1,
        wallMs: 60_000,
        repoPath: repo,
        task: { type: "replay", sha, prompt: "Bump lib to 2.", hiddenPaths: ["test/check.sh"] },
        profile: {
          setupCommand: null,
          checks: ["test -f lib.txt"],
          hiddenTestCommand: "sh {file}",
        },
      });
      expect(started.status).toBe("running");

      await waitUntil(
        () => readRunManifest(config.dbPath, started.id)?.status !== "running" && syncs.length > 0,
      );
      const manifest = readRunManifest(config.dbPath, started.id);
      expect(manifest?.status).toBe("completed");
      if (manifest == null) throw new Error("manifest disappeared");
      expect(manifest.provenance.hermeticRoot).toBeNull();

      const runDir = join(root, "e2e", "archive", "evals", manifest.id);
      const taskId = `replay-${sha.slice(0, 7)}`;
      const nullCell = `null:${taskId}:smoke:trial1`;
      const ranIds = [`current/${nullCell}`, `default/${nullCell}`];
      const skippedId = `default/claude:${taskId}:sonnet:trial1`;
      const db = openDb(config.dbPath);
      try {
        const results = readEvalResults(db, config.dbPath, manifest);
        expect(results.cells.map((cell) => cell.cellId)).toEqual([...ranIds, skippedId]);
        for (const id of ranIds) {
          const ran = results.cells.find((cell) => cell.cellId === id);
          expect(ran?.outcome).toBe("verify-failed");
          expect(ran?.raw.exitStatus).toBe("success");
          expect(results.real?.cells[id]?.hidden).toMatchObject({ passed: 0, total: 1 });
          expect(results.real?.cells[id]?.checks[0]?.exitCode).toBe(0);
        }
        const skipped = results.cells.find((cell) => cell.cellId === skippedId);
        expect(skipped?.outcome).toBe("unavailable");
        expect(skipped?.raw.error).toContain("CLAUDE_CODE_OAUTH_TOKEN");
        expect(results.progress).toMatchObject({ done: 3, total: 3 });

        const [current, defaults, skippedSummary] = results.setups;
        expect(current?.passRate).toBe(0);
        expect(current?.eligibleTasks).toBe(1);
        expect(defaults?.passRate).toBe(0);
        expect(skippedSummary?.passRate).toBeNull();
        expect(skippedSummary?.graded).toBe(0);
        expect(skippedSummary?.outcomes.unavailable).toBe(1);

        expect(results.real?.reference?.diffStat.files.sort()).toEqual([
          "lib.txt",
          "test/check.sh",
        ]);
        expect(Object.keys(results.real?.cells ?? {})).toEqual(ranIds);
      } finally {
        closeDb(db);
      }

      for (const group of ["current", "default"] as const) {
        const cellDir = artifactDir(runDir, group, nullCell);
        expect(existsSync(join(cellDir, "diff.patch"))).toBe(true);
        expect(existsSync(join(cellDir, "result.json"))).toBe(true);
      }
      expect(existsSync(join(runDir, "reference", "diff.patch"))).toBe(true);
      expect(readFileSync(join(runDir, "ledger.default.jsonl"), "utf8")).toContain(
        "skipped-unavailable",
      );
      expect(syncs.map((target) => "sourcePaths" in target)).toEqual([false]);
      expect(repoState()).toBe(before);
    },
    180_000,
  );

  test.skipIf(achMissing != null)(
    "cancel stops the group chain and resume reruns every group",
    async () => {
      const config = testConfig("cancel");
      const context = inProcessSync([]);
      const marker = join(root, "cancel", "resume-fast");
      const started = await startEvalRun(config, context, {
        kind: "real",
        name: "cancel smoke",
        setups: [
          { harness: "null", model: "smoke", config: "current" },
          { harness: "null", model: "smoke", config: "default" },
        ],
        trials: 1,
        wallMs: 60_000,
        repoPath: repo,
        task: { type: "prompt", prompt: "Say hi.", baseRef: "main" },
        profile: {
          setupCommand: `test -f '${marker}' || sleep 30`,
          checks: [],
          hiddenTestCommand: null,
        },
      });
      const runDir = join(root, "cancel", "archive", "evals", started.id);
      await waitUntil(() => existsSync(join(runDir, "ach-state", "worktrees")));
      expect((await cancelEvalRun(config.dbPath, started.id)).status).toBe("cancelled");
      expect(existsSync(join(runDir, "ledger.default.jsonl"))).toBe(false);
      expect(existsSync(join(runDir, "cells"))).toBe(false);

      writeFileSync(marker, "");
      resumeEvalRun(config, context, started.id);
      await waitUntil(() => readRunManifest(config.dbPath, started.id)?.status !== "running");
      const manifest = readRunManifest(config.dbPath, started.id);
      expect(manifest?.status).toBe("completed");
      if (manifest == null) throw new Error("manifest disappeared");
      const db = openDb(config.dbPath);
      try {
        const results = readEvalResults(db, config.dbPath, manifest);
        expect(results.cells.map((cell) => [cell.cellId, cell.outcome])).toEqual([
          ["current/null:prompt:smoke:trial1", "passed"],
          ["default/null:prompt:smoke:trial1", "passed"],
        ]);
        expect(results.progress).toMatchObject({ done: 2, total: 2 });
      } finally {
        closeDb(db);
      }
    },
    60_000,
  );

  test("syncs default-config transcripts from the run without non-transcript JSONL", () => {
    const config = testConfig("targeted");
    const runDir = join(root, "targeted", "run");
    const claudeRun = join(runDir, "ach-state", "claude-runs", "run-1");
    const transcript = join(claudeRun, "projects", "-tmp-worktree", "session-1.jsonl");
    mkdirSync(join(claudeRun, "projects", "-tmp-worktree"), { recursive: true });
    copyFileSync(join(import.meta.dir, "fixtures", "claude-split-message.jsonl"), transcript);
    writeFileSync(join(claudeRun, "history.jsonl"), '{"display":"hi","timestamp":1}\n');
    const rollout = join(runDir, "home", "codex", "sessions", "rollout-2026-11-20-x.jsonl");
    mkdirSync(join(runDir, "home", "codex", "sessions"), { recursive: true });
    writeFileSync(rollout, "");

    expect(defaultGroupSyncConfig(config, join(root, "targeted", "empty"))).toBeNull();
    const target = defaultGroupSyncConfig(config, runDir);
    if (target == null) throw new Error("expected a targeted sync config");
    expect(discover(target).map((file) => [file.tool, file.path])).toEqual([
      ["claude_code", transcript],
      ["codex", rollout],
    ]);
    mkdirSync(join(root, "targeted", "archive"), { recursive: true });
    const db = openDb(config.dbPath);
    try {
      sync(db, target);
      expect(
        db.query("SELECT tool, source_session_id FROM session WHERE tool = 'claude_code'").all(),
      ).toEqual([{ tool: "claude_code", source_session_id: "session-1" }]);
    } finally {
      closeDb(db);
    }
  });

  test("reads manifests written before real-task runs as current-config benchmarks", () => {
    const config = testConfig("legacy");
    const id = "00000000-0000-4000-8000-000000000001";
    const runDir = join(root, "legacy", "archive", "evals", id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "manifest.json"),
      JSON.stringify({
        id,
        createdAt: "2026-01-01T00:00:00.000Z",
        input: {
          name: "old",
          setups: [{ harness: "claude", model: "sonnet" }],
          taskIds: ["py-slugify"],
          trials: 1,
          wallMs: 60_000,
          preset: "custom",
        },
        status: "completed",
        pid: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:01:00.000Z",
        exitCode: 0,
        error: null,
        survivors: [],
        provenance: {
          achDir,
          achCommit: "abc",
          achDirty: false,
          harnessVersions: {},
          taskHashes: {},
          executionOrder: [],
          hermeticRoot: "/private/tmp/agent-benchmarks-hermetic/x",
          globalConfigNote: "",
        },
      }),
    );
    const manifest = readRunManifest(config.dbPath, id);
    expect(manifest?.input.kind).toBe("benchmark");
    expect(manifest?.input.setups).toEqual([
      { harness: "claude", model: "sonnet", config: "current", augments: [] },
    ]);
  });
});
