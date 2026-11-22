import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
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
import { readEvalCells } from "../src/eval/ledger.ts";
import { groupId, safeCellDir } from "../src/eval/paths.ts";
import type { BenchmarkRunInput } from "../src/eval/types.ts";
import { sync } from "../src/ingest.ts";

const allowNull = process.env.AGENT_BENCHMARKS_EVAL_ALLOW_NULL;
process.env.AGENT_BENCHMARKS_EVAL_ALLOW_NULL = "1";
const { EVAL_HARNESSES } = await import("../src/eval/registry.ts");
const { augmentDefinitions, loadAugments } = await import("../src/eval/augments.ts");
const { readEvalResults, readRunManifest, startEvalRun, validateInput, writeHarnessShims } =
  await import("../src/eval/runner.ts");
const bundled = loadAugments(null);
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

const root = mkdtempSync(join(tmpdir(), "eval-augments-"));
const noAch = join(root, "no-ach");
const fakeBin = join(root, "fake-bin");
const saved = {
  AGENT_BENCHMARKS_EVAL_ALLOW_NULL: allowNull,
  AGENT_BENCHMARKS_CONFIG_DIR: process.env.AGENT_BENCHMARKS_CONFIG_DIR,
  AGENT_BENCHMARKS_EVAL_DIR: process.env.AGENT_BENCHMARKS_EVAL_DIR,
  PATH: process.env.PATH,
};

function fake(name: string, script: string): void {
  writeFileSync(join(fakeBin, name), `#!/bin/sh\n${script}\n`);
  chmodSync(join(fakeBin, name), 0o755);
}

const echoArgv = `for arg do printf '%s\\n' "$arg"; done`;

beforeAll(() => {
  mkdirSync(fakeBin, { recursive: true });
  for (const name of ["claude", "omp", "codex"]) fake(name, echoArgv);
  fake("rtk", "exit 0");
  fake("codegraph", `echo run >> "${join(root, "codegraph-runs")}"`);
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  if (allowNull !== "1") delete EVAL_HARNESSES.null;
  rmSync(root, { recursive: true, force: true });
});

const env = () => ({ PATH: `${fakeBin}:${saved.PATH}` });

function benchmark(setups: unknown[]) {
  return {
    name: "augments",
    setups,
    taskIds: ["db-schema-orders"],
    trials: 1,
    wallMs: 60_000,
    preset: "custom",
  };
}

function rejection(raw: unknown, pathEnv = env()): { status: number; message: string } | null {
  try {
    validateInput(raw, noAch, bundled, pathEnv);
    return null;
  } catch (error) {
    const { status, message } = error as { status: number; message: string };
    return { status, message };
  }
}

describe("augment boundary", () => {
  test("normalizes, sorts, and dedupes augments; a missing list is empty", () => {
    const input = validateInput(
      benchmark([
        { harness: "claude", model: "haiku", config: "clean" },
        {
          harness: "claude",
          model: "haiku",
          config: "clean",
          augments: ["rtk", "bash-cap", "rtk"],
        },
        { harness: "claude", model: "haiku" },
      ]),
      noAch,
      bundled,
      env(),
    );
    expect(input.setups).toEqual([
      { harness: "claude", model: "haiku", config: "clean", augments: [] },
      { harness: "claude", model: "haiku", config: "clean", augments: ["bash-cap", "rtk"] },
      { harness: "claude", model: "haiku", config: "current", augments: [] },
    ]);
  });

  test("rejects augments on the current config", () => {
    expect(
      rejection(benchmark([{ harness: "claude", model: "haiku", augments: ["rtk"] }]))?.message,
    ).toContain("clean or default config");
  });

  test("rejects an augment the harness has no recipe for, and clean where unsupported", () => {
    expect(
      rejection(
        benchmark([{ harness: "claude", model: "haiku", config: "clean", augments: ["ptc"] }]),
      )?.message,
    ).toBe("Programmatic tool calling is not supported for Claude Code");
    expect(
      rejection(benchmark([{ harness: "copilot", model: "m", config: "clean" }]))?.message,
    ).toBe("clean config is not supported for GitHub Copilot");
    expect(
      rejection(
        benchmark([{ harness: "claude", model: "haiku", config: "clean", augments: ["nope"] }]),
      )?.status,
    ).toBe(400);
  });

  test("rejects an unavailable augment with its problem, and two prompt modes", () => {
    const bare = { PATH: join(root, "empty") };
    mkdirSync(bare.PATH, { recursive: true });
    expect(
      rejection(
        benchmark([{ harness: "claude", model: "haiku", config: "clean", augments: ["rtk"] }]),
        bare,
      ),
    ).toEqual({ status: 503, message: "RTK: rtk is not on PATH" });
    expect(
      rejection(
        benchmark([
          { harness: "claude", model: "haiku", config: "clean", augments: ["caveman", "ponytail"] },
        ]),
      )?.message,
    ).toContain("at most one prompt-mode");
  });

  test("duplicate detection includes augments", () => {
    const same = { harness: "claude", model: "haiku", config: "clean", augments: ["rtk"] };
    expect(rejection(benchmark([same, { ...same, augments: ["rtk", "rtk"] }]))?.message).toBe(
      "duplicate setup: claude:haiku:clean+rtk",
    );
    expect(rejection(benchmark([same, { ...same, augments: [] }]))).toBeNull();
  });
});

