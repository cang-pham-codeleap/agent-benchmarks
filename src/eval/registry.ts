import type { EvalHarness, EvalPreset, EvalPresetId } from "./types.ts";

export interface EvalHarnessDefinition {
  label: string;
  achAgent: string;
  descriptor: object | null;
  versionArgs: string[];
  metered: boolean;
  sessionTool: string;
  /** The CLI's --model needs `provider/model` for an exact match (omp, opencode). */
  qualifiedModels: boolean;
}

export const EVAL_LIMITS = {
  maxTrials: 10,
  maxSetups: 8,
  defaultWallMs: 15 * 60_000,
  maxWallMs: 60 * 60_000,
} as const;

const CORE_TASKS = [
  "js-lru-cache",
  "js-paginate-fix",
  "js-parse-duration",
  "js-refactor-money",
  "py-inventory-refactor",
  "py-merge-intervals",
  "py-roman-fix",
  "py-slugify",
  "shell-csv-colsum",
  "shell-envfile-fix",
  "shell-log-rotate-fix",
  "shell-wordfreq",
] as const;

export const EVAL_PRESETS: Record<Exclude<EvalPresetId, "custom">, EvalPreset> = {
  smoke: {
    id: "smoke",
    label: "Smoke",
    taskIds: ["shell-wordfreq", "js-parse-duration", "py-slugify"],
    trials: 1,
    claim: "Setup runs, edits, verifies and meters. No ranking.",
  },
  quick: {
    id: "quick",
    label: "Quick",
    taskIds: [...CORE_TASKS],
    trials: 1,
    claim: "Large gaps only. Descriptive below 20 tasks.",
  },
  reliability: {
    id: "reliability",
    label: "Reliability",
    taskIds: [...CORE_TASKS],
    trials: 5,
    claim: "pass^5 and pass@5 on these 12 tasks. Not broad superiority.",
  },
};

const baseHarnesses: Record<EvalHarness, EvalHarnessDefinition> = {
  claude: {
    label: "Claude Code",
    achAgent: "claude",
    descriptor: null,
    versionArgs: ["--version"],
    metered: true,
    sessionTool: "claude_code",
    qualifiedModels: false,
  },
  codex: {
    label: "Codex CLI",
    achAgent: "codex",
    descriptor: null,
    versionArgs: ["--version"],
    metered: true,
    sessionTool: "codex",
    qualifiedModels: false,
  },
  copilot: {
    label: "GitHub Copilot",
    achAgent: "copilot",
    descriptor: null,
    versionArgs: ["--version"],
    metered: true,
    sessionTool: "copilot",
    qualifiedModels: false,
  },
  opencode: {
    label: "OpenCode",
    achAgent: "opencode",
    descriptor: null,
    versionArgs: ["--version"],
    metered: true,
    sessionTool: "opencode",
    qualifiedModels: true,
  },
  omp: {
    label: "OMP",
    achAgent: "omp",
    descriptor: { name: "omp", launch: { template: "omp -p --model {model} {prompt}" } },
    versionArgs: ["--version"],
    metered: false,
    sessionTool: "omp",
    qualifiedModels: true,
  },
  droid: {
    label: "Droid",
    achAgent: "droid",
    descriptor: {
      name: "droid",
      launch: { template: "droid exec --auto medium --model {model} {prompt}" },
    },
    versionArgs: ["--version"],
    metered: false,
    sessionTool: "droid",
    qualifiedModels: false,
  },
};

export const EVAL_HARNESSES: Record<string, EvalHarnessDefinition> = {
  ...baseHarnesses,
  // Zero-cost negative control for local smoke tests; intentionally opt-in.
  ...(process.env.AGENT_BENCHMARKS_EVAL_ALLOW_NULL === "1"
    ? {
        null: {
          label: "Null (smoke)",
          achAgent: "null",
          descriptor: null,
          versionArgs: ["--version"],
          metered: false,
          sessionTool: "null",
          qualifiedModels: false,
        },
      }
    : {}),
};
