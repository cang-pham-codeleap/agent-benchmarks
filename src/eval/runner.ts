import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { FileSink } from "bun";
import type { Config } from "../config.ts";
import type { IngestConfig } from "../ingest.ts";
import type { RequestContext } from "../server/context.ts";
import { publishServerEvent } from "../server/sse.ts";
import { syncNow } from "../server/sync.ts";
import { getAchDir } from "../settings.ts";
import { augmentVerdicts } from "./augment-verdicts.ts";
import { readEvalTasks } from "./catalog.ts";
import { EvalRequestError } from "./errors.ts";
import {
  achCellId,
  type EvalLedgerRow,
  evalTaskIds,
  PREP_EXIT_CODE,
  prepLogPath,
  readEvalCells,
  readLedgerCells,
  readRegistry,
  repairTornLedger,
} from "./ledger.ts";
import {
  type LiveContext,
  plannedCells,
  projectTranscript,
  readCellStream,
  resolveLive,
} from "./live.ts";
import {
  apiCellId,
  augmentsDir,
  groupId,
  groupKeysOnDisk,
  ledgerFile,
  planFile,
  type RunGroupId,
  repoProfilesPath,
  setupGroups,
} from "./paths.ts";
import { prepareRealRun, readRealResults, rememberProfile, validateRealInput } from "./real.ts";
import { shellQuote } from "./real-verify.ts";
import {
  configGroupEnv,
  EVAL_HARNESSES,
  EVAL_LIMITS,
  rejectDuplicateSetup,
  resolveRecipe,
  validateSetupConfig,
  writeRecipeFiles,
} from "./registry.ts";
import { pairedComparisons, summarizeSetups } from "./stats.ts";
import type {
  BenchmarkRunInput,
  CellStream,
  EvalResults,
  EvalRunInput,
  EvalRunManifest,
  EvalRunStatus,
  EvalSetup,
  RealRunInput,
} from "./types.ts";

const transitions: Record<EvalRunStatus, EvalRunStatus[]> = {
  running: ["completed", "failed", "cancelled", "cancel-incomplete", "interrupted"],
  completed: [],
  failed: [],
  cancelled: ["running"],
  "cancel-incomplete": ["cancelled"],
  interrupted: ["running"],
};

/** One `ach trial` invocation: run groups run in this order, one child at a time. */
interface RunGroup extends RunGroupId {
  planPath: string;
  ledgerPath: string;
}

const watchers = new Map<string, { close(): void }>();
const children = new Map<string, Bun.Subprocess>();
const currentCells = new Map<string, string | null>();
const cancelling = new Set<string>();
let starting = false;
let initialized = false;

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
  const isReal = raw != null && typeof raw === "object" && "kind" in raw && raw.kind === "real";
  return isReal
    ? startRealRun(config, context, raw, achDir)
    : startBenchmarkRun(config, context, raw, achDir);
}

async function startBenchmarkRun(
  config: Config,
  context: RequestContext,
  raw: unknown,
  achDir: string,
): Promise<EvalRunManifest> {
  const input = validateInput(raw, achDir);
  const id = crypto.randomUUID();
  const runDir = runDirFor(config.dbPath, id);
  prepareRunDir(runDir, input.setups);
  mkdirSync(join(runDir, "tasks"), { recursive: true });
  const taskHashes: Record<string, string> = {};
  const taskDirs = new Map(readEvalTasks(achDir).map((source) => [source.task.id, source.dir]));
  for (const taskId of input.taskIds) {
    const source = taskDirs.get(taskId)!;
    const target = join(runDir, "tasks", taskId);
    cpSync(source, target, { recursive: true });
    taskHashes[taskId] = hashTree(target);
  }
  const executionOrder: string[] = [];
  for (const group of setupGroups(input.setups)) {
    const plan = {
      experiment: `agent-benchmarks-eval-${id}`,
      agents: group.setups.map((setup) => ({
        agent: EVAL_HARNESSES[setup.harness]!.achAgent,
        models: [setup.model],
      })),
      tasks: input.taskIds.map((taskId) => ({ dir: join(runDir, "tasks", taskId) })),
      trials: input.trials,
      variant: "{agent}:{task}:{model}",
      budget: { wallMs: input.wallMs },
    };
    writeFileSync(join(runDir, planFile(group.key)), `${JSON.stringify(plan, null, 2)}\n`);
    const prefix = group.key === "current" ? "" : `${group.key} → `;
    for (const agent of plan.agents)
      for (const task of input.taskIds)
        for (const model of agent.models)
          for (let trial = 1; trial <= input.trials; trial++)
            executionOrder.push(`${prefix}${agent.agent} → ${task} → ${model} → ${trial}`);
  }
  const manifest = await newManifest(id, input, achDir, {
    taskHashes,
    executionOrder,
    hermeticRoot: `/private/tmp/agent-benchmarks-hermetic/${id}`,
  });
  return launch(config, context, runDir, manifest);
}

