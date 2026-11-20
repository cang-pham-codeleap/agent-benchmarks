import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { FileSink } from "bun";
import type { Config } from "../config.ts";
import type { RequestContext } from "../server/context.ts";
import { publishServerEvent } from "../server/sse.ts";
import { syncNow } from "../server/sync.ts";
import { getAchDir } from "../settings.ts";
import { readEvalTasks } from "./catalog.ts";
import { repairTornLedger } from "./ledger.ts";
import { EVAL_HARNESSES, EVAL_LIMITS } from "./registry.ts";
import type { EvalRunInput, EvalRunManifest, EvalRunStatus } from "./types.ts";

const transitions: Record<EvalRunStatus, EvalRunStatus[]> = {
  running: ["completed", "failed", "cancelled", "cancel-incomplete", "interrupted"],
  completed: [],
  failed: [],
  cancelled: ["running"],
  "cancel-incomplete": ["cancelled"],
  interrupted: ["running"],
};

const watchers = new Map<string, { close(): void }>();
const children = new Map<string, Bun.Subprocess>();
const currentCells = new Map<string, string | null>();
const cancelling = new Set<string>();
let starting = false;
let initialized = false;

export class EvalRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "invalid_request",
  ) {
    super(message);
  }
}

export function evalDataDir(dbPath: string): string {
  return join(dirname(dbPath), "evals");
}

