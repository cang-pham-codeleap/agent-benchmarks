import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db.ts";
import { loadAugments } from "../src/eval/augments.ts";
import { EvalRequestError } from "../src/eval/errors.ts";
import { apiCellId, artifactDir } from "../src/eval/paths.ts";
import * as real from "../src/eval/real.ts";
import { cleanConfigProblem, configGroupEnv, defaultConfigProblem } from "../src/eval/registry.ts";
import type { EvalCell, RealRunInput } from "../src/eval/types.ts";

const verifyScript = join(import.meta.dir, "..", "src", "eval", "real-verify.ts");
let root: string;
let repo: string;
let fixSha: string;

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function write(dir: string, path: string, body: string): void {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), body);
}

function commit(message: string): string {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function validate(raw: unknown): RealRunInput {
  return real.validateRealInput(raw, loadAugments(null), { PATH: join(root, "bin") });
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof EvalRequestError) return error.code;
    throw error;
  }
  return undefined;
}

const buggy = "export function add(a, b) {\n  return a - b;\n}\n";
const fixed = "export function add(a, b) {\n  return a + b;\n}\n";

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "eval-real-core-")));
  write(root, "bin/claude", "#!/bin/sh\n");
  chmodSync(join(root, "bin", "claude"), 0o755);
  repo = join(root, "source");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  write(repo, "bun.lock", "{}\n");
  write(repo, "src/x.js", buggy);
  commit("base");
  write(repo, "src/x.js", fixed);
  write(repo, "test/helper.js", "export const expected = 5;\n");
  write(
    repo,
    "test/x.test.js",
    'import { add } from "../src/x.js";\nimport { expected } from "./helper.js";\nif (add(2, 3) !== expected) process.exit(1);\n',
  );
  fixSha = commit("fix + test\n\nadd returned the difference");
  write(repo, "README.md", "later\n");
  commit("later");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function replayInput(overrides: Record<string, unknown> = {}, task: Record<string, unknown> = {}) {
  return {
    kind: "real",
    name: "replay",
    setups: [{ harness: "claude", model: "sonnet", config: "current" }],
    trials: 1,
    wallMs: 60_000,
    repoPath: repo,
    task: {
      type: "replay",
      sha: fixSha.slice(0, 8),
      prompt: "fix add",
      hiddenPaths: ["test/helper.js", "test/x.test.js"],
      ...task,
    },
    profile: { setupCommand: null, checks: ["echo ok", "exit 3"], hiddenTestCommand: "bun {file}" },
    ...overrides,
  };
}

describe("validateRealInput", () => {
  test("normalizes a valid replay", () => {
    const input = validate(replayInput());
    expect(input.repoPath).toBe(repo);
    expect(input.task).toEqual({
      type: "replay",
      sha: fixSha,
      prompt: "fix add",
      hiddenPaths: ["test/helper.js", "test/x.test.js"],
    });
  });

  test("rejects invalid input with specific codes", () => {
    const notGit = join(root, "plain");
    mkdirSync(notGit, { recursive: true });
    expect(errorCode(() => validate(replayInput({ repoPath: notGit })))).toBe("repo_invalid");
    expect(errorCode(() => validate(replayInput({ repoPath: "relative/path" })))).toBe(
      "repo_invalid",
    );
    expect(errorCode(() => validate(replayInput({}, { sha: "0123456789abcdef" })))).toBe(
      "commit_invalid",
    );
    expect(errorCode(() => validate(replayInput({}, { hiddenPaths: ["src/other.js"] })))).toBe(
      "hidden_invalid",
    );
    expect(
      errorCode(() =>
        validate(
          replayInput({
            profile: { setupCommand: null, checks: [], hiddenTestCommand: "bun test" },
          }),
        ),
      ),
    ).toBe("hidden_command_invalid");
    expect(
      errorCode(() =>
        validate(replayInput({ setups: [{ harness: "copilot", model: "m", config: "default" }] })),
      ),
    ).toBe("config_unsupported");
    expect(
      errorCode(() =>
        validate(replayInput({}, { type: "prompt", baseRef: "no-such-branch", prompt: "x" })),
      ),
    ).toBe("commit_invalid");
    expect(errorCode(() => validate(replayInput({}, { prompt: "" })))).toBe("invalid_request");
  });
});

