import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { EVAL_AUGMENTS, type ResolvedRecipe, resolveRecipe } from "../src/eval/registry.ts";

const DIR = "/run/augments";
const BUNDLED = join(import.meta.dir, "..", "evals", "augments");
const CLAUDE_CLEAN = [
  "--setting-sources",
  "project,local",
  "--permission-mode",
  "auto",
  "--strict-mcp-config",
  "--mcp-config",
  `${DIR}/mcp-g.json`,
];
const OMP_TOOLS =
  "read,edit,write,bash,grep,glob,find,task,wait,todo,web_search,lsp,ast_edit,debug";
const OMP_CLEAN = [
  "--no-extensions",
  "--no-skills",
  "--no-rules",
  "--no-context-files",
  `--tools=${OMP_TOOLS}`,
];
const NO_SERVERS = { "mcp-g.json": { json: { mcpServers: {} } } };
const RTK_SETTINGS = {
  "rtk-settings.json": {
    json: {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }],
      },
    },
  },
};
const CODEGRAPH_SERVERS = {
  "mcp-g.json": {
    json: {
      mcpServers: {
        codegraph: { type: "stdio", command: "codegraph", args: ["serve", "--mcp"] },
      },
    },
  },
};
const CODEGRAPH_PREPARE = [{ command: "codegraph init", exclude: [".codegraph"] }];
const prompt = (file: string) => ({ [file]: { from: `<bundled>/${file}` } });
const recipe = (
  args: string[],
  files: ResolvedRecipe["files"] = {},
  env: ResolvedRecipe["env"] = {},
  prepare: ResolvedRecipe["prepare"] = [],
): ResolvedRecipe => ({ args, env, files, prepare });

const EXPECTED: Record<string, ResolvedRecipe> = {
  "rtk/claude/clean": recipe([...CLAUDE_CLEAN, "--settings", `${DIR}/rtk-settings.json`], {
    ...NO_SERVERS,
    ...RTK_SETTINGS,
  }),
  "rtk/claude/default": recipe(["--settings", `${DIR}/rtk-settings.json`], RTK_SETTINGS),
  "rtk/omp/clean": recipe([...OMP_CLEAN, "-e", `${DIR}/rtk.ts`], {
    "rtk.ts": { from: "~/.omp/agent/extensions/rtk.ts" },
  }),
  "rtk/omp/default": recipe(["-e", `${DIR}/rtk.ts`], {
    "rtk.ts": { from: "~/.omp/agent/extensions/rtk.ts" },
  }),
  "codegraph/claude/clean": recipe(CLAUDE_CLEAN, CODEGRAPH_SERVERS, {}, CODEGRAPH_PREPARE),
  "codegraph/claude/default": recipe(
    ["--mcp-config", `${DIR}/mcp-g.json`],
    CODEGRAPH_SERVERS,
    {},
    CODEGRAPH_PREPARE,
  ),
  "caveman/claude/clean": recipe(
    [...CLAUDE_CLEAN, "--append-system-prompt-file", `${DIR}/caveman.md`],
    { ...NO_SERVERS, ...prompt("caveman.md") },
  ),
  "caveman/claude/default": recipe(
    ["--append-system-prompt-file", `${DIR}/caveman.md`],
    prompt("caveman.md"),
  ),
  "caveman/omp/clean": recipe(
    [...OMP_CLEAN, `--append-system-prompt=${DIR}/caveman.md`],
    prompt("caveman.md"),
  ),
  "caveman/omp/default": recipe([`--append-system-prompt=${DIR}/caveman.md`], prompt("caveman.md")),
  "ponytail/claude/clean": recipe(
    [...CLAUDE_CLEAN, "--append-system-prompt-file", `${DIR}/ponytail.md`],
    { ...NO_SERVERS, ...prompt("ponytail.md") },
  ),
  "ponytail/claude/default": recipe(
    ["--append-system-prompt-file", `${DIR}/ponytail.md`],
    prompt("ponytail.md"),
  ),
  "ponytail/omp/clean": recipe(
    [...OMP_CLEAN, `--append-system-prompt=${DIR}/ponytail.md`],
    prompt("ponytail.md"),
  ),
  "ponytail/omp/default": recipe(
    [`--append-system-prompt=${DIR}/ponytail.md`],
    prompt("ponytail.md"),
  ),
  "ptc/omp/clean": recipe([
    "--no-extensions",
    "--no-skills",
    "--no-rules",
    "--no-context-files",
    `--tools=${OMP_TOOLS},eval`,
  ]),
  "ptc/omp/default": recipe([]),
  "bash-cap/claude/clean": recipe(CLAUDE_CLEAN, NO_SERVERS, { BASH_MAX_OUTPUT_LENGTH: "8000" }),
  "bash-cap/claude/default": recipe([], {}, { BASH_MAX_OUTPUT_LENGTH: "8000" }),
};

function normalizeFrom(from: string): string {
  if (from.startsWith(`${BUNDLED}/`)) return `<bundled>/${from.slice(BUNDLED.length + 1)}`;
  if (from.startsWith(`${homedir()}/`)) return `~/${from.slice(homedir().length + 1)}`;
  return from.startsWith("~/") ? from : `<bundled>/${from}`;
}

function resolved(id: string, harness: string, config: "clean" | "default") {
  const out = resolveRecipe(harness, config, [id as never], "g", DIR);
  for (const [name, file] of Object.entries(out.files))
    if ("from" in file) out.files[name] = { from: normalizeFrom(file.from) };
  return out;
}

describe("bundled augment parity", () => {
  test("every bundled augment covers the same harnesses as before", () => {
    const actual = Object.entries(EVAL_AUGMENTS).flatMap(([id, definition]) =>
      Object.keys(definition.recipes).flatMap((harness) =>
        ["clean", "default"].map((config) => `${id}/${harness}/${config}`),
      ),
    );
    expect(actual.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [key, expected] of Object.entries(EXPECTED)) {
    const [id, harness, config] = key.split("/") as [string, string, "clean" | "default"];
    test(`${key} resolves to the same args, env, files, and prepare`, () => {
      expect(resolved(id, harness, config)).toEqual(expected);
    });
  }
});
