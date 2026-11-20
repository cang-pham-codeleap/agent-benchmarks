import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { EvalConfigMode, EvalHarness, EvalPreset, EvalPresetId } from "./types.ts";

export interface DefaultConfigSupport {
  /** At least one must be set: a per-run config dir cannot see a keychain login. */
  requiresAnyEnv?: string[];
  /** Env var that relocates the harness home to a clean per-run directory. */
  homeEnv?: string;
  /** Files relative to the user's home copied into that directory (credentials only). */
  copyFromHome?: string[];
}

export interface EvalHarnessDefinition {
  label: string;
  achAgent: string;
  descriptor: object | null;
  versionArgs: string[];
  metered: boolean;
  sessionTool: string;
  /** The CLI's --model needs `provider/model` for an exact match (omp, opencode). */
  qualifiedModels: boolean;
  defaultConfig: DefaultConfigSupport | null;
}

export const EVAL_LIMITS = {
  maxTrials: 10,
  maxSetups: 8,
  defaultWallMs: 15 * 60_000,
  maxWallMs: 60 * 60_000,
  realDefaultWallMs: 30 * 60_000,
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
    defaultConfig: { requiresAnyEnv: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] },
  },
  codex: {
    label: "Codex CLI",
    achAgent: "codex",
    descriptor: null,
    versionArgs: ["--version"],
    metered: true,
    sessionTool: "codex",
    qualifiedModels: false,
    defaultConfig: { homeEnv: "CODEX_HOME", copyFromHome: [".codex/auth.json"] },
  },
  copilot: {
    label: "GitHub Copilot",
    achAgent: "copilot",
    descriptor: null,
    versionArgs: ["--version"],
    metered: true,
    sessionTool: "copilot",
    qualifiedModels: false,
    defaultConfig: null,
  },
  opencode: {
    label: "OpenCode",
    achAgent: "opencode",
    descriptor: null,
    versionArgs: ["--version"],
    metered: true,
    sessionTool: "opencode",
    qualifiedModels: true,
    defaultConfig: null,
  },
  omp: {
    label: "OMP",
    achAgent: "omp",
    descriptor: { name: "omp", launch: { template: "omp -p --model {model} {prompt}" } },
    versionArgs: ["--version"],
    metered: false,
    sessionTool: "omp",
    qualifiedModels: true,
    defaultConfig: null,
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
    defaultConfig: null,
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
          defaultConfig: {},
        },
      }
    : {}),
};

export function defaultConfigProblem(harness: string, env: NodeJS.ProcessEnv): string | null {
  const definition = EVAL_HARNESSES[harness];
  if (definition == null) return `unknown harness: ${harness}`;
  const support = definition.defaultConfig;
  if (support == null) return `default config is not supported for ${definition.label}`;
  if (support.requiresAnyEnv?.length && !support.requiresAnyEnv.some((name) => env[name]))
    return `default config needs ${support.requiresAnyEnv.join(" or ")}`;
  const home = env.HOME || homedir();
  const missing = support.copyFromHome?.find((file) => !existsSync(join(home, file)));
  return missing == null ? null : `default config needs ~/${missing}`;
}

export function configGroupEnv(
  config: EvalConfigMode,
  runDir: string,
  harnesses: string[],
  home = homedir(),
): Record<string, string | undefined> {
  if (config === "current") return { AGENTIC_CODING_HARNESS_DEFAULT_CLAUDE_CONFIG: "1" };
  const env: Record<string, string | undefined> = {
    AGENTIC_CODING_HARNESS_DEFAULT_CLAUDE_CONFIG: undefined,
  };
  for (const [harness, definition] of Object.entries(EVAL_HARNESSES)) {
    const support = definition.defaultConfig;
    if (support?.homeEnv == null) continue;
    const dir = join(runDir, "home", harness);
    env[support.homeEnv] = dir;
    if (!harnesses.includes(harness)) continue;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const file of support.copyFromHome ?? []) {
      const source = join(home, file);
      if (!existsSync(source)) continue;
      const target = join(dir, basename(file));
      copyFileSync(source, target);
      chmodSync(target, 0o600);
    }
  }
  return env;
}
