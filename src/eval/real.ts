import type { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { EvalRequestError } from "./errors.ts";
import { artifactDir, ledgerFile, parseApiCellId, planFile } from "./paths.ts";
import {
  git,
  parseNumstat,
  type RealCellResult,
  type RealSpec,
  shellQuote,
  verifyTimeoutMs,
} from "./real-verify.ts";
import { defaultConfigProblem, EVAL_HARNESSES, EVAL_LIMITS } from "./registry.ts";
import type {
  CellArtifacts,
  EvalCell,
  EvalConfigMode,
  EvalSetup,
  RealReference,
  RealResults,
  RealRunInput,
  RealTask,
  RepoInspection,
  RepoProfile,
} from "./types.ts";

export interface RealPlanGroup {
  config: EvalConfigMode;
  planPath: string | null;
  ledgerPath: string;
  setups: EvalSetup[];
  unavailable: { setup: EvalSetup; reason: string }[];
}

const MAX_PROMPT_CHARS = 20_000;
const MAX_COMMAND_CHARS = 2_000;
const MAX_CHECKS = 10;
const LOG_TAIL_BYTES = 64 * 1024;
const HIDDEN_PATTERNS = [
  /(^|\/)(test|tests|__tests__|spec)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_test\.(go|py)$/,
  /(^|\/)test_[^/]+\.py$/,
];

export function realTaskId(task: RealTask): string {
  return task.type === "prompt" ? "prompt" : `replay-${task.sha.slice(0, 7)}`;
}

function tryGit(cwd: string, ...args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString() : null;
}

function repoRoot(path: unknown): string {
  const top =
    typeof path === "string" && isAbsolute(path) && existsSync(path)
      ? tryGit(path, "rev-parse", "--show-toplevel")
      : null;
  if (top == null)
    throw new EvalRequestError(
      "repoPath must be an absolute path to a git work tree",
      400,
      "repo_invalid",
    );
  const root = realpathSync(top.trim());
  if (tryGit(root, "rev-parse", "--verify", "-q", "HEAD") == null)
    throw new EvalRequestError("repository has no commits", 400, "repo_invalid");
  return root;
}

function resolveCommit(root: string, rev: unknown): string | null {
  if (typeof rev !== "string" || rev.trim() === "" || rev.startsWith("-")) return null;
  return tryGit(root, "rev-parse", "--verify", "-q", `${rev.trim()}^{commit}`)?.trim() ?? null;
}

function changedFiles(root: string, sha: string, ...filter: string[]): string[] {
  return git(root, "diff", "--name-only", "-z", "--no-renames", ...filter, `${sha}^`, sha)
    .split("\0")
    .filter(Boolean);
}

/** Deleted files cannot be applied at verify time, and a merge has no single change to hide. */
function hideableFiles(root: string, commit: { sha: string; isMerge: boolean }): string[] {
  return commit.isMerge ? [] : changedFiles(root, commit.sha, "--diff-filter=d");
}

function commitDetails(root: string, rev: unknown): NonNullable<RepoInspection["commit"]> {
  const sha = resolveCommit(root, rev);
  if (sha == null)
    throw new EvalRequestError(`unknown commit: ${String(rev)}`, 400, "commit_invalid");
  const [parents = "", subject = "", body = ""] = git(
    root,
    "show",
    "-s",
    "--format=%P%x00%s%x00%b",
    sha,
  ).split("\0");
  const parentCount = parents.trim().split(" ").filter(Boolean).length;
  if (parentCount === 0)
    throw new EvalRequestError(`commit ${sha.slice(0, 7)} has no parent`, 400, "commit_invalid");
  const isMerge = parentCount > 1;
  return {
    sha,
    subject,
    body: body.trim(),
    files: changedFiles(root, sha),
    suggestedHidden: hideableFiles(root, { sha, isMerge }).filter((path) =>
      HIDDEN_PATTERNS.some((pattern) => pattern.test(path)),
    ),
    isMerge,
  };
}

function detectProfile(root: string): RepoProfile {
  const has = (file: string) => existsSync(join(root, file));
  if (has("bun.lock") || has("bun.lockb"))
    return {
      setupCommand: "bun install --frozen-lockfile",
      checks: ["bun test"],
      hiddenTestCommand: "bun test {file}",
    };
  if (has("package-lock.json")) {
    const vitest =
      has("package.json") && readFileSync(join(root, "package.json"), "utf8").includes('"vitest"');
    return {
      setupCommand: "npm ci",
      checks: ["npm test"],
      hiddenTestCommand: vitest ? "npx vitest run {file}" : "npx jest {file}",
    };
  }
  if (has("pyproject.toml") || has("pytest.ini"))
    return { setupCommand: null, checks: ["pytest"], hiddenTestCommand: "pytest {file}" };
  if (has("go.mod"))
    return {
      setupCommand: null,
      checks: ["go test ./..."],
      hiddenTestCommand: "go test ./$(dirname {file})",
    };
  return { setupCommand: null, checks: [], hiddenTestCommand: null };
}

function readProfiles(profilesPath: string): Record<string, RepoProfile> {
  try {
    return JSON.parse(readFileSync(profilesPath, "utf8")) as Record<string, RepoProfile>;
  } catch {
    return {};
  }
}

export function rememberProfile(
  profilesPath: string,
  repoPath: string,
  profile: RepoProfile,
): void {
  const profiles = readProfiles(profilesPath);
  profiles[repoPath] = profile;
  mkdirSync(dirname(profilesPath), { recursive: true });
  const temp = `${profilesPath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(profiles, null, 2)}\n`);
  renameSync(temp, profilesPath);
}

