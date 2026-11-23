import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { augmentDefinitions, loadAugments } from "../src/eval/augments.ts";
import { BUNDLED_AUGMENT_FILES, BUNDLED_AUGMENTS } from "../src/eval/bundled-augments.ts";
import { type ResolvedRecipe, resolveRecipe } from "../src/eval/registry.ts";

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
    "rtk.ts": { from: "<bundled>/rtk-omp-extension.txt" },
  }),
  "rtk/omp/default": recipe(["-e", `${DIR}/rtk.ts`], {
    "rtk.ts": { from: "<bundled>/rtk-omp-extension.txt" },
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

const bundled = loadAugments(null);
const definitions = augmentDefinitions(bundled);

function normalizeFrom(from: string): string {
  if (from.startsWith(`${BUNDLED}/`)) return `<bundled>/${from.slice(BUNDLED.length + 1)}`;
  if (from.startsWith(`${homedir()}/`)) return `~/${from.slice(homedir().length + 1)}`;
  return from;
}

function resolved(id: string, harness: string, config: "clean" | "default"): ResolvedRecipe {
  const out = resolveRecipe(harness, config, [id], definitions, "g", DIR);
  for (const [name, file] of Object.entries(out.files))
    if ("from" in file) out.files[name] = { from: normalizeFrom(file.from) };
  return out;
}

describe("bundled augment parity", () => {
  test("every bundled augment loads without a problem and covers the same harnesses as before", () => {
    expect([...bundled.values()].filter((augment) => augment.problem != null)).toEqual([]);
    const actual = Object.entries(definitions).flatMap(([id, definition]) =>
      Object.keys(definition.recipes).flatMap((harness) =>
        ["clean", "default"].map((config) => `${id}/${harness}/${config}`),
      ),
    );
    expect(actual.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  test("every file in evals/augments ships inside the compiled binary", () => {
    const shipped = [
      ...Object.keys(BUNDLED_AUGMENTS).map((id) => `${id}.json`),
      ...Object.keys(BUNDLED_AUGMENT_FILES),
    ];
    expect(shipped.sort()).toEqual(readdirSync(BUNDLED).sort());
  });

  for (const [key, expected] of Object.entries(EXPECTED)) {
    const [id, harness, config] = key.split("/") as [string, string, "clean" | "default"];
    test(`${key} resolves to the same args, env, files, and prepare`, () => {
      expect(resolved(id, harness, config)).toEqual(expected);
    });
  }
});
