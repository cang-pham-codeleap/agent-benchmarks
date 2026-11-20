export type EvalHarness = "claude" | "codex" | "copilot" | "opencode" | "omp" | "droid";

export interface EvalSetup {
  harness: EvalHarness;
  model: string;
}

export type EvalPresetId = "smoke" | "quick" | "reliability" | "custom";

export interface EvalRunInput {
  name: string;
  setups: EvalSetup[];
  taskIds: string[];
  trials: number;
  wallMs: number;
  preset: EvalPresetId;
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
  hermeticRoot: string;
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
  endToEndMs: number | null;
  tokens: CellTokens | null;
  cost: CellCost;
  observedModel: string | null;
  session: { tool: string; sourceSessionId: string } | null;
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
  progress: { done: number; total: number; currentCell: string | null };
}

export interface EvalTask {
  id: string;
  language: string;
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
  limits: { maxTrials: number; maxSetups: number; defaultWallMs: number; maxWallMs: number };
  activeRunId: string | null;
}

export interface EvalProgressEvent {
  runId: string;
  status: EvalRunStatus;
  done: number;
  total: number;
  currentCell: string | null;
}