export function listRunManifests(dbPath: string): EvalRunManifest[] {
  initializeRunner(dbPath);
  const root = evalDataDir(dbPath);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readManifest(join(root, entry.name)))
    .filter((manifest): manifest is EvalRunManifest => manifest != null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readRunManifest(dbPath: string, id: string): EvalRunManifest | null {
  initializeRunner(dbPath);
  const root = evalDataDir(dbPath);
  const dir = runDirFor(dbPath, id);
  if (!existsSync(root) || !existsSync(dir)) return null;
  return readManifest(dir);
}

export function runDirFor(dbPath: string, id: string): string {
  if (!/^[0-9A-Za-z_-]{8,128}$/.test(id)) throw new EvalRequestError("invalid run id", 400);
  return join(evalDataDir(dbPath), id);
}

export function startEvalRun(
  config: Config,
  context: RequestContext,
  raw: unknown,
): Promise<EvalRunManifest> {
  initializeRunner(config.dbPath);
  if (starting) throw new EvalRequestError("an evaluation is already starting", 409, "eval_active");
  starting = true;
  return startEvalRunUnlocked(config, context, raw).finally(() => {
    starting = false;
  });
}

async function startEvalRunUnlocked(
  config: Config,
  context: RequestContext,
  raw: unknown,
): Promise<EvalRunManifest> {
  const achDir = getAchDir();
  if (listRunManifests(config.dbPath).some((manifest) => manifest.status === "running")) {
    throw new EvalRequestError("an evaluation is already running", 409, "eval_active");
  }
  const checkoutCli = join(achDir, "src", "cli", "ach.ts");
  if (!existsSync(checkoutCli))
    throw new EvalRequestError(
      `ach checkout is missing at ${achDir}; update Settings → achDir`,
      503,
      "ach_missing",
    );
  if (!existsSync(join(achDir, "node_modules")))
    throw new EvalRequestError(`run \`bun install\` in ${achDir}`, 503, "ach_not_installed");
  const input = validateInput(raw, achDir);
  const id = crypto.randomUUID();
  const runDir = runDirFor(config.dbPath, id);
  for (const dir of [
    join(runDir, "tasks"),
    join(runDir, "ach-state", "agents.d"),
    join(runDir, "cwd"),
  ])
    mkdirSync(dir, { recursive: true });
  const taskHashes: Record<string, string> = {};
  for (const taskId of input.taskIds) {
    const source = join(achDir, "tasks", taskId);
    const target = join(runDir, "tasks", taskId);
    cpSync(source, target, { recursive: true });
    taskHashes[taskId] = hashTree(target);
  }
  const descriptors = input.setups
    .map((setup) => EVAL_HARNESSES[setup.harness]?.descriptor)
    .filter(
      (descriptor): descriptor is { name: string } =>
        descriptor != null && "name" in descriptor && typeof descriptor.name === "string",
    );
  for (const descriptor of descriptors)
    writeFileSync(
      join(runDir, "ach-state", "agents.d", `${descriptor.name}.json`),
      `${JSON.stringify(descriptor, null, 2)}\n`,
    );
  const hermeticRoot = `/private/tmp/agent-benchmarks-hermetic/${id}`;
  const plan = {
    experiment: `agent-benchmarks-eval-${id}`,
    agents: input.setups.map((setup) => ({
      agent: EVAL_HARNESSES[setup.harness]!.achAgent,
      models: [setup.model],
    })),
    tasks: input.taskIds.map((taskId) => ({ dir: join(runDir, "tasks", taskId) })),
    trials: input.trials,
    variant: "{agent}:{task}:{model}",
    budget: { wallMs: input.wallMs },
  };
  writeFileSync(join(runDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  const harnessVersions: EvalRunManifest["provenance"]["harnessVersions"] = {};
  for (const setup of input.setups) {
    harnessVersions[setup.harness] =
      (await versionOf(
        EVAL_HARNESSES[setup.harness]!.achAgent,
        EVAL_HARNESSES[setup.harness]!.versionArgs,
      )) ?? undefined;
  }
  const manifest: EvalRunManifest = {
    id,
    createdAt: new Date().toISOString(),
    input,
    status: "running",
    pid: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    error: null,
    survivors: [],
    provenance: {
      achDir,
      achCommit: gitValue(achDir, "rev-parse", "HEAD") ?? "unknown",
      achDirty: (gitValue(achDir, "status", "--porcelain") ?? "") !== "",
      harnessVersions,
      taskHashes,
      executionOrder: plan.agents.flatMap((agent) =>
        input.taskIds.flatMap((task) =>
          agent.models.flatMap((model) =>
            Array.from(
              { length: input.trials },
              (_, trial) => `${agent.agent} → ${task} → ${model} → ${trial + 1}`,
            ),
          ),
        ),
      ),
      hermeticRoot,
      globalConfigNote:
        "User-global harness configuration (~/.claude, ~/.omp, and peers) is part of the harness under test.",
    },
  };
  writeManifest(runDir, manifest);
  try {
    spawnRun(config, context, runDir, manifest, false);
  } catch (error) {
    updateRun(
      runDir,
      manifest,
      "failed",
      1,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
  return manifest;
}

export async function cancelEvalRun(dbPath: string, id: string): Promise<EvalRunManifest> {
  const manifest = requireRun(dbPath, id);
  if (manifest.status !== "running")
    throw new EvalRequestError("run is not running", 409, "eval_not_running");
  cancelling.add(id);
  const pid = manifest.pid;
  if (pid != null) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      console.error(`[eval/cancel] failed SIGTERM for ${id} pgid ${pid}`, error);
    }
  }
  await Bun.sleep(5000);
  const survivors = evalSurvivors(manifest);
  for (const survivor of survivors) {
    try {
      process.kill(survivor, "SIGKILL");
    } catch (error) {
      console.error(`[eval/cancel] failed SIGKILL for ${id} pid ${survivor}`, error);
    }
  }
  await Bun.sleep(250);
  const latest = readRunManifest(dbPath, id);
  if (latest != null && latest.status !== "running") {
    cancelling.delete(id);
    return latest;
  }
  const remaining = evalSurvivors(manifest);
  const next: EvalRunStatus = remaining.length === 0 ? "cancelled" : "cancel-incomplete";
  updateRun(runDirFor(dbPath, id), latest ?? manifest, next, null, "cancelled by user", remaining);
  publishProgress(dbPath, id);
  cancelling.delete(id);
  return readRunManifest(dbPath, id)!;
}

export function resumeEvalRun(
  config: Config,
  context: RequestContext,
  id: string,
  retryFailed = false,
): EvalRunManifest {
  const manifest = requireRun(config.dbPath, id);
  if (!["cancelled", "interrupted"].includes(manifest.status))
    throw new EvalRequestError(
      "only cancelled or interrupted runs can be resumed",
      409,
      "eval_not_resumable",
    );
  const survivors = evalSurvivors(manifest);
  if (survivors.length)
    throw new EvalRequestError(
      `run still has surviving pids: ${survivors.join(", ")}`,
      409,
      "eval_survivors",
    );
  const runDir = runDirFor(config.dbPath, id);
  repairTornLedger(runDir);
  transition(manifest.status, "running");
  const next = {
    ...manifest,
    status: "running" as const,
    pid: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    error: null,
    survivors: [],
  };
  writeManifest(runDir, next);
  try {
    spawnRun(config, context, runDir, next, retryFailed);
  } catch (error) {
    updateRun(runDir, next, "failed", 1, error instanceof Error ? error.message : String(error));
    throw error;
  }
  return next;
}

export function activeRunId(dbPath: string): string | null {
  return listRunManifests(dbPath).find((run) => run.status === "running")?.id ?? null;
}

export function evalProgress(
  dbPath: string,
  run: EvalRunManifest,
): { done: number; total: number; currentCell: string | null } {
  const ledger = join(runDirFor(dbPath, run.id), "ledger.jsonl");
  const cellIds = existsSync(ledger)
    ? readFileSync(ledger, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .flatMap((line) => {
          try {
            return [String((JSON.parse(line) as { cellId: unknown }).cellId)];
          } catch (error) {
            console.error(
              `[eval/runner] malformed ledger row while reading progress for ${run.id}`,
              error,
            );
            return [];
          }
        })
    : [];
  return {
    done: new Set(cellIds).size,
    total: run.input.setups.length * run.input.taskIds.length * run.input.trials,
    currentCell: currentCells.get(run.id) ?? null,
  };
}

function initializeRunner(dbPath: string): void {
  if (initialized) return;
  initialized = true;
  mkdirSync(evalDataDir(dbPath), { recursive: true });
  for (const entry of readdirSync(evalDataDir(dbPath), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readManifest(join(evalDataDir(dbPath), entry.name));
    if (manifest?.status === "running" && (manifest.pid == null || !processExists(manifest.pid))) {
      updateRun(
        join(evalDataDir(dbPath), entry.name),
        manifest,
        "interrupted",
        manifest.pid == null ? 1 : null,
        "runner process is not alive",
      );
    }
  }
}

function spawnRun(
  config: Config,
  context: RequestContext,
  runDir: string,
  manifest: EvalRunManifest,
  retryFailed: boolean,
): void {
  const args = [
    "bun",
    "run",
    join(manifest.provenance.achDir, "src", "cli", "ach.ts"),
    "trial",
    "--matrix",
    join(runDir, "plan.json"),
    "--ledger",
    join(runDir, "ledger.jsonl"),
    "--hermetic",
  ];
  if (retryFailed) args.push("--retry-failed");
  mkdirSync(manifest.provenance.hermeticRoot, { recursive: true });
  const log = Bun.file(join(runDir, "ach.log")).writer();
  const child = Bun.spawn(args, {
    cwd: join(runDir, "cwd"),
    detached: true,
    env: {
      ...process.env,
      AGENTIC_CODING_HARNESS_STATE_DIR: join(runDir, "ach-state"),
      AGENTIC_CODING_HARNESS_HERMETIC_ROOT: manifest.provenance.hermeticRoot,
      AGENT_BENCHMARKS_EVAL_RUN: manifest.id,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  manifest.pid = child.pid;
  writeManifest(runDir, manifest);
  children.set(manifest.id, child);
  void pipeOutput(child.stdout, log, manifest.id, false).catch((error) =>
    console.error(`[eval/runner] stdout pipe failed for ${manifest.id}`, error),
  );
  void pipeOutput(child.stderr, log, manifest.id, true).catch((error) =>
    console.error(`[eval/runner] stderr pipe failed for ${manifest.id}`, error),
  );
  installLedgerWatch(config.dbPath, runDir, manifest.id);
  void child.exited
    .then(async (exitCode) => {
      children.delete(manifest.id);
      watchers.get(manifest.id)?.close();
      watchers.delete(manifest.id);
      if (cancelling.has(manifest.id)) {
        await log.end();
        return;
      }
      const latest = readManifest(runDir);
      if (latest == null || latest.status !== "running") return;
      const status = exitCode === 0 ? "completed" : "failed";
      updateRun(runDir, latest, status, exitCode, exitCode === 0 ? null : `ach exited ${exitCode}`);
      publishProgress(config.dbPath, latest.id);
      try {
        await syncNow(
          config,
          context.economics,
          context.runSync,
          context.syncCoordinator?.runWithOwnership,
        );
      } catch (error) {
        console.error(`[eval/sync] post-run sync failed for ${latest.id}`, error);
      }
      await log.end();
    })
    .catch(async (error) => {
      console.error(`[eval/runner] child failed for ${manifest.id}`, error);
      await log.end();
    });
}

function installLedgerWatch(dbPath: string, runDir: string, id: string): void {
  watchers.get(id)?.close();
  let last = "";
  const poll = setInterval(() => emit(), 2000);
  const ledgerWatch = existsSync(runDir) ? watch(runDir, () => emit()) : null;
  watchers.set(id, {
    close() {
      clearInterval(poll);
      ledgerWatch?.close();
    },
  });
  function emit() {
    const path = join(runDir, "ledger.jsonl");
    const body = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (body === last) return;
    last = body;
    publishProgress(dbPath, id);
  }
}

function publishProgress(dbPath: string, id: string): void {
  const run = readRunManifest(dbPath, id);
  if (run == null) return;
  publishServerEvent({
    type: "eval_progress",
    ...evalProgress(dbPath, run),
    runId: id,
    status: run.status,
  });
}

function transition(from: EvalRunStatus, to: EvalRunStatus): void {
  if (!transitions[from].includes(to))
    throw new Error(`invalid evaluation transition ${from} -> ${to}`);
}

function updateRun(
  runDir: string,
  manifest: EvalRunManifest,
  status: EvalRunStatus,
  exitCode: number | null,
  error: string | null,
  survivors: number[] = [],
): void {
  transition(manifest.status, status);
  writeManifest(runDir, {
    ...manifest,
    status,
    pid: status === "running" ? manifest.pid : null,
    endedAt: status === "running" ? null : new Date().toISOString(),
    exitCode,
    error,
    survivors,
  });
}

function validateInput(raw: unknown, achDir: string): EvalRunInput {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw))
    throw new EvalRequestError("body must be an object", 400);
  const input = raw as Partial<EvalRunInput>;
  if (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 120)
    throw new EvalRequestError("name is required and must be at most 120 characters", 400);
  if (
    !Array.isArray(input.setups) ||
    input.setups.length < 1 ||
    input.setups.length > EVAL_LIMITS.maxSetups
  )
    throw new EvalRequestError(`setups must contain 1..${EVAL_LIMITS.maxSetups} entries`, 400);
  const keys = new Set<string>();
  for (const setup of input.setups) {
    if (
      setup == null ||
      typeof setup !== "object" ||
      typeof setup.harness !== "string" ||
      typeof setup.model !== "string"
    )
      throw new EvalRequestError("each setup requires harness and model", 400);
    if (EVAL_HARNESSES[setup.harness] == null)
      throw new EvalRequestError(`unknown harness: ${setup.harness}`, 400);
    if (!/^[\w.:/@-]{1,128}$/.test(setup.model))
      throw new EvalRequestError("model has unsupported characters", 400);
    const key = `${setup.harness}:${setup.model}`;
    if (keys.has(key)) throw new EvalRequestError(`duplicate setup: ${key}`, 400);
    keys.add(key);
    if (
      String(setup.harness) !== "null" &&
      Bun.which(EVAL_HARNESSES[setup.harness]!.achAgent) == null
    )
      throw new EvalRequestError(`${setup.harness} is not installed`, 503, "harness_missing");
  }
  const taskSet = new Set(readEvalTasks(achDir).map((task) => task.id));
  if (
    !Array.isArray(input.taskIds) ||
    input.taskIds.length === 0 ||
    input.taskIds.some((id) => typeof id !== "string" || !taskSet.has(id))
  )
    throw new EvalRequestError("taskIds must name tasks in the catalog", 400);
  if (new Set(input.taskIds).size !== input.taskIds.length)
    throw new EvalRequestError("taskIds must not contain duplicates", 400);
  if (!Number.isInteger(input.trials) || input.trials! < 1 || input.trials! > EVAL_LIMITS.maxTrials)
    throw new EvalRequestError(`trials must be 1..${EVAL_LIMITS.maxTrials}`, 400);
  if (
    !Number.isSafeInteger(input.wallMs) ||
    input.wallMs! < 1 ||
    input.wallMs! > EVAL_LIMITS.maxWallMs
  )
    throw new EvalRequestError(`wallMs must be 1..${EVAL_LIMITS.maxWallMs}`, 400);
  if (!["smoke", "quick", "reliability", "custom"].includes(input.preset ?? ""))
    throw new EvalRequestError("preset is invalid", 400);
  return {
    name: input.name.trim(),
    setups: input.setups,
    taskIds: input.taskIds,
    trials: input.trials!,
    wallMs: input.wallMs!,
    preset: input.preset!,
  };
}

function evalSurvivors(manifest: EvalRunManifest): number[] {
  const pids = new Set<number>();
  const ps = Bun.spawnSync(["ps", "-E", "-axo", "pid=,command="], {
    stdout: "pipe",
    stderr: "pipe",
  });
  for (const line of ps.stdout.toString().split("\n")) {
    if (!line.includes(`AGENT_BENCHMARKS_EVAL_RUN=${manifest.id}`)) continue;
    const pid = Number(line.trim().split(/\s+/, 1)[0]);
    if (Number.isSafeInteger(pid)) pids.add(pid);
  }
  const lsof = Bun.spawnSync(
    ["lsof", "-a", "-d", "cwd", "+D", manifest.provenance.hermeticRoot, "-Fn"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (lsof.exitCode !== 0)
    console.error(
      `[eval/cancel] could not scan hermetic cwd survivors for ${manifest.id}: ${lsof.stderr.toString().trim()}`,
    );
  let currentPid: number | null = null;
  for (const line of lsof.stdout.toString().split("\n")) {
    if (line.startsWith("p")) currentPid = Number(line.slice(1));
    if (line.startsWith("n") && currentPid != null && Number.isSafeInteger(currentPid))
      pids.add(currentPid);
  }
  pids.delete(process.pid);
  return [...pids].sort((a, b) => a - b);
}

function hashTree(root: string): string {
  const hash = createHash("sha256");
  for (const path of sortedFiles(root))
    hash
      .update(path.slice(root.length + 1))
      .update("\0")
      .update(readFileSync(path));
  return hash.digest("hex");
}

function sortedFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? sortedFiles(path) : [path];
    })
    .sort();
}

async function versionOf(command: string, args: readonly string[]): Promise<string | null> {
  if (command === "null") return "null";
  const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 5_000);
  const [output, error] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const exit = await child.exited;
  clearTimeout(timer);
  if (exit !== 0) console.error(`[eval/runner] version failed for ${command}`, error.trim());
  return exit === 0 ? `${output}${error}`.trim().split(/\r?\n/, 1)[0] || null : null;
}

function gitValue(cwd: string, ...args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim();
}

function readManifest(runDir: string): EvalRunManifest | null {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as EvalRunManifest;
  } catch (error) {
    console.error(`[eval/runner] corrupt manifest ${path}`, error);
    return null;
  }
}

function writeManifest(runDir: string, manifest: EvalRunManifest): void {
  const path = join(runDir, "manifest.json");
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

function requireRun(dbPath: string, id: string): EvalRunManifest {
  const manifest = readRunManifest(dbPath, id);
  if (manifest == null) throw new EvalRequestError("evaluation run not found", 404, "not_found");
  return manifest;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    console.error(`[eval/runner] pid ${pid} is not alive`, error);
    return false;
  }
}

async function pipeOutput(
  stream: ReadableStream<Uint8Array>,
  log: FileSink,
  id: string,
  stderr: boolean,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    log.write(value);
    if (stderr) {
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^\[[^\]]+\]\s+(.+?)\s+running$/.exec(line);
        if (match != null) currentCells.set(id, match[1]!);
      }
    }
  }
}