export function inspectRepo(
  path: string,
  sha: string | null,
  profilesPath: string,
): RepoInspection {
  const root = repoRoot(path);
  const remembered = readProfiles(profilesPath)[root];
  return {
    path: root,
    head: git(root, "rev-parse", "HEAD").trim(),
    branch: tryGit(root, "symbolic-ref", "--short", "-q", "HEAD")?.trim() || null,
    dirty: (tryGit(root, "status", "--porcelain") ?? "").trim() !== "",
    profile: remembered ?? detectProfile(root),
    profileSource: remembered == null ? "detected" : "remembered",
    recentCommits: git(root, "log", "--no-merges", "-n", "30", "-z", "--format=%H%x1f%s%x1f%cI")
      .split("\0")
      .filter(Boolean)
      .map((record) => {
        const [commit = "", subject = "", date = ""] = record.split("\x1f");
        return { sha: commit, subject, date };
      }),
    commit: sha == null ? null : commitDetails(root, sha),
  };
}

function optionalCommand(value: unknown, field: string): string | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "string" || value.length > MAX_COMMAND_CHARS)
    throw new EvalRequestError(
      `${field} must be a string of at most ${MAX_COMMAND_CHARS} characters`,
      400,
    );
  return value.trim();
}

function validPrompt(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_PROMPT_CHARS)
    throw new EvalRequestError(
      `prompt is required and must be at most ${MAX_PROMPT_CHARS} characters`,
      400,
    );
  return value;
}

export function validateRealInput(
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env,
): RealRunInput {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw))
    throw new EvalRequestError("body must be an object", 400);
  const input = raw as Record<string, unknown>;
  if (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 120)
    throw new EvalRequestError("name is required and must be at most 120 characters", 400);
  if (
    !Array.isArray(input.setups) ||
    input.setups.length < 1 ||
    input.setups.length > EVAL_LIMITS.maxSetups
  )
    throw new EvalRequestError(`setups must contain 1..${EVAL_LIMITS.maxSetups} entries`, 400);
  const keys = new Set<string>();
  const setups: EvalSetup[] = input.setups.map((setup: Partial<EvalSetup> | null) => {
    if (setup == null || typeof setup.harness !== "string" || typeof setup.model !== "string")
      throw new EvalRequestError("each setup requires harness and model", 400);
    const definition = EVAL_HARNESSES[setup.harness];
    if (definition == null) throw new EvalRequestError(`unknown harness: ${setup.harness}`, 400);
    if (!/^[\w.:/@-]{1,128}$/.test(setup.model))
      throw new EvalRequestError("model has unsupported characters", 400);
    if (setup.config !== "current" && setup.config !== "default")
      throw new EvalRequestError("setup config must be current or default", 400);
    if (setup.config === "default" && definition.defaultConfig == null)
      throw new EvalRequestError(
        `default config is not supported for ${definition.label}`,
        400,
        "config_unsupported",
      );
    const key = `${setup.harness}:${setup.model}:${setup.config}`;
    if (keys.has(key)) throw new EvalRequestError(`duplicate setup: ${key}`, 400);
    keys.add(key);
    if (
      String(setup.harness) !== "null" &&
      Bun.which(definition.achAgent, { PATH: env.PATH ?? "" }) == null
    )
      throw new EvalRequestError(`${setup.harness} is not installed`, 503, "harness_missing");
    return { harness: setup.harness, model: setup.model, config: setup.config };
  });
  const trials = input.trials as number;
  if (!Number.isInteger(trials) || trials < 1 || trials > EVAL_LIMITS.maxTrials)
    throw new EvalRequestError(`trials must be 1..${EVAL_LIMITS.maxTrials}`, 400);
  const wallMs = input.wallMs as number;
  if (!Number.isSafeInteger(wallMs) || wallMs < 1 || wallMs > EVAL_LIMITS.maxWallMs)
    throw new EvalRequestError(`wallMs must be 1..${EVAL_LIMITS.maxWallMs}`, 400);
  const repoPath = repoRoot(input.repoPath);
  const rawProfile = (input.profile ?? {}) as Record<string, unknown>;
  const checks = rawProfile.checks ?? [];
  if (!Array.isArray(checks) || checks.length > MAX_CHECKS)
    throw new EvalRequestError(`checks must be a list of at most ${MAX_CHECKS} commands`, 400);
  const profile: RepoProfile = {
    setupCommand: optionalCommand(rawProfile.setupCommand, "setupCommand"),
    checks: checks.flatMap((check) => optionalCommand(check, "check") ?? []),
    hiddenTestCommand: optionalCommand(rawProfile.hiddenTestCommand, "hiddenTestCommand"),
  };
  const rawTask = (input.task ?? {}) as Record<string, unknown>;
  let task: RealTask;
  if (rawTask.type === "prompt") {
    const prompt = validPrompt(rawTask.prompt);
    if (resolveCommit(repoPath, rawTask.baseRef) == null)
      throw new EvalRequestError(
        `unknown base ref: ${String(rawTask.baseRef)}`,
        400,
        "commit_invalid",
      );
    task = { type: "prompt", prompt, baseRef: String(rawTask.baseRef).trim() };
  } else if (rawTask.type === "replay") {
    const commit = commitDetails(repoPath, rawTask.sha);
    const prompt = validPrompt(rawTask.prompt);
    const hiddenPaths = rawTask.hiddenPaths ?? [];
    if (!Array.isArray(hiddenPaths))
      throw new EvalRequestError("hiddenPaths must be a list", 400, "hidden_invalid");
    const allowed = new Set(hideableFiles(repoPath, commit));
    for (const path of hiddenPaths)
      if (typeof path !== "string" || !allowed.has(path))
        throw new EvalRequestError(
          `hidden path is not a file changed in ${commit.sha.slice(0, 7)}: ${String(path)}`,
          400,
          "hidden_invalid",
        );
    if (hiddenPaths.length && !profile.hiddenTestCommand?.includes("{file}"))
      throw new EvalRequestError(
        "hiddenTestCommand must contain {file}",
        400,
        "hidden_command_invalid",
      );
    task = {
      type: "replay",
      sha: commit.sha,
      prompt,
      hiddenPaths: [...new Set(hiddenPaths as string[])],
    };
  } else throw new EvalRequestError("task type must be prompt or replay", 400);
  return { kind: "real", name: input.name.trim(), setups, trials, wallMs, repoPath, task, profile };
}

