import type { AugmentSnapshot } from "./augments.ts";

export type EvalHarness = "claude" | "codex" | "copilot" | "opencode" | "omp" | "droid";

/** `clean` keeps the user's login but drops their hooks, plugins, MCP servers, and instructions. */
export type EvalConfigMode = "current" | "default" | "clean";

/** An augment file name without `.json`, validated at load: /^[a-z0-9][a-z0-9-]{0,63}$/. */
export type AugmentId = string;

export type AugmentSource = "bundled" | "user";

export type AugmentKind = "shell-proxy" | "mcp" | "prompt-mode" | "harness-flag";

export interface EvalSetup {
  harness: EvalHarness;
  model: string;
  config: EvalConfigMode;
  /** Sorted and unique; empty for a setup without augments. */
  augments: AugmentId[];
}

export type EvalPresetId = "smoke" | "quick" | "reliability" | "custom";

export interface BenchmarkRunInput {
  kind: "benchmark";
  name: string;
  setups: EvalSetup[];
  taskIds: string[];
  trials: number;
  wallMs: number;
  preset: EvalPresetId;
}

export interface RepoProfile {
  setupCommand: string | null;
  checks: string[];
  hiddenTestCommand: string | null;
}

export type RealTask =
  | { type: "prompt"; prompt: string; baseRef: string }
  | { type: "replay"; sha: string; prompt: string; hiddenPaths: string[] };

/** `branchPrefix` names where each cell's result lands in the repository; see `cellBranch`. */
export interface RealSetup extends EvalSetup {
  branchPrefix?: string;
}

export interface RealRunInput {
  kind: "real";
  name: string;
  setups: RealSetup[];
  trials: number;
  wallMs: number;
  repoPath: string;
  task: RealTask;
  profile: RepoProfile;
}

export type EvalRunInput = BenchmarkRunInput | RealRunInput;

export interface DiffStat {
  files: string[];
  added: number;
  removed: number;
}

export interface CheckResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Path relative to the run directory. */
  log: string;
}

export interface RealCellSummary {
  diffStat: DiffStat;
  checks: CheckResult[];
  hidden: { passed: number; total: number; files: { path: string; passed: boolean }[] } | null;
  /** Replay: share of the human's non-hidden files the agent also changed. */
  fileOverlap: number | null;
  /** Replay: agent (added + removed) over the human's non-hidden (added + removed). */
  sizeRatio: number | null;
  turns: number | null;
  toolCalls: number | null;
}

export interface RealReference {
  baseSha: string;
  sha: string;
  diffStat: DiffStat;
  nonHidden: DiffStat;
}

export interface RealResults {
  task: RealTask;
  repoPath: string;
  baseSha: string;
  profile: RepoProfile;
  reference: RealReference | null;
  /** Keyed by EvalCell.cellId; cells without artifacts are absent. */
  cells: Record<string, RealCellSummary>;
}

export interface RepoCommit {
  sha: string;
  subject: string;
  date: string;
}

export interface RepoInspection {
  path: string;
  head: string;
  branch: string | null;
  /** Local and remote-tracking branches, most recently committed first. */
  branches: string[];
  dirty: boolean;
  profile: RepoProfile;
  profileSource: "remembered" | "detected";
  recentCommits: RepoCommit[];
  commit: {
    sha: string;
    subject: string;
    body: string;
    files: string[];
    suggestedHidden: string[];
    isMerge: boolean;
  } | null;
}

export interface CellArtifacts {
  patch: string;
  checks: { command: string; logTail: string }[];
  hidden: { path: string; logTail: string }[];
}

export type EvalRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "cancel-incomplete"
  | "interrupted";

export interface EvalProvenance {
  achDir: string;
  achCommit: string;
  achDirty: boolean;
  harnessVersions: Partial<Record<EvalHarness, string>>;
  taskHashes: Record<string, string>;
  executionOrder: string[];
  /** Definitions of every augment the run uses, captured at start; absent in older manifests (bundled). */
  augments?: Record<AugmentId, AugmentSnapshot>;
  /** Null for real-task runs, which isolate with git worktrees instead. */
  hermeticRoot: string | null;
  globalConfigNote: string;
}