describe("inspectRepo", () => {
  test("lists commits, describes the commit, and suggests hidden tests", () => {
    const profiles = join(root, "profiles", "repo-profiles.json");
    const inspection = real.inspectRepo(repo, fixSha.slice(0, 7), profiles);
    expect(inspection.path).toBe(repo);
    expect(inspection.branch).toBe("main");
    expect(inspection.branches).toEqual(["main"]);
    expect(inspection.dirty).toBe(false);
    expect(inspection.recentCommits.map((c) => c.subject)).toEqual(["later", "fix + test", "base"]);
    expect(inspection.commit).toEqual({
      sha: fixSha,
      subject: "fix + test",
      body: "add returned the difference",
      files: ["src/x.js", "test/helper.js", "test/x.test.js"],
      suggestedHidden: ["test/helper.js", "test/x.test.js"],
      isMerge: false,
    });
    expect(inspection.profileSource).toBe("detected");
    expect(inspection.profile).toEqual({
      setupCommand: "bun install --frozen-lockfile",
      checks: ["bun test"],
      hiddenTestCommand: "bun test {file}",
    });
    const custom = { setupCommand: null, checks: ["true"], hiddenTestCommand: "bun {file}" };
    real.rememberProfile(profiles, repo, custom);
    const again = real.inspectRepo(repo, null, profiles);
    expect(again.profileSource).toBe("remembered");
    expect(again.profile).toEqual(custom);
    expect(again.commit).toBeNull();
  });
});

