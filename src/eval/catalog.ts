import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAchDir } from "../settings.ts";
import { defaultConfigProblem, EVAL_HARNESSES, EVAL_LIMITS, EVAL_PRESETS } from "./registry.ts";
import type { EvalCatalog, EvalHarnessInfo, EvalTask } from "./types.ts";

export async function readCatalog(db: Database, activeRunId: string | null): Promise<EvalCatalog> {
  const achDir = getAchDir();
  const checkout = checkAchCheckout(achDir);
  return {
    ach: {
      dir: achDir,
      ok: checkout.ok,
      problem: checkout.problem,
      commit: checkout.commit,
    },
    harnesses: await Promise.all(
      Object.entries(EVAL_HARNESSES).map(async ([harness, definition]) => {
        const installed = harness === "null" || Bun.which(definition.achAgent) != null;
        const version = installed
          ? await commandVersion(definition.achAgent, definition.versionArgs)
          : null;
        return {
          harness,
          label: definition.label,
          installed,
          version,
          knownModels: knownModels(db, definition.sessionTool, definition.qualifiedModels),
          metered: definition.metered,
          defaultConfigProblem: defaultConfigProblem(harness, process.env),
        } as EvalHarnessInfo;
      }),
    ),
    tasks: checkout.ok ? readEvalTasks(achDir).map((source) => source.task) : [],
    presets: Object.values(EVAL_PRESETS),
    limits: { ...EVAL_LIMITS },
    activeRunId,
  };
}

export const BUNDLED_TASKS_DIR = join(import.meta.dir, "..", "..", "evals", "tasks");

export interface EvalTaskSource {
  task: EvalTask;
  dir: string;
}

export function readEvalTasks(achDir: string): EvalTaskSource[] {
  return [...tasksFrom(join(achDir, "tasks")), ...tasksFrom(BUNDLED_TASKS_DIR)];
}

function checkAchCheckout(achDir: string): {
  ok: boolean;
  problem: string | null;
  commit: string | null;
} {
  if (!existsSync(join(achDir, "src", "cli", "ach.ts"))) {
    return {
      ok: false,
      problem: `Set achDir to an agentic-coding-harness checkout (missing ${achDir}/src/cli/ach.ts).`,
      commit: null,
    };
  }
  if (!existsSync(join(achDir, "node_modules"))) {
    return { ok: false, problem: `Run \`bun install\` in ${achDir}.`, commit: null };
  }
  return { ok: true, problem: null, commit: gitCommit(achDir) };
}

function tasksFrom(root: string): EvalTaskSource[] {
  if (!existsSync(root)) return [];
  const tasks: EvalTaskSource[] = [];
  for (const id of readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const dir = join(root, id);
    if (!existsSync(join(dir, "task.md")) || !existsSync(join(dir, "verify.sh"))) continue;
    try {
      const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Record<
        string,
        unknown
      >;
      const declaredId = typeof meta.id === "string" ? meta.id : id;
      const language = typeof meta.language === "string" ? meta.language : "unknown";
      tasks.push({
        dir,
        task: {
          id: declaredId,
          language,
          category: typeof meta.category === "string" ? meta.category : language,
          description: typeof meta.description === "string" ? meta.description : id,
          suites: Array.isArray(meta.suites)
            ? meta.suites.filter((value): value is string => typeof value === "string")
            : [],
        },
      });
    } catch (error) {
      console.error(`[eval/catalog] ${id}: ignoring invalid meta.json`, error);
    }
  }
  return tasks;
}

function knownModels(db: Database, tool: string, qualified: boolean): string[] {
  const choice = qualified
    ? "CASE WHEN provider IS NULL OR provider = '' THEN model ELSE provider || '/' || model END"
    : "model";
  return db
    .query<{ choice: string }, [string]>(
      `SELECT ${choice} AS choice FROM session
     WHERE tool = ? AND model IS NOT NULL AND model NOT IN ('', '<synthetic>')
     GROUP BY choice ORDER BY COUNT(*) DESC, choice LIMIT 15`,
    )
    .all(tool)
    .map((row) => row.choice);
}

function gitCommit(cwd: string): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd });
  return result.exitCode === 0 ? result.stdout.toString().trim() || null : null;
}

async function commandVersion(command: string, args: readonly string[]): Promise<string | null> {
  if (command === "null") return "negative-control";
  const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 5_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  if (exitCode !== 0) {
    console.error(`[eval/catalog] ${command} version failed (${exitCode}): ${stderr.trim()}`);
    return null;
  }
  return `${stdout}${stderr}`.trim().split(/\r?\n/, 1)[0] || null;
}