async function startRealRun(
  config: Config,
  context: RequestContext,
  raw: unknown,
  achDir: string,
): Promise<EvalRunManifest> {
  const input = validateRealInput(raw);
  const id = crypto.randomUUID();
  const runDir = runDirFor(config.dbPath, id);
  const { taskId, baseSha, groups } = prepareRealRunDir(input, runDir);
  rememberProfile(repoProfilesPath(config.dbPath), input.repoPath, input.profile);
  const now = Date.now();
  for (const group of groups)
    for (const { setup, reason } of group.unavailable)
      for (let trial = 1; trial <= input.trials; trial++) {
        const row = {
          v: 1,
          cellId: achCellId(setup, taskId, trial),
          agent: EVAL_HARNESSES[setup.harness]?.achAgent ?? setup.harness,
          task: taskId,
          model: setup.model,
          trial,
          status: "skipped-unavailable",
          runId: null,
          error: reason,
          startedAt: now,
          endedAt: now,
        } satisfies EvalLedgerRow;
        appendFileSync(group.ledgerPath, `${JSON.stringify(row)}\n`, { mode: 0o600 });
      }
  const executionOrder = groups.flatMap((group) =>
    group.setups.flatMap((setup) =>
      Array.from(
        { length: input.trials },
        (_, trial) =>
          `${group.key} → ${EVAL_HARNESSES[setup.harness]?.achAgent ?? setup.harness} → ${taskId} → ${setup.model} → ${trial + 1}`,
      ),
    ),
  );
  const taskHash = createHash("sha256")
    .update(JSON.stringify({ baseSha, task: input.task, profile: input.profile }))
    .digest("hex");
  const manifest = await newManifest(id, input, achDir, {
    taskHashes: { [taskId]: taskHash },
    executionOrder,
    hermeticRoot: null,
  });
  return launch(config, context, runDir, manifest);
}

function prepareRunDir(runDir: string, setups: readonly EvalSetup[]): void {
  for (const dir of [join(runDir, "ach-state", "agents.d"), join(runDir, "cwd")])
    mkdirSync(dir, { recursive: true });
  const descriptors = setups
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
}

function prepareRealRunDir(input: RealRunInput, runDir: string) {
  try {
    prepareRunDir(runDir, input.setups);
    return prepareRealRun(input, runDir);
  } catch (error) {
    rmSync(runDir, { recursive: true, force: true });
    throw error;
  }
}

async function newManifest(
  id: string,
  input: EvalRunInput,
  achDir: string,
  provenance: Pick<EvalRunManifest["provenance"], "taskHashes" | "executionOrder" | "hermeticRoot">,
): Promise<EvalRunManifest> {
  const harnessVersions: EvalRunManifest["provenance"]["harnessVersions"] = {};
  for (const harness of new Set(input.setups.map((setup) => setup.harness))) {
    harnessVersions[harness] =
      (await versionOf(EVAL_HARNESSES[harness]!.achAgent, EVAL_HARNESSES[harness]!.versionArgs)) ??
      undefined;
  }
  return {
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
      ...provenance,
      globalConfigNote:
        "User-global harness configuration (~/.claude, ~/.omp, and peers) is part of the harness under test.",
    },
  };
}

