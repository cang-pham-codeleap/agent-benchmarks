import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { BUNDLED_AUGMENT_FILES, BUNDLED_AUGMENTS } from "./bundled-augments.ts";
import {
  type AugmentDefinition,
  type AugmentFile,
  type AugmentRecipe,
  EVAL_HARNESSES,
} from "./registry.ts";
import type {
  AugmentId,
  AugmentKind,
  AugmentSource,
  EvalHarness,
  EvalProvenance,
} from "./types.ts";

type ResolveFrom = (from: string, field: string) => string;
export const EVAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KINDS: readonly AugmentKind[] = ["shell-proxy", "mcp", "prompt-mode", "harness-flag"];
const DEFINITION_KEYS = ["label", "kind", "description", "sourceUrl", "binary", "recipes"];
const RECIPE_KEYS = ["args", "env", "files", "mcpServers", "addTools", "prepare"];

export interface LoadedAugment {
  id: AugmentId;
  source: AugmentSource;
  /** null when the file failed validation; `problem` then says why. */
  definition: AugmentDefinition | null;
  /** sha256 of the canonical JSON of `definition` with `from` paths resolved; null when invalid. */
  hash: string | null;
  problem: string | null;
}

export type AugmentRegistry = ReadonlyMap<AugmentId, LoadedAugment>;

/** The captured definition a run executes from. */
export interface AugmentSnapshot {
  source: AugmentSource;
  hash: string;
  definition: AugmentDefinition;
}

export function evalConfigDir(dbPath: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_BENCHMARKS_EVAL_DIR || join(dirname(dbPath), "evals");
}

/** Bundled definitions first; a user file with the same id replaces the bundled one. Null reads bundled only. */
export function loadAugments(evalDir: string | null): AugmentRegistry {
  const registry = new Map<AugmentId, LoadedAugment>();
  for (const [id, raw] of Object.entries(BUNDLED_AUGMENTS))
    registry.set(
      id,
      loadAugment(
        `evals/augments/${id}.json`,
        id,
        "bundled",
        () => structuredClone(raw),
        resolveBundled,
      ),
    );
  const userDir = evalDir == null ? null : join(evalDir, "augments");
  if (userDir == null || !existsSync(userDir)) return registry;
  for (const name of readdirSync(userDir).sort()) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    const path = join(userDir, name);
    registry.set(
      id,
      loadAugment(path, id, "user", () => readJson(path), resolveIn(userDir)),
    );
  }
  return registry;
}

/** Valid definitions by id. */
export function augmentDefinitions(
  registry: AugmentRegistry,
): Record<AugmentId, AugmentDefinition> {
  const definitions: Record<AugmentId, AugmentDefinition> = {};
  for (const augment of registry.values())
    if (augment.definition != null) definitions[augment.id] = augment.definition;
  return definitions;
}

export function augmentSnapshot(
  registry: AugmentRegistry,
  ids: Iterable<AugmentId>,
): Record<AugmentId, AugmentSnapshot> {
  const snapshot: Record<AugmentId, AugmentSnapshot> = {};
  for (const id of ids) {
    const augment = registry.get(id);
    if (augment?.definition == null || augment.hash == null) continue;
    snapshot[id] = { source: augment.source, hash: augment.hash, definition: augment.definition };
  }
  return snapshot;
}

/** The augments a run executes from: its captured snapshot, or the bundled ones for runs recorded before snapshots. */
export function runAugments(provenance: EvalProvenance): Record<AugmentId, AugmentSnapshot> {
  if (provenance.augments != null) return provenance.augments;
  const bundled = loadAugments(null);
  return augmentSnapshot(bundled, bundled.keys());
}

function loadAugment(
  location: string,
  id: AugmentId,
  source: AugmentSource,
  read: () => unknown,
  resolveFrom: ResolveFrom,
): LoadedAugment {
  try {
    if (!EVAL_ID_PATTERN.test(id))
      throw new Error("file name must be 1-64 lowercase letters, digits, or hyphens");
    const definition = parseDefinition(read(), resolveFrom);
    const hash = createHash("sha256").update(canonical(definition)).digest("hex");
    return { id, source, definition, hash, problem: null };
  } catch (error) {
    const problem = `${location}: ${error instanceof Error ? error.message : String(error)}`;
    return { id, source, definition: null, hash: null, problem };
  }
}