export interface EvalRunManifest {
  id: string;
  createdAt: string;
  input: EvalRunInput;
  status: EvalRunStatus;
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  error: string | null;
  survivors: number[];
  provenance: EvalProvenance;
}

export type CellOutcome =
  | "passed"
  | "verify-failed"
  | "timeout"
  | "budget-stop"
  | "agent-error"
  | "setup-error"
  | "verifier-error"
  | "provider-limit"
  | "unavailable"
  | "pending";

export const GRADED_OUTCOME: Record<CellOutcome, boolean> = {
  passed: true,
  "verify-failed": true,
  timeout: true,
  "budget-stop": true,
  "agent-error": false,
  "setup-error": false,
  "verifier-error": false,
  "provider-limit": false,
  unavailable: false,
  pending: false,
};

export type CostBasis = "harness-reported" | "list-price-estimate";

export type CellCost =
  | { kind: "priced"; usd: number; basis: CostBasis }
  | {
      kind: "unavailable";
      reason: "not-metered" | "not-found" | "ambiguous" | "unpriced-model" | "not-run";
    };

export interface CellTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface EvalCell {
  cellId: string;
  setupKey: string;
  taskId: string;
  trial: number;
  outcome: CellOutcome;
  agentMs: number | null;
  verifyMs: number | null;
  /** Augment preparation (e.g. building a code index) before the agent started; null without augments. */
  prepMs: number | null;
  endToEndMs: number | null;
  tokens: CellTokens | null;
  cost: CellCost;
  observedModel: string | null;
  session: { id: number; tool: string; sourceSessionId: string } | null;
  raw: {
    status: string;
    exitStatus: string | null;
    verify: string | null;
    error: string | null;
    runId: string | null;
  };
}

export interface InterruptedAttempt {
  runId: string;
  cellId: string | null;
  startedAt: string;
  cost: CellCost;
}

export interface Interval {
  p: number;
  lo: number;
  hi: number;
}

export interface SetupSummary {
  setupKey: string;
  setup: EvalSetup;
  planned: number;
  attempted: number;
  graded: number;
  passed: number;
  /** Task-mean of per-task pass proportion over the common eligible task set. */
  passRate: number | null;
  /** Wilson 95% over the common eligible tasks; only when trials = 1. */
  passRateCi: Interval | null;
  eligibleTasks: number;
  k: number;
  passAtK: number | null;
  passHatK: number | null;
  kUnavailableReason: string | null;
  spendUsd: number | null;
  pricedSubtotalUsd: number;
  priced: { priced: number; total: number };
  costPerSolvedUsd: number | null;
  timePerSolvedMs: number | null;
  agentP50Ms: number | null;
  agentP95Ms: number | null;
  outcomes: Record<CellOutcome, number>;
}

export interface PairedComparison {
  baseline: string;
  other: string;
  tasks: number;
  better: number;
  worse: number;
  tied: number;
  verdict: "inconclusive" | "consistently-better" | "consistently-worse";
}

export interface EvalResults {
  manifest: EvalRunManifest;
  cells: EvalCell[];
  interrupted: InterruptedAttempt[];
  setups: SetupSummary[];
  paired: PairedComparison[];
  warnings: string[];
  progress: { done: number; total: number; currentCell: string | null; liveCellId: string | null };
  /** Null for benchmark runs. */
  real: RealResults | null;
  /** One row per augmented setup that has a same harness, model, and config baseline without augments. */
  augmentVerdicts: AugmentVerdict[];
}

export const EVAL_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type EvalDifficulty = (typeof EVAL_DIFFICULTIES)[number];

export interface EvalTask {
  id: string;
  language: string;
  category: string;
  difficulty: EvalDifficulty | null;
  description: string;
  suites: string[];
}

export interface EvalHarnessInfo {
  harness: EvalHarness;
  label: string;
  installed: boolean;
  version: string | null;
  knownModels: string[];
  metered: boolean;
  /** Null when the harness can run with default configuration; otherwise why not. */
  defaultConfigProblem: string | null;
}

export interface EvalAugmentInfo {
  id: AugmentId;
  source: AugmentSource;
  /** The id when the file is invalid. */
  label: string;
  /** Null when the file is invalid. */
  kind: AugmentKind | null;
  description: string;
  sourceUrl: string;
  /** Harnesses with a recipe for this augment; every harness when the file is invalid, so the problem shows. */
  harnesses: EvalHarness[];
  available: boolean;
  /** Why it cannot run on this machine; null when available. */
  problem: string | null;
}

