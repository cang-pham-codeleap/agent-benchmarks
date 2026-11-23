import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { apiCellId, artifactDir, isGroupKey } from "./paths.ts";
import type { CheckResult, DiffStat, RealCellSummary, RepoProfile } from "./types.ts";

export interface RealSpec {
  runDir: string;
  repoPath: string;
  baseSha: string;
  /** Replay commit; null for prompt tasks. */
  sha: string | null;
  hiddenPaths: string[];
  profile: RepoProfile;
  /** API cell id to the branch its result is pushed to; absent in specs written before branches existed. */
  branches?: Record<string, string>;
}

export type RealCellResult = Pick<RealCellSummary, "diffStat" | "checks" | "hidden">;

/** Total time for one cell's checks and hidden tests; each command gets an equal share of what remains. */
export const VERIFY_BUDGET_MS = 30 * 60_000;
const MIN_COMMAND_MS = 60_000;
const MAX_COMMAND_MS = 15 * 60_000;
const GIT_SLACK_MS = 60_000;

export function verifyBudgetMs(commands: number): number {
  return Math.max(VERIFY_BUDGET_MS, commands * MIN_COMMAND_MS);
}

export function verifyTimeoutMs(commands: number): number {
  return verifyBudgetMs(commands) + GIT_SLACK_MS;
}

/** Hidden files to run: the test-named ones when any exist, so helpers and goldens are only checked out; otherwise every hidden file. */
export function hiddenTestsToRun(paths: readonly string[]): string[] {
  const named = paths.filter((path) =>
    /(\.(test|spec)\.[^/]+|_test\.[^/]+|(^|\/)test_[^/]+\.py)$/.test(path),
  );
  return named.length ? named : [...paths];
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

export function parseNumstat(numstatZ: string, exclude: readonly string[] = []): DiffStat {
  const stat: DiffStat = { files: [], added: 0, removed: 0 };
  for (const record of numstatZ.split("\0")) {
    const [added, removed, ...path] = record.split("\t");
    if (removed == null || exclude.includes(path.join("\t"))) continue;
    stat.files.push(path.join("\t"));
    stat.added += Number(added) || 0;
    stat.removed += Number(removed) || 0;
  }
  return stat;
}

async function runCommand(
  command: string,
  cwd: string,
  logPath: string,
  timeoutMs: number,
): Promise<Omit<CheckResult, "log">> {
  const started = Date.now();
  const fd = openSync(logPath, "w");
  try {
    const child = Bun.spawn(["/bin/sh", "-c", command], {
      cwd,
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
      detached: true,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    await child.exited;
    clearTimeout(timer);
    return {
      command,
      exitCode: timedOut ? null : child.exitCode,
      timedOut,
      durationMs: Date.now() - started,
    };
  } finally {
    closeSync(fd);
  }
}

export async function verifyCell(
  spec: RealSpec,
  group: string,
  cellId: string,
  workspace: string,
): Promise<RealCellResult> {
  const dir = artifactDir(spec.runDir, group, cellId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "checks"), { recursive: true });
  mkdirSync(join(dir, "hidden"), { recursive: true });
  git(workspace, "add", "-A");
  const branch = spec.branches?.[apiCellId(group, cellId)];
  if (branch != null) {
    try {
      const tree = git(workspace, "write-tree").trim();
      const commit = git(
        workspace,
        "-c",
        "user.name=Agent Benchmarks",
        "-c",
        "user.email=agent-benchmarks@localhost",
        "commit-tree",
        tree,
        "-p",
        spec.baseSha,
        "-m",
        `agent-benchmarks ${apiCellId(group, cellId)}`,
      ).trim();
      git(workspace, "push", "-q", spec.repoPath, `${commit}:refs/heads/${branch}`);
    } catch (error) {
      console.error(`could not write branch ${branch}:`, error);
    }
  }
  writeFileSync(
    join(dir, "diff.patch"),
    git(workspace, "diff", "--cached", "--binary", "--no-renames", spec.baseSha),
  );
  const hiddenPaths = spec.sha == null ? [] : spec.hiddenPaths;
  // Matches the human reference, whose stats also leave out the hidden tests.
  const diffStat = parseNumstat(
    git(workspace, "diff", "--cached", "--numstat", "-z", "--no-renames", spec.baseSha),
    hiddenPaths,
  );
  const toRun = hiddenTestsToRun(hiddenPaths);
  const total = spec.profile.checks.length + toRun.length;
  const deadline = Date.now() + verifyBudgetMs(total);
  let left = total;
  const timeout = () =>
    Math.min(MAX_COMMAND_MS, Math.max(MIN_COMMAND_MS, (deadline - Date.now()) / left--));
  const checks: CheckResult[] = [];
  for (const [index, command] of spec.profile.checks.entries()) {
    const log = join(dir, "checks", `${index}.log`);
    checks.push({
      ...(await runCommand(command, workspace, log, timeout())),
      log: relative(spec.runDir, log),
    });
  }
  if (spec.sha == null) return { diffStat, checks, hidden: null };
  if (hiddenPaths.length) git(workspace, "checkout", spec.sha, "--", ...hiddenPaths);
  const files: { path: string; passed: boolean }[] = [];
  for (const [index, path] of toRun.entries()) {
    const command = (spec.profile.hiddenTestCommand ?? "").replaceAll("{file}", shellQuote(path));
    const run = await runCommand(
      command,
      workspace,
      join(dir, "hidden", `${index}.log`),
      timeout(),
    );
    files.push({ path, passed: run.exitCode === 0 });
  }
  return {
    diffStat,
    checks,
    hidden: { passed: files.filter((file) => file.passed).length, total: files.length, files },
  };
}

if (import.meta.main) {
  try {
    const specPath = process.argv[2] ?? process.env.AGENT_BENCHMARKS_REAL_SPEC;
    const group = process.argv[3] ?? process.env.AGENT_BENCHMARKS_REAL_GROUP;
    const cellId = process.env.ACH_CELL_ID;
    if (specPath == null || group == null || !isGroupKey(group) || cellId == null)
      throw new Error(
        "usage: real-verify.ts <real-spec.json> <run group key> with ACH_CELL_ID set",
      );
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as RealSpec;
    const result = await verifyCell(
      spec,
      group,
      cellId,
      process.env.ACH_WORKSPACE ?? process.cwd(),
    );
    writeFileSync(
      join(artifactDir(spec.runDir, group, cellId), "result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    process.exit(result.hidden == null || result.hidden.passed === result.hidden.total ? 0 : 1);
  } catch (error) {
    console.error(error);
    // A signal makes ach record verify "error" (excluded from pass rates) instead of a graded "fail".
    process.kill(process.pid, "SIGABRT");
  }
}
