import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AugmentRegistry, LoadedAugment } from "./augments.ts";
import { effortLevels } from "./efforts.ts";
import { EvalRequestError } from "./errors.ts";
import { setupKey } from "./stats.ts";
import type {
  AugmentId,
  AugmentKind,
  EvalAugmentInfo,
  EvalConfigMode,
  EvalHarness,
  EvalPreset,
  EvalPresetId,
  EvalSetup,
} from "./types.ts";

export interface DefaultConfigSupport {
  /** Any one must be set: a per-run config dir cannot see a keychain login. */
  requiresAnyEnv?: [string, ...string[]];
  /** Env var that relocates the harness home to a clean per-run directory. */
  homeEnv?: string;
  /** Files relative to the user's home copied into that directory (credentials only). */
  copyFromHome?: string[];
}

/** Args that keep the user's login but drop their hooks, plugins, MCP servers, settings, and instruction files. */
export interface CleanRecipe {
  args: string[];
  /** Built-in tool names pinned explicitly, so an augment can differ by exactly one tool. */
  tools?: { names: string[]; arg: (names: string[]) => string };
  /** How the harness loads an MCP config file; the clean group always passes one. */
  mcpArg?: (file: string) => string[];
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
  clean: CleanRecipe | null;
}

/** A recipe file is generated JSON or a copy of `from`, an absolute path once loaded. */
export type AugmentFile = { from: string } | { json: object };

/** How one augment attaches to one harness. `{dir}` in args expands to the run's augments directory. */
export interface AugmentRecipe {
  args?: string[];
  env?: Record<string, string>;
  files?: Record<string, AugmentFile>;
  mcpServers?: Record<string, object>;
  addTools?: string[];
  /** Shell command run once per cell workspace before the agent starts; `exclude` keeps its output out of diffs. */
  prepare?: { command: string; exclude: string[] };
}

export interface AugmentDefinition {
  label: string;
  kind: AugmentKind;
  description: string;
  sourceUrl: string;
  /** Binary that must be on PATH. */
  binary: string | null;
  recipes: Partial<Record<EvalHarness, AugmentRecipe>>;
}

/** OMP's default built-in tools minus `eval` (the `ptc` augment adds it back) and `ask`, which `omp -p` refuses. */
const OMP_CLEAN_TOOLS = [
  "read",
  "edit",
  "write",
  "bash",
  "grep",
  "glob",
  "find",
  "task",
  "wait",
  "todo",
  "web_search",
  "lsp",
  "ast_edit",
  "debug",
];

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
    clean: {
      args: [
        "--setting-sources",
        "project,local",
        "--permission-mode",
        "auto",
        "--strict-mcp-config",
      ],
      mcpArg: (file) => ["--mcp-config", file],
    },
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
    clean: { args: ["--ignore-user-config"] },
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
    clean: null,
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
    clean: null,
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
    clean: {
      args: ["--no-extensions", "--no-skills", "--no-rules", "--no-context-files"],
      tools: { names: OMP_CLEAN_TOOLS, arg: (names) => `--tools=${names.join(",")}` },
    },
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
    clean: null,
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
          clean: { args: [] },
        },
      }
    : {}),
};

export function defaultConfigProblem(harness: string, env: NodeJS.ProcessEnv): string | null {
  const definition = EVAL_HARNESSES[harness];
  if (definition == null) return `unknown harness: ${harness}`;
  const support = definition.defaultConfig;
  if (support == null) return `default config is not supported for ${definition.label}`;
  if (support.requiresAnyEnv != null && !support.requiresAnyEnv.some((name) => env[name]))
    return `default config needs ${support.requiresAnyEnv.join(" or ")}`;
  const home = env.HOME || homedir();
  const missing = support.copyFromHome?.find((file) => !existsSync(join(home, file)));
  return missing == null ? null : `default config needs ~/${missing}`;
}