export type AugmentVerdictKind = "adopt" | "quality-risk" | "no-saving" | "inconclusive";

export interface AugmentVerdict {
  baseline: string;
  augmented: string;
  harness: EvalHarness;
  model: string;
  config: EvalConfigMode;
  augments: AugmentId[];
  /** (task, trial) pairs on tasks that reach the trial floor; thinner tasks are left out. */
  pairs: number;
  /** Fewest paired trials of any counted task; of any task when none reach the floor. */
  minTrials: number;
  /** Augmented pass share minus baseline pass share over the pairs. */
  passDelta: number | null;
  /** Pairs the augmented arm passed and the baseline failed. */
  better: number;
  worse: number;
  /** Relative change in mean total tokens over the pairs; -0.2 is 20% fewer. */
  tokenDelta: number | null;
  /** Relative change in mean cost over the pairs; null unless every paired cell is priced. */
  costDelta: number | null;
  savingBasis: "cost" | "tokens" | null;
  /** Mean augment preparation time per augmented cell, outside agent time. */
  prepMs: number | null;
  verdict: AugmentVerdictKind;
  reason: string;
}

export interface AugmentPoolEntry extends Omit<AugmentVerdict, "baseline" | "augmented"> {
  harnessVersion: string | null;
  runIds: string[];
  /** The pooled runs captured more than one version of the augment definitions. */
  recipeDrift: boolean;
}

/** A saved benchmark input; the id is the file name in `<evalDir>/combos`. */
export interface EvalCombo {
  id: string;
  label: string;
  setups: EvalSetup[];
  taskIds: string[];
  trials: number;
  wallMs: number;
}

export interface EvalComboInfo extends EvalCombo {
  /** Why the combo cannot start as saved on this machine; null when it can. */
  problem: string | null;
}

export interface EvalPreset {
  id: Exclude<EvalPresetId, "custom">;
  label: string;
  taskIds: string[];
  trials: number;
  claim: string;
}

export interface EvalCatalog {
  ach: { dir: string; ok: boolean; problem: string | null; commit: string | null };
  harnesses: EvalHarnessInfo[];
  tasks: EvalTask[];
  presets: EvalPreset[];
  limits: {
    maxTrials: number;
    maxSetups: number;
    defaultWallMs: number;
    maxWallMs: number;
    realDefaultWallMs: number;
  };
  activeRunId: string | null;
  augments: EvalAugmentInfo[];
  /** Directory holding the user's `augments/` and `combos/`. */
  evalDir: string;
  combos: EvalComboInfo[];
  /** The server can open a native folder picker for the repository path. */
  canPickFolder: boolean;
}

export interface EvalProgressEvent {
  runId: string;
  status: EvalRunStatus;
  done: number;
  total: number;
  currentCell: string | null;
  /** The cell whose agent process is alive right now; null when none or when it cannot be determined. */
  liveCellId: string | null;
}

export type LiveStep =
  | { seq: number; ts: number; kind: "message"; text: string }
  | { seq: number; ts: number; kind: "tool_call"; tool: string; summary: string; detail: string }
  | {
      seq: number;
      ts: number;
      kind: "tool_result";
      isError: boolean;
      summary: string;
      detail: string;
    }
  | { seq: number; ts: number; kind: "usage"; costUsd: number | null; outputTokens: number | null }
  | { seq: number; ts: number; kind: "error"; text: string };

export type LiveStepKind = LiveStep["kind"];

export type CellLiveState = "live" | "done" | "queued" | "unknown";

export interface CellStream {
  cellId: string;
  state: CellLiveState;
  startedAt: number | null;
  /** Steps with seq >= the requested cursor. */
  steps: LiveStep[];
  /** Raw lines consumed so far; pass as `after` to fetch only newer steps. */
  nextSeq: number;
  /** Over the whole transcript, not just the returned steps. */
  totals: { toolCalls: number; costUsd: number | null };
}

/** Broadcast notice that a cell has new steps; content is fetched per cell. */
export interface EvalCellActivityEvent {
  runId: string;
  cellId: string | null;
  seq: number;
}