function launch(
  config: Config,
  context: RequestContext,
  runDir: string,
  manifest: EvalRunManifest,
): EvalRunManifest {
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
  const runDir = runDirFor(dbPath, id);
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
  const survivors = evalSurvivors(manifest, runDir);
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
  const remaining = evalSurvivors(manifest, runDir);
  const next: EvalRunStatus = remaining.length === 0 ? "cancelled" : "cancel-incomplete";
  updateRun(runDir, latest ?? manifest, next, null, "cancelled by user", remaining);
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
  const runDir = runDirFor(config.dbPath, id);
  const survivors = evalSurvivors(manifest, runDir);
  if (survivors.length)
    throw new EvalRequestError(
      `run still has surviving pids: ${survivors.join(", ")}`,
      409,
      "eval_survivors",
    );
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

export function evalProgress(dbPath: string, run: EvalRunManifest): EvalResults["progress"] {
  return {
    done: readLedgerCells(runDirFor(dbPath, run.id)).size,
    total: run.input.setups.length * evalTaskIds(run.input).length * run.input.trials,
    currentCell: currentCells.get(run.id) ?? null,
    liveCellId: run.status === "running" ? resolveLive(liveContext(dbPath, run)).cellId : null,
  };
}

function liveContext(dbPath: string, run: EvalRunManifest): LiveContext {
  const runDir = runDirFor(dbPath, run.id);
  return {
    planned: plannedCells(run.input),
    ledger: readLedgerCells(runDir),
    records: readRegistry(runDir),
    currentCell: currentCells.get(run.id) ?? null,
    isAlive: processExists,
  };
}

/** Null when `cellId` is not a cell of the run. */
export function readEvalCellStream(
  dbPath: string,
  run: EvalRunManifest,
  cellId: string,
  after: number,
): CellStream | null {
  return readCellStream(liveContext(dbPath, run), cellId, after);
}

export function readEvalResults(
  db: Database,
  dbPath: string,
  manifest: EvalRunManifest,
): EvalResults {
  const runDir = runDirFor(dbPath, manifest.id);
  const { input } = manifest;
  const { cells, interrupted } = readEvalCells(db, runDir, input);
  const setups = summarizeSetups(cells, input.setups, evalTaskIds(input), input.trials);
  const repairedTornLedger = readdirSync(runDir).some((name) => name.startsWith("ledger.torn-"));
  return {
    manifest,
    cells,
    interrupted,
    setups,
    paired: pairedComparisons(cells, input.setups),
    warnings: evalWarnings(input, setups, interrupted.length, repairedTornLedger),
    progress: evalProgress(dbPath, manifest),
    real: input.kind === "real" ? readRealResults(db, runDir, input, cells) : null,
    augmentVerdicts: augmentVerdicts(cells, input.setups),
  };
}

function evalWarnings(
  input: EvalRunInput,
  setups: EvalResults["setups"],
  interrupted: number,
  repairedTornLedger: boolean,
): string[] {
  const warnings =
    input.kind === "real"
      ? ["One task on one repository: results describe this task, not general ability."]
      : ["Public tasks; verifier and reference files are readable by the agent."];
  warnings.push("Setups ran sequentially; provider load and cache state may differ.");
  if (input.kind === "benchmark" && input.taskIds.length < 20)
    warnings.push("Descriptive only: fewer than 20 tasks.");
  if (setups.some((setup) => setup.priced.priced < setup.priced.total))
    warnings.push("Some cells are unpriced; cost ratios are withheld unless coverage is complete.");
  if (interrupted > 0)
    warnings.push("Interrupted attempts with partial spend are excluded from cell results.");
  if (repairedTornLedger)
    warnings.push(
      "A torn ledger tail was preserved in a ledger.torn-* file and excluded from results.",
    );
  return warnings;
}

/** Default-config sessions live under the run, outside the sources a normal sync scans. */
export function defaultGroupSyncConfig(
  config: Config,
  runDir: string,
): (Config & Pick<IngestConfig, "sourcePaths">) | null {
  const claudeRuns = join(runDir, "ach-state", "claude-runs");
  const codexHome = join(runDir, "home", "codex");
  // Only `projects/`: a per-run Claude config dir also holds history.jsonl and other non-transcript JSONL.
  const sourcePaths = [
    ...(existsSync(claudeRuns)
      ? readdirSync(claudeRuns).map((runId) => join(claudeRuns, runId, "projects"))
      : []),
    join(codexHome, "sessions"),
    join(codexHome, "archived_sessions"),
  ].filter((path) => existsSync(path));
  return sourcePaths.length === 0 ? null : { ...config, codexDir: codexHome, sourcePaths };
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

function runGroups(runDir: string, setups: readonly EvalSetup[]): RunGroup[] {
  const planned = new Set(groupKeysOnDisk(runDir, "plan"));
  return setupGroups(setups)
    .filter((group) => planned.has(group.key))
    .map((group) => ({
      ...groupId(group.config, group.augments),
      planPath: join(runDir, planFile(group.key)),
      ledgerPath: join(runDir, ledgerFile(group.key)),
    }));
}

function spawnRun(
  config: Config,
  context: RequestContext,
  runDir: string,
  manifest: EvalRunManifest,
  retryFailed: boolean,
): void {
  const id = manifest.id;
  const groups = runGroups(runDir, manifest.input.setups);
  const log = Bun.file(join(runDir, "ach.log")).writer();
  installLedgerWatch(config.dbPath, runDir, id);
  const stop = async (): Promise<void> => {
    watchers.get(id)?.close();
    watchers.delete(id);
    await log.end();
  };
  const finish = async (
    latest: EvalRunManifest,
    exitCode: number,
    error: string | null,
    ran: readonly RunGroup[],
  ): Promise<void> => {
    updateRun(runDir, latest, exitCode === 0 ? "completed" : "failed", exitCode, error);
    publishProgress(config.dbPath, id);
    await syncAfterRun(
      config,
      context,
      runDir,
      id,
      ran.some((group) => group.config === "default"),
    );
    await stop();
  };
  const runFrom = (index: number, current: EvalRunManifest, failure: string | null): void => {
    const group = groups[index]!;
    const child = spawnGroup(runDir, current, group, retryFailed, log);
    void child.exited
      .then(async (exitCode) => {
        children.delete(id);
        const latest = readManifest(runDir);
        if (cancelling.has(id) || latest == null || latest.status !== "running") return stop();
        const ran = groups.slice(0, index + 1);
        // ach exits non-zero when any cell errored; later groups still run so one crash does not drop them.
        const failed =
          failure ?? (exitCode === 0 ? null : `ach exited ${exitCode} in the ${group.key} group`);
        if (index + 1 === groups.length) return finish(latest, failed == null ? 0 : 1, failed, ran);
        try {
          runFrom(index + 1, latest, failed);
        } catch (error) {
          await finish(latest, 1, error instanceof Error ? error.message : String(error), ran);
        }
      })
      .catch(async (error) => {
        console.error(`[eval/runner] child failed for ${id}`, error);
        await stop();
      });
  };
  if (groups.length === 0) {
    void finish(manifest, 0, null, []).catch((error) =>
      console.error(`[eval/runner] finishing ${id} failed`, error),
    );
    return;
  }
  try {
    runFrom(0, manifest, null);
  } catch (error) {
    void stop();
    throw error;
  }
}

function spawnGroup(
  runDir: string,
  manifest: EvalRunManifest,
  group: RunGroup,
  retryFailed: boolean,
  log: FileSink,
): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  const hermeticRoot = manifest.provenance.hermeticRoot;
  const args = [
    "bun",
    "run",
    join(manifest.provenance.achDir, "src", "cli", "ach.ts"),
    "trial",
    "--matrix",
    group.planPath,
    "--ledger",
    group.ledgerPath,
    ...(hermeticRoot == null ? ["--isolate", "--cleanup"] : ["--hermetic"]),
  ];
  if (retryFailed) args.push("--retry-failed");
  if (hermeticRoot != null) mkdirSync(hermeticRoot, { recursive: true });
  const harnesses = [
    ...new Set(
      manifest.input.setups
        .filter((setup) => groupId(setup.config, setup.augments).key === group.key)
        .map((setup) => setup.harness),
    ),
  ];
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...configGroupEnv(group.config, runDir, harnesses),
    AGENTIC_CODING_HARNESS_STATE_DIR: join(runDir, "ach-state"),
    AGENTIC_CODING_HARNESS_HERMETIC_ROOT: hermeticRoot ?? undefined,
    AGENT_BENCHMARKS_EVAL_RUN: manifest.id,
  };
  for (const harness of harnesses)
    Object.assign(
      env,
      resolveRecipe(harness, group.config, group.augments, group.key, augmentsDir(runDir)).env,
    );
  const bin = writeHarnessShims(runDir, group, harnesses, hermeticRoot == null, env.PATH ?? "");
  if (bin != null) env.PATH = `${bin}:${env.PATH ?? ""}`;
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  const child = Bun.spawn(args, {
    cwd: join(runDir, "cwd"),
    detached: true,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  // macOS idle sleep drops every agent's connection mid-cell, turning the rest of the run into timeouts.
  if (process.platform === "darwin" && Bun.which("caffeinate") != null)
    Bun.spawn(["caffeinate", "-i", "-w", String(child.pid)], {
      stdout: "ignore",
      stderr: "ignore",
    });
  manifest.pid = child.pid;
  writeManifest(runDir, manifest);
  children.set(manifest.id, child);
  void pipeOutput(child.stdout, log, manifest.id, null).catch((error) =>
    console.error(`[eval/runner] stdout pipe failed for ${manifest.id}`, error),
  );
  void pipeOutput(child.stderr, log, manifest.id, group.key).catch((error) =>
    console.error(`[eval/runner] stderr pipe failed for ${manifest.id}`, error),
  );
  return child;
}

/** Headless flags ach cannot set or that installed CLIs no longer accept, fixed by a shim placed first on
 * PATH. `real` is the shell-quoted path of the installed CLI; `extra` is the group's shell-quoted recipe
 * args, which the shim appends after the caller's own. */
const HARNESS_SHIMS: {
  harness: string;
  realTasksOnly: boolean;
  body: (real: string, extra: string) => string;
}[] = [
  {
    // `codex exec` defaults to a read-only sandbox; real tasks need the interactive default.
    harness: "codex",
    realTasksOnly: true,
    body: (real, extra) =>
      `if [ "$1" = exec ]; then shift; exec ${real} exec --sandbox workspace-write "$@" ${extra}; fi\nexec ${real} "$@"`,
  },
  {
    // Copilot CLI 1.0.114 rejects ach's `--usage-output-file`; ach then reads usage from events.jsonl.
    // ach's `--no-auto-update` makes the launcher run an older cached CLI (1.0.76) whose `auto` routes
    // with `hydra`, not Copilot Fusion (`auto_v2`); without it the CLI matches the catalog's version.
    // shortcut: an update downloaded mid-run applies at the next cell's launch; pin COPILOT_CLI_DIST_DIR if that drift matters.
    // `copilot-fusion` is the archive's label for Fusion sessions; the CLI selects Fusion as `auto`.
    harness: "copilot",
    realTasksOnly: false,
    body: (real, extra) =>
      [
        "skip= model=",
        'for arg do shift; if [ -n "$skip" ]; then skip=; continue; fi',
        '  if [ -n "$model" ]; then model=; [ "$arg" = copilot-fusion ] && arg=auto; fi',
        '  case "$arg" in --usage-output-file) skip=1; continue;; --usage-output-file=*|--no-auto-update) continue;;',
        "    --model) model=1;; --model=copilot-fusion) arg=--model=auto;; esac",
        '  set -- "$@" "$arg"; done',
        `exec ${real} "$@" ${extra}`,
      ].join("\n"),
  },
];

const JSON_ESCAPE = `sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'`;

/** Runs a group's prepare commands once per cell workspace, before the agent starts. The marker file
 * makes a second CLI invocation in the same workspace skip it; the commands' output stays out of git diffs. */
function prepareBlock(
  runDir: string,
  group: RunGroupId,
  harness: string,
  steps: { command: string; exclude: string[] }[],
): string {
  const marker = `.ab-prep-${group.key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const excluded = [marker, ...steps.flatMap((step) => step.exclude)].map(shellQuote).join(" ");
  const log = shellQuote(prepLogPath(runDir));
  const script = steps.map((step) => step.command).join(" && ");
  return [
    `if [ "$PWD" != ${shellQuote(join(runDir, "cwd"))} ] && [ ! -e ${shellQuote(marker)} ]; then`,
    "  now() { perl -MTime::HiRes=time -e 'printf \"%d\", time*1000' 2>/dev/null || echo $(( $(date +%s) * 1000 )); }",
    `  esc() { printf '%s' "$1" | tr '\\n\\t\\r' '   ' | cut -c1-300 | ${JSON_ESCAPE}; }`,
    "  start=$(now)",
    "  if exclude=$(git rev-parse --git-path info/exclude 2>/dev/null); then",
    '    mkdir -p "$(dirname "$exclude")"',
    `    for path in ${excluded}; do grep -qxF "$path" "$exclude" 2>/dev/null || echo "$path" >> "$exclude"; done`,
    "  fi",
    `  out=$( { ${script}; } 2>&1 ); code=$?`,
    "  ms=$(( $(now) - start ))",
    `  mkdir -p ${shellQuote(dirname(prepLogPath(runDir)))}`,
    "  if [ $code -eq 0 ]; then",
    `    : > ${shellQuote(marker)}`,
    `    printf '{"groupKey":"%s","harness":"%s","cwd":"%s","ms":%s,"ok":true,"error":null}\\n' ${shellQuote(group.key)} ${shellQuote(harness)} "$(esc "$PWD")" "$ms" >> ${log}`,
    "  else",
    `    msg="augment prepare failed (exit $code): $(esc "$out")"`,
    `    printf '{"groupKey":"%s","harness":"%s","cwd":"%s","ms":%s,"ok":false,"error":"%s"}\\n' ${shellQuote(group.key)} ${shellQuote(harness)} "$(esc "$PWD")" "$ms" "$msg" >> ${log}`,
    '    echo "$msg" >&2',
    `    exit ${PREP_EXIT_CODE}`,
    "  fi",
    "fi",
  ].join("\n");
}

/** Writes the group's recipe files and one PATH shim per harness in `runDir/bin/<group key>/`.
 * Returns that directory, or null when no harness in the group needs a shim. */
export function writeHarnessShims(
  runDir: string,
  group: RunGroupId,
  harnesses: readonly string[],
  realTask: boolean,
  path: string,
): string | null {
  const bin = join(runDir, "bin", group.key);
  const dir = augmentsDir(runDir);
  const fileHashes: Record<string, string> = {};
  let wrote = false;
  for (const harness of harnesses) {
    const shim = HARNESS_SHIMS.find(
      (candidate) => candidate.harness === harness && (!candidate.realTasksOnly || realTask),
    );
    const recipe = resolveRecipe(harness, group.config, group.augments, group.key, dir);
    const extra = recipe.args.map(shellQuote).join(" ");
    if (shim == null && extra === "" && recipe.prepare.length === 0) continue;
    const installed = Bun.which(harness, { PATH: path });
    if (installed == null) continue;
    Object.assign(fileHashes, writeRecipeFiles(dir, recipe.files));
    const real = shellQuote(installed);
    const body = shim == null ? `exec ${real} "$@" ${extra}` : shim.body(real, extra);
    const probeGuard = `case "$1" in --version|-v|--help|-h) exec ${real} "$@";; esac`;
    const lines = [
      "#!/bin/sh",
      ...(group.augments.length > 0 || group.config === "clean" ? [probeGuard] : []),
      ...(recipe.prepare.length > 0 ? [prepareBlock(runDir, group, harness, recipe.prepare)] : []),
      body,
    ];
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, harness), `${lines.join("\n")}\n`, { mode: 0o755 });
    wrote = true;
  }
  if (Object.keys(fileHashes).length > 0) {
    const hashPath = join(dir, "sha256.json");
    const known = existsSync(hashPath)
      ? (JSON.parse(readFileSync(hashPath, "utf8")) as Record<string, string>)
      : {};
    writeFileSync(hashPath, `${JSON.stringify({ ...known, ...fileHashes }, null, 2)}\n`);
  }
  return wrote ? bin : null;
}

async function syncAfterRun(
  config: Config,
  context: RequestContext,
  runDir: string,
  id: string,
  ranDefault: boolean,
): Promise<void> {
  const targets: [string, Config | null][] = [
    ["post-run", config],
    ["default-config", ranDefault ? defaultGroupSyncConfig(config, runDir) : null],
  ];
  for (const [label, target] of targets) {
    if (target == null) continue;
    try {
      await syncNow(
        target,
        context.economics,
        context.runSync,
        context.syncCoordinator?.runWithOwnership,
      );
    } catch (error) {
      console.error(`[eval/sync] ${label} sync failed for ${id}`, error);
    }
  }
}

function installLedgerWatch(dbPath: string, runDir: string, id: string): void {
  watchers.get(id)?.close();
  let last = "";
  let lastLive: string | null = null;
  let lastSize = -1;
  const poll = setInterval(() => {
    emit();
    emitActivity();
  }, 2000);
  const ledgerWatch = existsSync(runDir) ? watch(runDir, () => emit()) : null;
  watchers.set(id, {
    close() {
      clearInterval(poll);
      ledgerWatch?.close();
    },
  });
  function emit() {
    const body = groupKeysOnDisk(runDir, "ledger")
      .map((key) => join(runDir, ledgerFile(key)))
      .map((path) => (existsSync(path) ? readFileSync(path, "utf8") : ""))
      .join("\0");
    if (body === last) return;
    last = body;
    publishProgress(dbPath, id);
  }
  function emitActivity() {
    const run = readRunManifest(dbPath, id);
    if (run == null || run.status !== "running") return;
    const context = liveContext(dbPath, run);
    const live = resolveLive(context);
    if (live.cellId !== lastLive) {
      lastLive = live.cellId;
      publishProgress(dbPath, id);
    }
    const path = live.record?.rawTranscript;
    if (path == null || !existsSync(path)) return;
    const size = statSync(path).size;
    if (size === lastSize) return;
    lastSize = size;
    publishServerEvent({
      type: "eval_cell_activity",
      runId: id,
      cellId: live.cellId,
      seq: projectTranscript(readFileSync(path, "utf8")).nextSeq,
    });
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

export function validateInput(
  raw: unknown,
  achDir: string,
  env: NodeJS.ProcessEnv = process.env,
): BenchmarkRunInput {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw))
    throw new EvalRequestError("body must be an object", 400);
  const input = raw as Partial<Omit<BenchmarkRunInput, "kind">> & { kind?: unknown };
  if (input.kind !== undefined && input.kind !== "benchmark")
    throw new EvalRequestError("kind must be benchmark or real", 400);
  if (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 120)
    throw new EvalRequestError("name is required and must be at most 120 characters", 400);
  if (
    !Array.isArray(input.setups) ||
    input.setups.length < 1 ||
    input.setups.length > EVAL_LIMITS.maxSetups
  )
    throw new EvalRequestError(`setups must contain 1..${EVAL_LIMITS.maxSetups} entries`, 400);
  const keys = new Set<string>();
  const setups: EvalSetup[] = input.setups.map((setup) => {
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
    if (setup.config !== undefined && setup.config !== "current" && setup.config !== "clean")
      throw new EvalRequestError(
        "benchmark setups run with the current or clean configuration only",
        400,
        "config_unsupported",
      );
    const config = setup.config ?? "current";
    const normalized: EvalSetup = {
      harness: setup.harness,
      model: setup.model,
      config,
      augments: validateSetupConfig(
        setup.harness,
        config,
        (setup as { augments?: unknown }).augments,
        env,
      ),
    };
    rejectDuplicateSetup(keys, normalized);
    if (
      String(setup.harness) !== "null" &&
      Bun.which(EVAL_HARNESSES[setup.harness]!.achAgent, { PATH: env.PATH ?? "" }) == null
    )
      throw new EvalRequestError(`${setup.harness} is not installed`, 503, "harness_missing");
    return normalized;
  });
  const taskSet = new Set(readEvalTasks(achDir).map((source) => source.task.id));
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
    kind: "benchmark",
    name: input.name.trim(),
    setups,
    taskIds: input.taskIds,
    trials: input.trials!,
    wallMs: input.wallMs!,
    preset: input.preset!,
  };
}

function evalSurvivors(manifest: EvalRunManifest, runDir: string): number[] {
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
  const cwdRoot = manifest.provenance.hermeticRoot ?? join(runDir, "ach-state", "worktrees");
  if (existsSync(cwdRoot)) {
    const lsof = Bun.spawnSync(["lsof", "-a", "-d", "cwd", "+D", cwdRoot, "-Fn"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    // lsof exits 1 with empty stderr when no process has a cwd under the root.
    if (lsof.exitCode !== 0 && lsof.stderr.length > 0)
      console.error(
        `[eval/cancel] could not scan cwd survivors for ${manifest.id}: ${lsof.stderr.toString().trim()}`,
      );
    let currentPid: number | null = null;
    for (const line of lsof.stdout.toString().split("\n")) {
      if (line.startsWith("p")) currentPid = Number(line.slice(1));
      if (line.startsWith("n") && currentPid != null && Number.isSafeInteger(currentPid))
        pids.add(currentPid);
    }
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
    return parseManifest(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    console.error(`[eval/runner] corrupt manifest ${path}`, error);
    return null;
  }
}

/** Manifests written before real-task runs have no `kind` and setups without `config`; older ones also lack `augments`. */
function parseManifest(stored: EvalRunManifest): EvalRunManifest {
  const input = stored.input as EvalRunInput | Omit<BenchmarkRunInput, "kind">;
  const setups = input.setups.map((setup) => ({
    ...setup,
    config: setup.config ?? "current",
    augments: setup.augments ?? [],
  }));
  return {
    ...stored,
    input: "kind" in input ? { ...input, setups } : { ...input, kind: "benchmark", setups },
  };
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
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    if (code !== "ESRCH") console.error(`[eval/runner] cannot probe pid ${pid}`, error);
    return false;
  }
}

async function pipeOutput(
  stream: ReadableStream<Uint8Array>,
  log: FileSink,
  id: string,
  progressGroup: string | null,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    log.write(value);
    if (progressGroup != null) {
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^\[[^\]]+\]\s+(.+?)\s+running$/.exec(line);
        if (match != null) currentCells.set(id, apiCellId(progressGroup, match[1]!));
      }
    }
  }
}
