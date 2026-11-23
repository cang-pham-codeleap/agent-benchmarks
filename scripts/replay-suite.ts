import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git, hiddenTestsToRun, shellQuote } from "../src/eval/real-verify.ts";

interface ReplayTask {
  id: string;
  sha: string;
  hiddenPaths: string[];
  prompt: string;
}

interface Suite {
  setupCommand: string;
  hiddenTestCommand: string;
  checks: string[];
  tasks: ReplayTask[];
}

const usage = `usage:
  bun scripts/replay-suite.ts check <suite.json> [taskId...]
  bun scripts/replay-suite.ts run <suite.json> --setups '<json>' [--trials 3] [--wall-ms 1800000] [--url http://localhost:4711] [taskId...]`;

function sh(command: string, cwd: string, timeoutMs = 15 * 60_000): { ok: boolean; tail: string } {
  const result = Bun.spawnSync(["sh", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const out = `${result.stdout.toString()}${result.stderr.toString()}`;
  return { ok: result.exitCode === 0, tail: out.split("\n").slice(-6).join("\n") };
}

function hiddenRun(suite: Suite, dir: string, paths: string[]): boolean[] {
  return hiddenTestsToRun(paths).map(
    (path) => sh(suite.hiddenTestCommand.replaceAll("{file}", shellQuote(path)), dir).ok,
  );
}

/** A replay task is usable when its hidden tests fail on the parent commit and pass on the commit. */
function check(repo: string, suite: Suite, task: ReplayTask): string {
  const dir = mkdtempSync(join(tmpdir(), `replay-${task.id}-`));
  git(repo, "worktree", "add", "--detach", "--quiet", "--force", dir, `${task.sha}^`);
  try {
    const setup = sh(suite.setupCommand, dir);
    if (!setup.ok) return `setup failed\n${setup.tail}`;
    git(dir, "checkout", task.sha, "--", ...task.hiddenPaths);
    const atBase = hiddenRun(suite, dir, task.hiddenPaths);
    git(dir, "checkout", task.sha, "--", ".");
    const atSha = hiddenRun(suite, dir, task.hiddenPaths);
    const verdict = atBase.some((ok) => !ok) && atSha.every(Boolean) ? "ok" : "unusable";
    return `${verdict} base=${atBase.map(Number).join("")} sha=${atSha.map(Number).join("")}`;
  } finally {
    git(repo, "worktree", "remove", "--force", dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function run(suite: Suite, tasks: ReplayTask[], args: Map<string, string>, repo: string) {
  const url = args.get("--url") ?? "http://localhost:4711";
  const setups = JSON.parse(args.get("--setups") ?? "null");
  if (!Array.isArray(setups)) throw new Error("--setups must be a JSON array");
  const headers = { "content-type": "application/json", origin: url };
  for (const task of tasks) {
    // Groups run in request order; rotating it by the task's place in the suite spreads provider drift across arms.
    const shift = suite.tasks.indexOf(task);
    const order = setups.map((_, i) => setups[(i + shift) % setups.length]);
    let body: { id?: string; code?: string } = {};
    for (;;) {
      const response = await fetch(`${url}/api/evals`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          kind: "real",
          name: `replay ${task.id}`,
          setups: order,
          trials: Number(args.get("--trials") ?? 3),
          wallMs: Number(args.get("--wall-ms") ?? 30 * 60_000),
          repoPath: repo,
          task: {
            type: "replay",
            sha: task.sha,
            prompt: task.prompt,
            hiddenPaths: task.hiddenPaths,
          },
          profile: {
            setupCommand: suite.setupCommand,
            checks: suite.checks,
            hiddenTestCommand: suite.hiddenTestCommand,
          },
        }),
      });
      body = (await response.json()) as typeof body;
      if (body.code !== "eval_active") break;
      await Bun.sleep(60_000);
    }
    if (body.id == null) throw new Error(`${task.id}: ${JSON.stringify(body)}`);
    console.log(`${task.id} ${body.id} started`);
    for (;;) {
      await Bun.sleep(60_000);
      const state = (await (await fetch(`${url}/api/evals/${body.id}`)).json()) as {
        manifest: { status: string };
      };
      if (state.manifest.status !== "running") {
        console.log(`${task.id} ${body.id} ${state.manifest.status}`);
        break;
      }
    }
  }
}

const [command, suitePath, ...rest] = process.argv.slice(2);
if ((command !== "check" && command !== "run") || suitePath == null) {
  console.error(usage);
  process.exit(2);
}
const suite = JSON.parse(readFileSync(suitePath, "utf8")) as Suite;
const args = new Map<string, string>();
const only: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i] ?? "";
  if (arg.startsWith("--")) args.set(arg, rest[++i] ?? "");
  else only.push(arg);
}
const tasks = suite.tasks.filter((task) => only.length === 0 || only.includes(task.id));
const repo = resolve(git(process.cwd(), "rev-parse", "--show-toplevel").trim());
if (command === "check")
  for (const task of tasks) console.log(`${task.id} ${check(repo, suite, task)}`);
else await run(suite, tasks, args, repo);