describe("prepareRealRun and real-verify", () => {
  const runDir = () => join(root, "run-1");
  let input: RealRunInput;
  let cellId: string;

  test("clones privately, writes reference, spec, and plans per group", () => {
    const refsBefore = git(repo, "for-each-ref");
    input = {
      ...validate(replayInput()),
      setups: [
        { harness: "claude", model: "sonnet", config: "current", augments: [] },
        { harness: "claude", model: "sonnet", config: "default", augments: [] },
      ],
    };
    const prepared = real.prepareRealRun(input, runDir(), {});
    const clone = join(runDir(), "repo");
    expect(prepared.baseSha).toBe(git(repo, "rev-parse", `${fixSha}^`));
    expect(prepared.taskId).toBe(`replay-${fixSha.slice(0, 7)}`);
    expect(git(clone, "rev-parse", "agent-benchmarks-base")).toBe(prepared.baseSha);
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("agent-benchmarks-base");
    expect(existsSync(join(clone, "test", "x.test.js"))).toBe(false);
    expect(git(clone, "log", "--all", "--format=%H")).not.toContain(fixSha);
    expect(git(clone, "remote")).toBe("");
    expect(git(repo, "for-each-ref")).toBe(refsBefore);
    expect(git(repo, "status", "--porcelain")).toBe("");

    const reference = JSON.parse(readFileSync(join(runDir(), "reference", "stat.json"), "utf8"));
    expect(reference).toEqual({
      baseSha: prepared.baseSha,
      sha: fixSha,
      diffStat: { files: ["src/x.js", "test/helper.js", "test/x.test.js"], added: 5, removed: 1 },
      nonHidden: { files: ["src/x.js"], added: 1, removed: 1 },
    });
    expect(readFileSync(join(runDir(), "reference", "diff.patch"), "utf8")).toContain(
      "+  return a + b;",
    );

    const [current, fallback] = prepared.groups;
    expect(current?.config).toBe("current");
    expect(current?.setups).toEqual([
      { harness: "claude", model: "sonnet", config: "current", augments: [] },
    ]);
    expect(current?.ledgerPath).toBe(join(runDir(), "ledger.jsonl"));
    expect(fallback?.config).toBe("default");
    expect(fallback?.planPath).toBeNull();
    expect(fallback?.ledgerPath).toBe(join(runDir(), "ledger.default.jsonl"));
    expect(fallback?.unavailable[0]?.reason).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(existsSync(join(runDir(), "plan.default.json"))).toBe(false);

    const plan = JSON.parse(readFileSync(current?.planPath ?? "", "utf8"));
    expect(plan).toMatchObject({
      agents: [{ agent: "claude", models: ["sonnet"] }],
      trials: 1,
      variant: "{agent}:{task}:{model}",
      budget: { wallMs: 60_000 },
    });
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({ id: prepared.taskId, prompt: "fix add", cwd: clone });
    expect(plan.tasks[0].setup).toBeUndefined();
    expect(plan.tasks[0].verify).toBe(
      `bun '${verifyScript}' '${join(runDir(), "real-spec.json")}' current`,
    );
    expect(plan.tasks[0].verifyTimeoutMs).toBeGreaterThan(0);
    cellId = `claude:${prepared.taskId}:sonnet:trial1`;
  });

  function verifyInWorktree(name: string, fix: boolean) {
    const worktree = join(root, name);
    git(join(runDir(), "repo"), "worktree", "add", "-q", "-b", name, worktree, "HEAD");
    if (fix) write(worktree, "src/x.js", fixed);
    else write(worktree, "test/x.test.js", "// the agent's own attempt at the hidden test\n");
    write(worktree, "notes.txt", "agent notes\n");
    return Bun.spawnSync(["bun", verifyScript, join(runDir(), "real-spec.json"), "current"], {
      cwd: worktree,
      env: { ...process.env, ACH_CELL_ID: cellId, ACH_WORKSPACE: worktree },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  test("a fixing cell passes its hidden test and records its diff and checks", () => {
    const run = verifyInWorktree("cell-fix", true);
    expect(run.exitCode).toBe(0);
    const artifacts = real.readCellArtifacts(runDir(), apiCellId("current", cellId));
    expect(artifacts?.patch).toContain("+  return a + b;");
    expect(artifacts?.patch).toContain("notes.txt");
    expect(artifacts?.patch).not.toContain("x.test.js");
    expect(artifacts?.checks).toEqual([
      { command: "echo ok", logTail: "ok\n" },
      { command: "exit 3", logTail: "" },
    ]);
    expect(artifacts?.hidden.map((h) => h.path)).toEqual(["test/x.test.js"]);
    expect(real.readCellArtifacts(runDir(), "reference")?.patch).toContain("x.test.js");
    expect(real.readCellArtifacts(runDir(), "current/unknown-cell")).toBeNull();

    const db = openDb(join(root, "archive.db"));
    try {
      const session = Number(
        db
          .query(
            "INSERT INTO session (tool, source_session_id, turn_count) VALUES ('claude_code', 's1', 4)",
          )
          .run().lastInsertRowid,
      );
      db.query("INSERT INTO tool_call (session_id) VALUES (?1), (?1), (?1)").run(session);
      const cell = {
        cellId: apiCellId("current", cellId),
        session: { tool: "claude_code", sourceSessionId: "s1" },
      } as EvalCell;
      const results = real.readRealResults(db, runDir(), input, [cell]);
      expect(results.reference?.nonHidden.files).toEqual(["src/x.js"]);
      const summary = results.cells[cell.cellId];
      expect(summary?.hidden).toEqual({
        passed: 1,
        total: 1,
        files: [{ path: "test/x.test.js", passed: true }],
      });
      expect(summary?.checks.map((check) => [check.exitCode, check.timedOut])).toEqual([
        [0, false],
        [3, false],
      ]);
      expect(summary?.diffStat).toEqual({ files: ["notes.txt", "src/x.js"], added: 2, removed: 1 });
      expect(summary?.fileOverlap).toBe(1);
      expect(summary?.sizeRatio).toBe(1.5);
      expect(summary?.turns).toBe(4);
      expect(summary?.toolCalls).toBe(3);
    } finally {
      closeDb(db);
    }
  });

  test("a cell without the fix fails its hidden test", () => {
    const run = verifyInWorktree("cell-nofix", false);
    expect(run.exitCode).toBe(1);
    const result = JSON.parse(
      readFileSync(join(artifactDir(runDir(), "current", cellId), "result.json"), "utf8"),
    );
    expect(result.hidden).toEqual({
      passed: 0,
      total: 1,
      files: [{ path: "test/x.test.js", passed: false }],
    });
    expect(result.diffStat.files).toEqual(["notes.txt"]);
  });
});

describe("branchPrefix", () => {
  const sonnet = { harness: "claude", model: "sonnet", config: "current" };

  test("refuses branch names that collide or already exist", () => {
    expect(
      errorCode(() =>
        validate(
          replayInput({
            setups: [
              { ...sonnet, branchPrefix: "eval/same" },
              { ...sonnet, model: "opus", branchPrefix: "eval/same" },
            ],
          }),
        ),
      ),
    ).toBe("invalid_request");
    expect(
      errorCode(() => validate(replayInput({ setups: [{ ...sonnet, branchPrefix: "main" }] }))),
    ).toBe("invalid_request");
    expect(
      errorCode(() =>
        validate(replayInput({ setups: [{ ...sonnet, branchPrefix: "bad..name" }] })),
      ),
    ).toBe("invalid_request");
  });

  test("pushes each cell's work to the repository without the hidden files", () => {
    const runDir = join(root, "run-branch");
    const input = validate(replayInput({ setups: [{ ...sonnet, branchPrefix: " eval/run " }] }));
    expect(input.setups[0]?.branchPrefix).toBe("eval/run");
    const prepared = real.prepareRealRun(input, runDir, {});
    const cell = `claude:${prepared.taskId}:sonnet:trial1`;
    const worktree = join(root, "cell-branch");
    git(join(runDir, "repo"), "worktree", "add", "-q", "-b", "cell-branch", worktree, "HEAD");
    write(worktree, "src/x.js", fixed);
    const run = Bun.spawnSync(["bun", verifyScript, join(runDir, "real-spec.json"), "current"], {
      cwd: worktree,
      env: { ...process.env, ACH_CELL_ID: cell, ACH_WORKSPACE: worktree },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(0);
    expect(git(repo, "rev-parse", "eval/run/current-t1^")).toBe(prepared.baseSha);
    expect(git(repo, "show", "eval/run/current-t1:src/x.js")).toBe(fixed.trim());
    expect(git(repo, "ls-tree", "-r", "--name-only", "eval/run/current-t1")).not.toContain(
      "x.test.js",
    );
    expect(git(repo, "status", "--porcelain")).toBe("");
  });
});

describe("config modes", () => {
  test("defaultConfigProblem explains what default mode needs", () => {
    const home = join(root, "home");
    mkdirSync(home, { recursive: true });
    expect(defaultConfigProblem("claude", {})).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(defaultConfigProblem("claude", { ANTHROPIC_API_KEY: "k" })).toBeNull();
    expect(defaultConfigProblem("omp", {})).toBe("default config is not supported for OMP");
    expect(defaultConfigProblem("codex", { HOME: home })).toBe(
      "default config needs ~/.codex/auth.json",
    );
    write(home, ".codex/auth.json", "{}");
    expect(defaultConfigProblem("codex", { HOME: home })).toBeNull();
  });

  test("cleanConfigProblem names harnesses without a clean recipe", () => {
    expect(cleanConfigProblem("claude")).toBeNull();
    expect(cleanConfigProblem("copilot")).toBe("clean config is not supported for GitHub Copilot");
  });

  test("configGroupEnv isolates the default group", () => {
    const home = join(root, "home");
    const runDir = join(root, "run-env");
    expect(configGroupEnv("current", runDir, ["claude", "codex"], home)).toEqual({
      AGENTIC_CODING_HARNESS_DEFAULT_CLAUDE_CONFIG: "1",
    });
    const env = configGroupEnv("default", runDir, ["claude", "codex"], home);
    expect(Object.hasOwn(env, "AGENTIC_CODING_HARNESS_DEFAULT_CLAUDE_CONFIG")).toBe(true);
    expect(env.AGENTIC_CODING_HARNESS_DEFAULT_CLAUDE_CONFIG).toBeUndefined();
    expect(env.CODEX_HOME).toBe(join(runDir, "home", "codex"));
    const auth = join(runDir, "home", "codex", "auth.json");
    expect(readFileSync(auth, "utf8")).toBe("{}");
    expect(statSync(auth).mode & 0o777).toBe(0o600);
  });
});
