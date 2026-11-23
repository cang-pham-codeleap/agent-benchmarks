import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { COPILOT_FUSION_MODEL } from "../sources/copilot.ts";
import type { EvalHarness } from "./types.ts";

type ScannedHarness = EvalHarness | "null";

const CLAUDE_ALIASES = ["fable", "opus", "sonnet", "haiku"];

const scans = new Map<ScannedHarness, Promise<string[]>>();

/** Starts every harness scan once per process; later catalog reads reuse the results. */
export function scanHarnessModels(harnesses: readonly ScannedHarness[]): void {
  for (const harness of harnesses) scanned(harness);
}

/** Models the harness itself reports; `history` fills in only where it reports none. */
export async function harnessModels(harness: ScannedHarness, history: string[]): Promise<string[]> {
  const listed = await scanned(harness);
  if (harness === "claude") {
    return [...new Set([...listed, ...history.filter((model) => model.startsWith("claude-"))])];
  }
  return listed.length > 0 ? listed : history;
}

function scanned(harness: ScannedHarness): Promise<string[]> {
  let scan = scans.get(harness);
  if (scan == null) {
    scan = listModels(harness).catch((error: unknown) => {
      console.error(`[eval/models] ${harness} model scan failed: ${String(error)}`);
      return [];
    });
    scans.set(harness, scan);
  }
  return scan;
}

async function listModels(harness: ScannedHarness): Promise<string[]> {
  switch (harness) {
    case "claude":
      return [...new Set([...CLAUDE_ALIASES, ...claudeCachedModels()])];
    case "codex":
      return codexCachedModels();
    case "copilot":
      return parseCopilotConfigHelp(await run(["copilot", "help", "config"]));
    case "opencode":
      return parseOpencodeModels(await run(["opencode", "models"]));
    case "omp":
      return parseOmpModels(await run(["omp", "models", "--json"]));
    case "droid":
      return parseDroidExecHelp(await run(["droid", "exec", "--help"]));
    case "null":
      return [];
  }
}

function claudeCachedModels(): string[] {
  const file = join(process.env.CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json");
  if (!existsSync(file)) return [];
  const cache = JSON.parse(readFileSync(file, "utf8")).additionalModelOptionsCache;
  return Array.isArray(cache) ? cache.map((option) => option?.value).filter(isString) : [];
}

function codexCachedModels(): string[] {
  const file = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "models_cache.json");
  if (!existsSync(file)) return [];
  const models = JSON.parse(readFileSync(file, "utf8")).models;
  return Array.isArray(models)
    ? models
        .filter((model) => model?.visibility === "list")
        .map((model) => model.slug)
        .filter(isString)
    : [];
}

/**
 * The `model` entry of `copilot help config` enumerates every model the CLI accepts. Fusion is absent
 * there because the CLI selects it as `auto`; the eval shim maps the archive's Fusion label to it.
 */
export function parseCopilotConfigHelp(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*`model`:/.test(line));
  if (start < 0) return [];
  const models = [COPILOT_FUSION_MODEL];
  for (const line of lines.slice(start + 1)) {
    const model = /^\s*- "([^"]+)"\s*$/.exec(line)?.[1];
    if (model == null) break;
    models.push(model);
  }
  return models;
}

export function parseOpencodeModels(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[^\s/]+\/\S+$/.test(line));
}

export function parseOmpModels(text: string): string[] {
  const models = JSON.parse(text).models;
  return Array.isArray(models)
    ? models
        .filter((model) => model?.kind === "chat")
        .map((model) => model.selector)
        .filter(isString)
    : [];
}

/** `droid exec --help` lists built-in and custom models under their own headings. */
export function parseDroidExecHelp(text: string): string[] {
  const models: string[] = [];
  let inList = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^(Available|Custom) Models:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    const model = inList ? /^ {2}(\S+)\s{2,}\S/.exec(line)?.[1] : undefined;
    if (model == null) inList = false;
    else models.push(model);
  }
  return models;
}

async function run([binary, ...args]: [string, ...string[]]): Promise<string> {
  if (Bun.which(binary) == null) return "";
  const command = [binary, ...args];
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => child.kill(), 20_000);
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  clearTimeout(timer);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited ${exitCode}`);
  return stdout;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