function readJson(path: string): unknown {
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Stable text for hashing; a `{ from }` file counts by its content, so moving the checkout keeps the hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value != null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.from === "string" && Object.keys(record).length === 1) {
      const digest = existsSync(record.from)
        ? createHash("sha256").update(readFileSync(record.from)).digest("hex")
        : null;
      return `{"sha256":${JSON.stringify(digest)}}`;
    }
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${field} must be a list of strings`);
  return value;
}

function onlyKeys(value: Record<string, unknown>, allowed: string[], field: string): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra != null) throw new Error(`${field}.${extra} is not a known field`);
}

function parseDefinition(raw: unknown, resolveFrom: ResolveFrom): AugmentDefinition {
  const value = object(raw, "augment");
  onlyKeys(value, DEFINITION_KEYS, "augment");
  const label = string(value.label, "label");
  if (label.trim() === "") throw new Error("label must not be empty");
  if (!KINDS.includes(value.kind as AugmentKind))
    throw new Error(`kind must be one of: ${KINDS.join(", ")}`);
  if (value.binary !== null && typeof value.binary !== "string")
    throw new Error("binary must be a string or null");
  const recipes: Partial<Record<EvalHarness, AugmentRecipe>> = {};
  for (const [harness, recipe] of Object.entries(object(value.recipes, "recipes"))) {
    if (EVAL_HARNESSES[harness] == null)
      throw new Error(`recipes.${harness} is not a known harness`);
    recipes[harness as EvalHarness] = parseRecipe(recipe, `recipes.${harness}`, resolveFrom);
  }
  return {
    label,
    kind: value.kind as AugmentKind,
    description: string(value.description, "description"),
    sourceUrl: string(value.sourceUrl, "sourceUrl"),
    binary: value.binary,
    recipes,
  };
}

function parseRecipe(raw: unknown, field: string, resolveFrom: ResolveFrom): AugmentRecipe {
  const value = object(raw, field);
  onlyKeys(value, RECIPE_KEYS, field);
  const recipe: AugmentRecipe = {};
  if (value.args !== undefined) recipe.args = strings(value.args, `${field}.args`);
  if (value.addTools !== undefined) recipe.addTools = strings(value.addTools, `${field}.addTools`);
  if (value.env !== undefined) {
    const env = object(value.env, `${field}.env`);
    for (const [key, item] of Object.entries(env)) string(item, `${field}.env.${key}`);
    recipe.env = env as Record<string, string>;
  }
  if (value.mcpServers !== undefined) {
    const servers = object(value.mcpServers, `${field}.mcpServers`);
    for (const [name, server] of Object.entries(servers))
      object(server, `${field}.mcpServers.${name}`);
    recipe.mcpServers = servers as Record<string, object>;
  }
  if (value.prepare !== undefined) {
    const prepare = object(value.prepare, `${field}.prepare`);
    onlyKeys(prepare, ["command", "exclude"], `${field}.prepare`);
    recipe.prepare = {
      command: string(prepare.command, `${field}.prepare.command`),
      exclude: strings(prepare.exclude, `${field}.prepare.exclude`),
    };
  }
  if (value.files !== undefined) {
    const files: Record<string, AugmentFile> = {};
    for (const [name, file] of Object.entries(object(value.files, `${field}.files`)))
      files[name] = parseFile(name, file, `${field}.files.${name}`, resolveFrom);
    recipe.files = files;
  }
  return recipe;
}

function parseFile(
  name: string,
  raw: unknown,
  field: string,
  resolveFrom: ResolveFrom,
): AugmentFile {
  // The name becomes a path inside the run's augments directory.
  if (name === "." || name === ".." || /[/\\]/.test(name))
    throw new Error(`${field} must be a plain file name`);
  const value = object(raw, field);
  if ("json" in value && Object.keys(value).length === 1)
    return { json: object(value.json, `${field}.json`) };
  if (!("from" in value) || Object.keys(value).length !== 1)
    throw new Error(`${field} must be { "from": path } or { "json": object }`);
  return { from: resolveFrom(string(value.from, `${field}.from`), `${field}.from`) };
}

function resolveBundled(from: string, field: string): string {
  const path = BUNDLED_AUGMENT_FILES[from];
  if (path == null) throw new Error(`${field} must name a file in evals/augments`);
  return path;
}

function resolveIn(dir: string): ResolveFrom {
  return (from, field) => {
    const home = homedir();
    const [base, path] = from.startsWith("~/")
      ? [home, resolve(home, from.slice(2))]
      : [dir, resolve(dir, from)];
    if (path !== base && !path.startsWith(`${base}${sep}`))
      throw new Error(`${field} resolves outside ${base}`);
    return path;
  };
}
