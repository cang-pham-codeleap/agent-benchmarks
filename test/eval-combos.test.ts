import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evalConfigDir, loadAugments } from "../src/eval/augments.ts";
import { readCombos, saveCombo } from "../src/eval/combos.ts";
import { validateInput } from "../src/eval/runner.ts";

const root = mkdtempSync(join(tmpdir(), "eval-combos-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const fakeBin = join(root, "bin");
mkdirSync(fakeBin);
writeFileSync(join(fakeBin, "claude"), "#!/bin/sh\n");
chmodSync(join(fakeBin, "claude"), 0o755);

const checkFor = (evalDir: string) => {
  const registry = loadAugments(evalDir);
  return (raw: unknown) => validateInput(raw, join(root, "no-ach"), registry, { PATH: fakeBin });
};

const combo = {
  label: "Claude caveman",
  setups: [
    { harness: "claude", model: "haiku", config: "clean" },
    { harness: "claude", model: "haiku", config: "clean", augments: ["caveman"] },
  ],
  taskIds: ["arch-break-cycle"],
  trials: 2,
  wallMs: 60_000,
};

function failure(run: () => unknown): { status: number; code: string; message: string } | null {
  try {
    run();
    return null;
  } catch (error) {
    const { status, code, message } = error as { status: number; code: string; message: string };
    return { status, code, message };
  }
}

describe("saving a combo", () => {
  test("writes <evalDir>/combos/<id>.json, creating the directory, and reads it back", () => {
    const evalDir = join(root, "save");
    const saved = saveCombo(evalDir, { id: "claude-caveman", ...combo }, checkFor(evalDir));
    expect(saved.problem).toBeNull();
    expect(readdirSync(join(evalDir, "combos"))).toEqual(["claude-caveman.json"]);
    expect(readCombos(evalDir, checkFor(evalDir))).toEqual([
      {
        id: "claude-caveman",
        label: "Claude caveman",
        setups: [
          { harness: "claude", model: "haiku", config: "clean", augments: [] },
          { harness: "claude", model: "haiku", config: "clean", augments: ["caveman"] },
        ],
        taskIds: ["arch-break-cycle"],
        trials: 2,
        wallMs: 60_000,
        problem: null,
      },
    ]);
  });

  test("rejects ids outside 1-64 lowercase letters, digits, or hyphens, and an empty label", () => {
    const evalDir = join(root, "bad-id");
    for (const id of ["Claude", "has space", "-lead", "a".repeat(65), ""])
      expect(failure(() => saveCombo(evalDir, { id, ...combo }, checkFor(evalDir)))).toMatchObject({
        status: 400,
        message: "id must be 1-64 lowercase letters, digits, or hyphens",
      });
    expect(
      failure(() => saveCombo(evalDir, { id: "ok", ...combo, label: " " }, checkFor(evalDir)))
        ?.status,
    ).toBe(400);
    expect(
      failure(() => saveCombo(evalDir, { id: "ok", ...combo, trials: 99 }, checkFor(evalDir))),
    ).toMatchObject({ status: 400, message: "trials must be 1..10" });
  });

  test("an existing id needs overwrite; nothing changes without it", () => {
    const evalDir = join(root, "overwrite");
    const check = checkFor(evalDir);
    saveCombo(evalDir, { id: "pair", ...combo }, check);
    const path = join(evalDir, "combos", "pair.json");
    const before = readFileSync(path, "utf8");
    expect(
      failure(() => saveCombo(evalDir, { id: "pair", ...combo, label: "Renamed" }, check)),
    ).toMatchObject({ status: 409, code: "combo_exists" });
    expect(readFileSync(path, "utf8")).toBe(before);
    const saved = saveCombo(
      evalDir,
      { id: "pair", ...combo, label: "Renamed", overwrite: true },
      check,
    );
    expect(saved.label).toBe("Renamed");
    expect(JSON.parse(readFileSync(path, "utf8")).label).toBe("Renamed");
    expect(readdirSync(join(evalDir, "combos"))).toEqual(["pair.json"]);
  });

  test("lands in AGENT_BENCHMARKS_EVAL_DIR when it is set", () => {
    const team = join(root, "team");
    const evalDir = evalConfigDir(join(root, "archive", "a.db"), {
      AGENT_BENCHMARKS_EVAL_DIR: team,
    });
    saveCombo(evalDir, { id: "shared", ...combo }, checkFor(evalDir));
    expect(readdirSync(join(team, "combos"))).toEqual(["shared.json"]);
  });
});

describe("reading combos", () => {
  test("each combo reports what would stop it from starting, and stays listed", () => {
    const evalDir = join(root, "read");
    mkdirSync(join(evalDir, "combos"), { recursive: true });
    const write = (id: string, body: object | string) =>
      writeFileSync(
        join(evalDir, "combos", `${id}.json`),
        typeof body === "string" ? body : JSON.stringify(body),
      );
    write("unknown-augment", {
      ...combo,
      setups: [{ harness: "claude", model: "haiku", config: "clean", augments: ["nope"] }],
    });
    write("missing-task", { ...combo, taskIds: ["no-such-task"] });
    write("no-harness", { ...combo, setups: [{ harness: "codex", model: "m", config: "clean" }] });
    write("too-many", { ...combo, trials: 99 });
    write("two-prompts", {
      ...combo,
      setups: [
        { harness: "claude", model: "haiku", config: "clean", augments: ["caveman", "ponytail"] },
      ],
    });
    write("broken", "{");
    const problems = Object.fromEntries(
      readCombos(evalDir, checkFor(evalDir)).map((entry) => [entry.id, entry.problem]),
    );
    expect(problems["unknown-augment"]).toContain("augments must be a list of");
    expect(problems["missing-task"]).toBe("taskIds must name tasks in the catalog");
    expect(problems["no-harness"]).toBe("codex is not installed");
    expect(problems["too-many"]).toBe("trials must be 1..10");
    expect(problems["two-prompts"]).toBe("at most one prompt-mode augment per setup");
    expect(problems.broken).toContain("broken.json");
    const broken = readCombos(evalDir, checkFor(evalDir)).find((entry) => entry.id === "broken");
    expect(broken).toMatchObject({ label: "broken", setups: [], taskIds: [] });
  });

  test("no combos directory means no combos", () => {
    expect(readCombos(join(root, "empty"), checkFor(join(root, "empty")))).toEqual([]);
  });
});