export function prepareRealRun(
  input: RealRunInput,
  runDir: string,
  env: NodeJS.ProcessEnv = process.env,
): { baseSha: string; taskId: string; groups: RealPlanGroup[] } {
  const { task, profile } = input;
  const repo = join(runDir, "repo");
  const baseSha = git(
    input.repoPath,
    "rev-parse",
    "--verify",
    task.type === "replay" ? `${task.sha}^` : `${task.baseRef}^{commit}`,
  ).trim();
  mkdirSync(runDir, { recursive: true });
  git(runDir, "clone", "--quiet", "--local", input.repoPath, repo);
  git(repo, "checkout", "-q", "-B", "agent-benchmarks-base", baseSha);
  // The agent shares this object store: leave no ref, remote, or reflog that leads to later commits.
  git(repo, "remote", "remove", "origin");
  for (const ref of git(repo, "for-each-ref", "--format=%(refname)").split("\n"))
    if (ref !== "" && ref !== "refs/heads/agent-benchmarks-base")
      git(repo, "update-ref", "-d", ref);
  git(repo, "reflog", "expire", "--expire=now", "--all");
  const hiddenPaths = task.type === "replay" ? task.hiddenPaths : [];
  if (task.type === "replay") {
    mkdirSync(join(runDir, "reference"), { recursive: true });
    writeFileSync(
      join(runDir, "reference", "diff.patch"),
      git(repo, "diff", "--binary", "--no-renames", baseSha, task.sha),
    );
    const numstat = git(repo, "diff", "--numstat", "-z", "--no-renames", baseSha, task.sha);
    const reference: RealReference = {
      baseSha,
      sha: task.sha,
      diffStat: parseNumstat(numstat),
      nonHidden: parseNumstat(numstat, hiddenPaths),
    };
    writeFileSync(
      join(runDir, "reference", "stat.json"),
      `${JSON.stringify(reference, null, 2)}\n`,
    );
  }
  const specPath = join(runDir, "real-spec.json");
  const spec: RealSpec = {
    runDir,
    baseSha,
    sha: task.type === "replay" ? task.sha : null,
    hiddenPaths,
    profile,
  };
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  const taskId = realTaskId(task);
  const verifyScript = join(import.meta.dir, "real-verify.ts");
  const groups = (["current", "default"] as const).flatMap((config): RealPlanGroup[] => {
    const chosen = input.setups.filter((setup) => setup.config === config);
    if (chosen.length === 0) return [];
    const unavailable = chosen.flatMap((setup) => {
      const reason = config === "default" ? defaultConfigProblem(setup.harness, env) : null;
      return reason == null ? [] : [{ setup, reason }];
    });
    const setups = chosen.filter((setup) => !unavailable.some((item) => item.setup === setup));
    const planPath = setups.length ? join(runDir, planFile[config]) : null;
    if (planPath != null) {
      const plan = {
        experiment: `agent-benchmarks-eval-${basename(runDir)}`,
        agents: setups.map((setup) => ({
          agent: EVAL_HARNESSES[setup.harness]?.achAgent ?? setup.harness,
          models: [setup.model],
        })),
        tasks: [
          {
            id: taskId,
            prompt: task.prompt,
            cwd: repo,
            ...(profile.setupCommand == null ? {} : { setup: profile.setupCommand }),
            verify: `bun ${shellQuote(verifyScript)} ${shellQuote(specPath)} ${config}`,
            verifyTimeoutMs: verifyTimeoutMs(profile.checks.length + hiddenPaths.length),
          },
        ],
        trials: input.trials,
        variant: "{agent}:{task}:{model}",
        budget: { wallMs: input.wallMs },
      };
      writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    }
    return [
      { config, planPath, ledgerPath: join(runDir, ledgerFile[config]), setups, unavailable },
    ];
  });
  return { baseSha, taskId, groups };
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

export function readRealResults(
  db: Database,
  runDir: string,
  input: RealRunInput,
  cells: EvalCell[],
): RealResults {
  const spec = JSON.parse(readFileSync(join(runDir, "real-spec.json"), "utf8")) as RealSpec;
  const reference =
    input.task.type === "replay"
      ? readJson<RealReference>(join(runDir, "reference", "stat.json"))
      : null;
  const sessionStats = db.query<{ turns: number; toolCalls: number }, [string, string]>(
    `SELECT s.turn_count AS turns, (SELECT count(*) FROM tool_call t WHERE t.session_id = s.id) AS toolCalls
     FROM session s WHERE s.tool = ?1 AND s.source_session_id = ?2`,
  );
  const human = reference?.nonHidden;
  const humanLines = human == null ? 0 : human.added + human.removed;
  const summaries: RealResults["cells"] = {};
  for (const cell of cells) {
    // ach still runs verify after an unavailable agent; that untouched workspace says nothing about the combo.
    if (cell.outcome === "unavailable") continue;
    const id = parseApiCellId(cell.cellId);
    const result =
      id == null
        ? null
        : readJson<RealCellResult>(
            join(artifactDir(runDir, id.config, id.achCellId), "result.json"),
          );
    if (result == null) continue;
    const stats =
      cell.session == null
        ? null
        : sessionStats.get(cell.session.tool, cell.session.sourceSessionId);
    const agentFiles = new Set(result.diffStat.files);
    summaries[cell.cellId] = {
      ...result,
      fileOverlap: human?.files.length
        ? human.files.filter((file) => agentFiles.has(file)).length / human.files.length
        : null,
      sizeRatio: humanLines ? (result.diffStat.added + result.diffStat.removed) / humanLines : null,
      turns: stats?.turns ?? null,
      toolCalls: stats?.toolCalls ?? null,
    };
  }
  return {
    task: input.task,
    repoPath: input.repoPath,
    baseSha: spec.baseSha,
    profile: input.profile,
    reference,
    cells: summaries,
  };
}

function logTail(path: string): string {
  if (!existsSync(path)) return "";
  const bytes = readFileSync(path);
  return bytes.subarray(Math.max(0, bytes.length - LOG_TAIL_BYTES)).toString("utf8");
}

export function readCellArtifacts(
  runDir: string,
  apiCellIdOrReference: string,
): CellArtifacts | null {
  if (apiCellIdOrReference === "reference") {
    const patch = join(runDir, "reference", "diff.patch");
    return existsSync(patch)
      ? { patch: readFileSync(patch, "utf8"), checks: [], hidden: [] }
      : null;
  }
  const id = parseApiCellId(apiCellIdOrReference);
  if (id == null) return null;
  const dir = artifactDir(runDir, id.config, id.achCellId);
  if (!existsSync(join(dir, "diff.patch"))) return null;
  const result = readJson<RealCellResult>(join(dir, "result.json"));
  return {
    patch: readFileSync(join(dir, "diff.patch"), "utf8"),
    checks: (result?.checks ?? []).map((check) => ({
      command: check.command,
      logTail: logTail(join(runDir, check.log)),
    })),
    hidden: (result?.hidden?.files ?? []).map((file, index) => ({
      path: file.path,
      logTail: logTail(join(dir, "hidden", `${index}.log`)),
    })),
  };
}