export function cleanConfigProblem(harness: string): string | null {
  const definition = EVAL_HARNESSES[harness];
  if (definition == null) return `unknown harness: ${harness}`;
  return definition.clean == null ? `clean config is not supported for ${definition.label}` : null;
}

/** Why the augment cannot run for this harness on this machine, or null. */
export function augmentProblem(
  augment: LoadedAugment,
  harness: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const definition = augment.definition;
  if (definition == null) return augment.problem;
  if (definition.binary != null && Bun.which(definition.binary, { PATH: env.PATH ?? "" }) == null)
    return `${definition.binary} is not on PATH`;
  const recipes =
    harness == null
      ? Object.values(definition.recipes)
      : [definition.recipes[harness as EvalHarness]];
  for (const recipe of recipes)
    for (const file of Object.values(recipe?.files ?? {}))
      if ("from" in file && !existsSync(file.from)) return `${file.from} is missing`;
  return null;
}

export function augmentInfos(
  registry: AugmentRegistry,
  env: NodeJS.ProcessEnv = process.env,
): EvalAugmentInfo[] {
  return [...registry.values()].map((augment) => {
    const definition = augment.definition;
    const problem = augmentProblem(augment, null, env);
    return {
      id: augment.id,
      source: augment.source,
      label: definition?.label ?? augment.id,
      kind: definition?.kind ?? null,
      description: definition?.description ?? "",
      sourceUrl: definition?.sourceUrl ?? "",
      harnesses: Object.keys(definition?.recipes ?? EVAL_HARNESSES) as EvalHarness[],
      available: problem == null,
      problem,
    };
  });
}

/** Accepts a setup's config and augments from a request body; returns the stored form. */
export function validateSetupConfig(
  harness: string,
  config: EvalConfigMode,
  rawAugments: unknown,
  registry: AugmentRegistry,
  env: NodeJS.ProcessEnv = process.env,
): AugmentId[] {
  const definition = EVAL_HARNESSES[harness]!;
  const cleanProblem = config === "clean" ? cleanConfigProblem(harness) : null;
  if (cleanProblem != null) throw new EvalRequestError(cleanProblem, 400, "config_unsupported");
  if (rawAugments == null) return [];
  if (!Array.isArray(rawAugments) || rawAugments.some((id) => typeof id !== "string"))
    throw new EvalRequestError("augments must be a list of augment ids", 400, "augment_unknown");
  const unknown = rawAugments.find((id) => !registry.has(id));
  if (unknown !== undefined)
    throw new EvalRequestError(`unknown augment: ${unknown}`, 400, "augment_unknown");
  const augments = [...new Set(rawAugments as AugmentId[])].sort();
  if (augments.length === 0) return [];
  if (config === "current")
    throw new EvalRequestError(
      "augments need the clean or default config: the current config may already contain them",
      400,
      "augments_unsupported",
    );
  const kinds: AugmentKind[] = [];
  for (const id of augments) {
    const augment = registry.get(id)!;
    const label = augment.definition?.label ?? id;
    if (augment.definition != null && augment.definition.recipes[harness as EvalHarness] == null)
      throw new EvalRequestError(
        `${label} is not supported for ${definition.label}`,
        400,
        "augments_unsupported",
      );
    const problem = augmentProblem(augment, harness, env);
    if (problem != null || augment.definition == null)
      throw new EvalRequestError(`${label}: ${problem}`, 503, "augment_unavailable");
    kinds.push(augment.definition.kind);
  }
  if (kinds.filter((kind) => kind === "prompt-mode").length > 1)
    throw new EvalRequestError(
      "at most one prompt-mode augment per setup",
      400,
      "augments_unsupported",
    );
  return augments;
}

