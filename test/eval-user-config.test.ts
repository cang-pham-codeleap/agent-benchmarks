import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { augmentSnapshot, evalConfigDir, loadAugments, runAugments } from "../src/eval/augments.ts";
import { groupId } from "../src/eval/paths.ts";
import { augmentInfos, resolveRecipe, writeRecipeFiles } from "../src/eval/registry.ts";
import { writeHarnessShims } from "../src/eval/runner.ts";
import type { EvalProvenance } from "../src/eval/types.ts";

const root = mkdtempSync(join(tmpdir(), "eval-user-config-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function userDir(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, "augments", path, ".."), { recursive: true });
    writeFileSync(join(dir, "augments", path), body);
  }
  return dir;
}

const augment = (recipes: object, extra: object = {}) =>
  JSON.stringify({
    label: "Demo",
    kind: "harness-flag",
    description: "Demo augment.",
    sourceUrl: "https://example.invalid",
    binary: null,
    recipes,
    ...extra,
  });

describe("user augments", () => {
  test("a from file counts by content, not by where the checkout lives", () => {
    const files = (prompt: string) => ({
      "demo.json": augment({ claude: { files: { "p.md": { from: "p.md" } } } }),
      "p.md": prompt,
    });
    const hashOf = (dir: string) => loadAugments(dir).get("demo")?.hash;
    const same = hashOf(userDir("moved-a", files("same")));
    expect(hashOf(userDir("moved-b", files("same")))).toBe(same);
    expect(hashOf(userDir("moved-c", files("edited")))).not.toBe(same);
  });

  test("a user file replaces the bundled augment with the same id, in full", () => {
    const registry = loadAugments(
      userDir("override", { "ptc.json": augment({ claude: { env: { PTC: "1" } } }) }),
    );
    const ptc = registry.get("ptc");
    expect(ptc?.source).toBe("user");
    expect(Object.keys(ptc?.definition?.recipes ?? {})).toEqual(["claude"]);
    expect(registry.get("rtk")?.source).toBe("bundled");
    const info = augmentInfos(registry, { PATH: "" }).find((entry) => entry.id === "ptc");
    expect(info).toMatchObject({ source: "user", label: "Demo", harnesses: ["claude"] });
  });

  test("an invalid file is unavailable with a problem naming the field; the rest still load", () => {
    const registry = loadAugments(
      userDir("invalid", {
        "broken.json": "{ not json",
        "badkind.json": augment({ claude: {} }, { kind: "plugin" }),
        "badharness.json": augment({ aider: {} }),
        "badtype.json": augment({ claude: { args: "--flag" } }),
        "good.json": augment({ claude: { env: { GOOD: "1" } } }),
      }),
    );
    const infos = augmentInfos(registry, { PATH: "" });
    const problem = (id: string) => infos.find((entry) => entry.id === id)?.problem;
    expect(problem("broken")).toContain("invalid JSON");
    expect(problem("badkind")).toContain("kind must be one of");
    expect(problem("badharness")).toContain("recipes.aider is not a known harness");
    expect(problem("badtype")).toContain("recipes.claude.args must be a list of strings");
    expect(infos.find((entry) => entry.id === "broken")).toMatchObject({
      available: false,
      source: "user",
      kind: null,
    });
    expect(problem("good")).toBeNull();
    expect(problem("rtk")).not.toContain("broken");
  });

  test("companion files resolve inside the augment directory; `..` escapes are a problem", () => {
    const dir = userDir("files", {
      "demo/prompt.md": "Be brief.\n",
      "demo.json": augment({
        claude: {
          args: ["--append-system-prompt-file", "{dir}/prompt.md"],
          files: { "prompt.md": { from: "demo/prompt.md" } },
        },
      }),
      "escape.json": augment({
        claude: { files: { "x.md": { from: "../../outside.md" } } },
      }),
    });
    const registry = loadAugments(dir);
    expect(registry.get("escape")?.problem).toContain(
      "recipes.claude.files.x.md.from resolves outside",
    );
    const definition = registry.get("demo")?.definition;
    if (definition == null) throw new Error(String(registry.get("demo")?.problem));
    const out = join(root, "run-augments");
    const recipe = resolveRecipe("claude", "default", ["demo"], { demo: definition }, "g", out);
    expect(recipe.args).toEqual(["--append-system-prompt-file", `${out}/prompt.md`]);
    writeRecipeFiles(out, recipe.files);
    expect(readFileSync(join(out, "prompt.md"), "utf8")).toBe("Be brief.\n");
  });

  test("a missing user directory loads the bundled augments only", () => {
    const registry = loadAugments(join(root, "absent"));
    expect([...registry.keys()].sort()).toEqual([
      "bash-cap",
      "caveman",
      "codegraph",
      "ponytail",
      "ptc",
      "rtk",
    ]);
    expect([...registry.values()].every((entry) => entry.source === "bundled")).toBe(true);
  });

  test("AGENT_BENCHMARKS_EVAL_DIR overrides the evals directory next to the archive", () => {
    expect(evalConfigDir("/data/archive.db", {})).toBe("/data/evals");
    expect(evalConfigDir("/data/archive.db", { AGENT_BENCHMARKS_EVAL_DIR: "/team/evals" })).toBe(
      "/team/evals",
    );
  });
});

describe("augment snapshot", () => {
  const provenance = (augments?: EvalProvenance["augments"]): EvalProvenance => ({
    achDir: "/ach",
    achCommit: "abc",
    achDirty: false,
    harnessVersions: {},
    taskHashes: {},
    executionOrder: [],
    hermeticRoot: null,
    globalConfigNote: "",
    ...(augments == null ? {} : { augments }),
  });

  test("a run executes the definition captured at start after the file is edited", () => {
    const dir = userDir("snapshot", {
      "demo.json": augment({ claude: { args: ["--demo", "v1"] } }),
    });
    const captured = provenance(augmentSnapshot(loadAugments(dir), ["demo"]));
    writeFileSync(
      join(dir, "augments", "demo.json"),
      augment({ claude: { args: ["--demo", "v2"] } }),
    );
    expect(loadAugments(dir).get("demo")?.hash).not.toBe(captured.augments?.demo?.hash);

    const fakeBin = join(root, "snapshot-bin");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(fakeBin, "claude"), `#!/bin/sh\nfor arg do printf '%s\\n' "$arg"; done\n`);
    chmodSync(join(fakeBin, "claude"), 0o755);
    const definitions = Object.fromEntries(
      Object.entries(runAugments(captured)).map(([id, entry]) => [id, entry.definition]),
    );
    const bin = writeHarnessShims(
      join(root, "snapshot-run"),
      groupId("default", ["demo"]),
      ["claude"],
      false,
      fakeBin,
      definitions,
    );
    if (bin == null) throw new Error("no shim written");
    const argv = Bun.spawnSync([join(bin, "claude"), "-p", "hi"]).stdout.toString();
    expect(argv.trimEnd().split("\n")).toEqual(["-p", "hi", "--demo", "v1"]);
  });

  test("a manifest without a snapshot runs the bundled definitions", () => {
    const legacy = runAugments(provenance());
    const bundled = loadAugments(null);
    expect(Object.keys(legacy).sort()).toEqual([...bundled.keys()].sort());
    for (const [id, entry] of Object.entries(legacy)) {
      expect(entry.source).toBe("bundled");
      expect(entry.hash).toBe(bundled.get(id)?.hash ?? "");
    }
  });
});