describe("harness shim recipes", () => {
  function run(
    groupName: string,
    config: "clean" | "default",
    augments: Parameters<typeof groupId>[1],
    harness: string,
    args: string[],
    cwd = root,
  ) {
    const runDir = join(root, groupName.replace(/[^\w-]/g, "_"), harness);
    const group = groupId(config, augments);
    const bin = writeHarnessShims(
      runDir,
      group,
      [harness],
      false,
      fakeBin,
      augmentDefinitions(bundled),
    );
    if (bin == null) throw new Error("no shim written");
    const result = Bun.spawnSync([join(bin, harness), ...args], {
      cwd,
      env: { ...process.env, ...env() },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      runDir,
      bin,
      code: result.exitCode,
      stdout: result.stdout.toString().trimEnd().split("\n"),
      stderr: result.stderr.toString(),
    };
  }
  const argv = (runDir: string, lines: string[]) =>
    lines.map((line) => line.replaceAll(runDir, "<run>"));

  test("claude clean drops user config but keeps the login", () => {
    const { runDir, stdout } = run("c", "clean", [], "claude", ["-p", "hi"]);
    expect(argv(runDir, stdout)).toEqual([
      "-p",
      "hi",
      "--setting-sources",
      "project,local",
      "--permission-mode",
      "auto",
      "--strict-mcp-config",
      "--mcp-config",
      "<run>/augments/mcp-clean.json",
    ]);
    expect(JSON.parse(readFileSync(join(runDir, "augments", "mcp-clean.json"), "utf8"))).toEqual({
      mcpServers: {},
    });
  });

  test("claude clean+rtk adds the PreToolUse hook settings", () => {
    const { runDir, stdout } = run("r", "clean", ["rtk"], "claude", ["-p", "hi"]);
    expect(argv(runDir, stdout).slice(2)).toEqual([
      "--setting-sources",
      "project,local",
      "--permission-mode",
      "auto",
      "--strict-mcp-config",
      "--mcp-config",
      "<run>/augments/mcp-clean+rtk.json",
      "--settings",
      "<run>/augments/rtk-settings.json",
    ]);
    const settings = JSON.parse(
      readFileSync(join(runDir, "augments", "rtk-settings.json"), "utf8"),
    );
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("rtk hook claude");
  });

  test("claude clean+caveman appends the vendored prompt and records its hash", () => {
    const { runDir, stdout } = run("p", "clean", ["caveman"], "claude", ["-p", "hi"]);
    expect(argv(runDir, stdout).slice(-2)).toEqual([
      "--append-system-prompt-file",
      "<run>/augments/caveman.md",
    ]);
    const hashes = JSON.parse(readFileSync(join(runDir, "augments", "sha256.json"), "utf8"));
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(readFileSync(join(runDir, "augments", "caveman.md")));
    expect(hashes["caveman.md"]).toBe(hasher.digest("hex"));
  });

  test("claude clean+bash-cap leaves argv alone; the cap is group env", () => {
    const { runDir, stdout } = run("b", "clean", ["bash-cap"], "claude", ["-p", "hi"]);
    expect(argv(runDir, stdout).slice(-1)).toEqual(["<run>/augments/mcp-clean+bash-cap.json"]);
  });

  test("omp clean pins the default tools minus eval; ptc adds exactly eval", () => {
    const clean = run("oc", "clean", [], "omp", ["-p", "hi"]);
    const tools =
      clean.stdout
        .find((line) => line.startsWith("--tools="))
        ?.slice(8)
        .split(",") ?? [];
    expect(clean.stdout.filter((line) => !line.startsWith("--tools="))).toEqual([
      "-p",
      "hi",
      "--no-extensions",
      "--no-skills",
      "--no-rules",
      "--no-context-files",
    ]);
    expect(tools).not.toContain("eval");
    expect(tools).toContain("bash");
    const ptc = run("op", "clean", ["ptc"], "omp", ["-p", "hi"]);
    const ptcTools = ptc.stdout
      .find((line) => line.startsWith("--tools="))
      ?.slice(8)
      .split(",");
    expect(ptcTools).toEqual([...tools, "eval"]);
  });

  test("codex clean appends the flag to exec only", () => {
    expect(run("x", "clean", [], "codex", ["exec", "do it"]).stdout).toEqual([
      "exec",
      "do it",
      "--ignore-user-config",
    ]);
  });

  test("a version probe passes through untouched", () => {
    expect(run("v", "clean", ["rtk"], "claude", ["--version"]).stdout).toEqual(["--version"]);
  });

  test("codegraph prepares once per workspace, keeps output out of git, and logs it", () => {
    const workspace = join(root, "ws-codegraph");
    mkdirSync(workspace, { recursive: true });
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: workspace }).exitCode).toBe(0);
    const first = run("g", "clean", ["codegraph"], "claude", ["-p", "hi"], workspace);
    expect(first.code).toBe(0);
    const second = Bun.spawnSync([join(first.bin, "claude"), "-p", "hi"], {
      cwd: workspace,
      env: { ...process.env, ...env() },
    });
    expect(second.exitCode).toBe(0);
    expect(readFileSync(join(root, "codegraph-runs"), "utf8")).toBe("run\n");
    const exclude = readFileSync(join(workspace, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(".codegraph");
    expect(exclude).toContain(".ab-prep-clean_codegraph");
    const rows = readFileSync(join(first.runDir, "augments", "prep.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ groupKey: "clean+codegraph", harness: "claude", ok: true });
    expect(first.stdout).toContain(
      "<run>/augments/mcp-clean+codegraph.json".replace("<run>", first.runDir),
    );
    const servers = JSON.parse(
      readFileSync(join(first.runDir, "augments", "mcp-clean+codegraph.json"), "utf8"),
    );
    expect(servers.mcpServers.codegraph.command).toBe("codegraph");
  });

  test("a failed prepare exits 97 without running the agent and reads back as setup-error", () => {
    fake("codegraph", "echo 'index exploded' >&2; exit 3");
    const input: BenchmarkRunInput = {
      kind: "benchmark",
      name: "prep failure",
      setups: [{ harness: "claude", model: "haiku", config: "clean", augments: ["codegraph"] }],
      taskIds: ["db-schema-orders"],
      trials: 1,
      wallMs: 1000,
      preset: "custom",
    };
    const cell = "claude:db-schema-orders:haiku:trial1";
    const workspace = join(root, "ws-fail", safeCellDir(cell));
    mkdirSync(workspace, { recursive: true });
    const failed = run("f", "clean", ["codegraph"], "claude", ["-p", "hi"], workspace);
    expect(failed.code).toBe(97);
    expect(failed.stdout).toEqual([""]);
    expect(failed.stderr).toContain("augment prepare failed (exit 3): index exploded");
    expect(existsSync(join(workspace, ".ab-prep-clean_codegraph"))).toBe(false);

    const now = Date.now();
    writeFileSync(
      join(failed.runDir, "ledger.clean+codegraph.jsonl"),
      `${JSON.stringify({
        v: 1,
        cellId: cell,
        agent: "claude",
        task: "db-schema-orders",
        model: "haiku",
        trial: 1,
        status: "error",
        runId: null,
        exitStatus: "error",
        startedAt: now,
        endedAt: now,
      })}\n`,
    );
    mkdirSync(join(root, "db"), { recursive: true });
    const db = openDb(join(root, "db", "archive.db"));
    try {
      const { cells } = readEvalCells(db, failed.runDir, input);
      expect(cells).toHaveLength(1);
      expect(cells[0]).toMatchObject({
        cellId: `clean+codegraph/${cell}`,
        setupKey: "claude:haiku:clean+codegraph",
        outcome: "setup-error",
      });
      expect(cells[0]?.prepMs).toBeGreaterThanOrEqual(0);
      expect(cells[0]?.raw.error).toContain("index exploded");
    } finally {
      closeDb(db);
    }
  });
});

function testConfig(name: string): Config {
  const home = join(root, name, "home");
  mkdirSync(home, { recursive: true });
  return resolveConfig({
    dbPath: join(root, name, "archive", "archive.db"),
    homeDir: home,
    env: {},
  });
}

describe("augmented benchmark run", () => {
  test.skipIf(achMissing != null)(
    `runs groups in request order, a clean baseline and an augmented setup apart${achMissing == null ? "" : ` (skipped: ${achMissing})`}`,
    async () => {
      const configDir = join(root, "settings");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "settings.json"), JSON.stringify({ achDir }));
      process.env.AGENT_BENCHMARKS_CONFIG_DIR = configDir;
      const evalDir = join(root, "user-evals");
      mkdirSync(join(evalDir, "augments"), { recursive: true });
      writeFileSync(
        join(evalDir, "augments", "bash-cap.json"),
        JSON.stringify({
          label: "Bash output cap",
          kind: "harness-flag",
          description: "Caps Bash tool output.",
          sourceUrl: "https://example.invalid",
          binary: null,
          recipes: { null: { env: { AB_AUGMENT_TEST: "1" } } },
        }),
      );
      process.env.AGENT_BENCHMARKS_EVAL_DIR = evalDir;
      const config = testConfig("e2e");
      const started = await startEvalRun(
        config,
        {
          runSync: async (target: Config) => {
            const db = openDb(target.dbPath);
            try {
              return sync(db, target);
            } finally {
              closeDb(db);
            }
          },
        },
        benchmark([
          { harness: "null", model: "smoke", config: "clean", augments: ["bash-cap"] },
          { harness: "null", model: "smoke", config: "clean" },
        ]),
      );
      const deadline = Date.now() + 150_000;
      while (readRunManifest(config.dbPath, started.id)?.status === "running") {
        if (Date.now() > deadline) throw new Error("timed out waiting for the evaluation run");
        await Bun.sleep(100);
      }
      const manifest = readRunManifest(config.dbPath, started.id);
      expect(manifest?.status).toBe("completed");
      if (manifest == null) throw new Error("manifest disappeared");
      const runDir = join(root, "e2e", "archive", "evals", manifest.id);
      expect(existsSync(join(runDir, "plan.clean.json"))).toBe(true);
      expect(existsSync(join(runDir, "plan.clean+bash-cap.json"))).toBe(true);
      const startedAt = (file: string) =>
        JSON.parse(readFileSync(join(runDir, file), "utf8").split("\n")[0] ?? "{}").startedAt;
      expect(startedAt("ledger.clean+bash-cap.jsonl")).toBeLessThan(
        startedAt("ledger.clean.jsonl"),
      );
      const db = openDb(config.dbPath);
      try {
        const results = readEvalResults(db, config.dbPath, manifest);
        const task = "null:db-schema-orders:smoke:trial1";
        expect(results.cells.map((cell) => cell.cellId)).toEqual([
          `clean+bash-cap/${task}`,
          `clean/${task}`,
        ]);
        expect(results.cells.map((cell) => cell.setupKey)).toEqual([
          "null:smoke:clean+bash-cap",
          "null:smoke:clean",
        ]);
        expect(results.cells.every((cell) => cell.outcome !== "pending")).toBe(true);
        expect(results.cells.map((cell) => cell.prepMs)).toEqual([null, null]);
        expect(results.progress).toMatchObject({ done: 2, total: 2 });
        expect(results.augmentVerdicts).toHaveLength(1);
      } finally {
        closeDb(db);
      }
    },
    180_000,
  );
});