/** Accepts a setup's effort from a request body; missing or empty means the harness default. */
export function parseEffort(harness: string, model: string, raw: unknown): string | undefined {
  if (raw == null || raw === "") return undefined;
  const levels = effortLevels(harness, model);
  if (typeof raw !== "string" || !levels.includes(raw))
    throw new EvalRequestError(
      levels.length === 0
        ? `effort is not supported for ${EVAL_HARNESSES[harness]?.label ?? harness}`
        : `effort for ${model} must be one of ${levels.join(", ")}`,
      400,
      "effort_unsupported",
    );
  return raw;
}

/** Throws on a duplicate; the key is the same one that labels the setup's cells. */
export function rejectDuplicateSetup(seen: Set<string>, setup: EvalSetup): void {
  const key = setupKey(setup);
  if (seen.has(key)) throw new EvalRequestError(`duplicate setup: ${key}`, 400);
  seen.add(key);
}

export interface ResolvedRecipe {
  args: string[];
  env: Record<string, string>;
  /** File name in the augments directory to its source. */
  files: Record<string, AugmentFile>;
  prepare: { command: string; exclude: string[] }[];
}

/** The argv suffix, env, files, and prepare steps one harness gets in one run group. */
export function resolveRecipe(
  harness: string,
  config: EvalConfigMode,
  augments: readonly AugmentId[],
  definitions: Readonly<Record<AugmentId, AugmentDefinition>>,
  groupKey: string,
  dir: string,
): ResolvedRecipe {
  const clean = config === "clean" ? EVAL_HARNESSES[harness]?.clean : null;
  const recipes = augments.flatMap((id) => definitions[id]?.recipes[harness as EvalHarness] ?? []);
  const resolved: ResolvedRecipe = {
    args: [...(clean?.args ?? [])],
    env: {},
    files: {},
    prepare: [],
  };
  if (clean?.tools != null)
    resolved.args.push(
      clean.tools.arg([
        ...clean.tools.names,
        ...recipes.flatMap((recipe) => recipe.addTools ?? []),
      ]),
    );
  const servers = Object.assign({}, ...recipes.map((recipe) => recipe.mcpServers ?? {}));
  const mcpArg = EVAL_HARNESSES[harness]?.clean?.mcpArg;
  if (mcpArg != null && (clean != null || Object.keys(servers).length > 0)) {
    const name = `mcp-${groupKey}.json`;
    resolved.files[name] = { json: { mcpServers: servers } };
    resolved.args.push(...mcpArg(join(dir, name)));
  }
  for (const recipe of recipes) {
    resolved.args.push(...(recipe.args ?? []).map((arg) => arg.replaceAll("{dir}", dir)));
    Object.assign(resolved.env, recipe.env);
    Object.assign(resolved.files, recipe.files);
    if (recipe.prepare != null) resolved.prepare.push(recipe.prepare);
  }
  return resolved;
}

/** Writes a group's recipe files into `dir`; returns each file's sha256 by name. */
export function writeRecipeFiles(
  dir: string,
  files: Record<string, AugmentFile>,
): Record<string, string> {
  mkdirSync(dir, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const [name, file] of Object.entries(files)) {
    const target = join(dir, name);
    // copyFileSync cannot read a compiled binary's embedded files.
    if ("from" in file) writeFileSync(target, readFileSync(file.from));
    else writeFileSync(target, `${JSON.stringify(file.json, null, 2)}\n`);
    hashes[name] = createHash("sha256").update(readFileSync(target)).digest("hex");
  }
  return hashes;
}

export function configGroupEnv(
  config: EvalConfigMode,
  runDir: string,
  harnesses: string[],
  home = homedir(),
): Record<string, string | undefined> {
  if (config !== "default") return { AGENTIC_CODING_HARNESS_DEFAULT_CLAUDE_CONFIG: "1" };
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

/** Deletes the credential copies `configGroupEnv` made; the next spawn copies them again. */
export function removeConfigCredentials(runDir: string): void {
  for (const [harness, definition] of Object.entries(EVAL_HARNESSES))
    for (const file of definition.defaultConfig?.copyFromHome ?? [])
      rmSync(join(runDir, "home", harness, basename(file)), { force: true });
}
