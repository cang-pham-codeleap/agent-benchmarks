import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  AugmentId,
  AugmentPoolEntry,
  AugmentVerdict,
  EvalAugmentInfo,
  EvalCatalog,
  EvalCell,
  EvalComboInfo,
  EvalHarness,
  EvalResults,
  EvalRunInput,
  EvalSetup,
} from "../src/eval/types.ts";
import { AugmentPoolPanel, AugmentVerdictTable } from "../src/ui/views/evaluating/augments.tsx";
import { EvalForm } from "../src/ui/views/evaluating/form.tsx";
import { patchFiles, realRow } from "../src/ui/views/evaluating/real-results.tsx";
import {
  applyCombo,
  augmentChoices,
  augmentSweep,
  evaluationRunCount,
  evaluationStartReason,
  presetAfterEdit,
  setupText,
} from "../src/ui/views/evaluating-form.ts";

const augment = (id: AugmentId, harnesses: EvalHarness[], available: boolean): EvalAugmentInfo => ({
  id,
  source: "bundled",
  label: id,
  kind: "shell-proxy",
  description: id,
  sourceUrl: "https://example.com",
  harnesses,
  available,
  problem: available ? null : `${id} is not installed`,
});

const catalog: EvalCatalog = {
  ach: { dir: "/ach", ok: true, problem: null, commit: "abc" },
  harnesses: [
    {
      harness: "codex",
      label: "Codex",
      installed: true,
      version: "1",
      knownModels: [],
      metered: true,
      defaultConfigProblem: null,
    },
  ],
  tasks: [
    {
      id: "one",
      language: "shell",
      category: "shell",
      difficulty: "easy",
      description: "One",
      suites: [],
    },
  ],
  presets: [],
  limits: {
    maxTrials: 10,
    maxSetups: 4,
    defaultWallMs: 60000,
    maxWallMs: 600000,
    realDefaultWallMs: 1800000,
  },
  activeRunId: null,
  augments: [
    augment("rtk", ["claude", "codex"], true),
    augment("codegraph", ["claude", "codex"], true),
    augment("caveman", ["claude"], true),
    augment("ptc", ["codex"], false),
  ],
  evalDir: "/home/user/.agent-benchmarks/evals",
  combos: [],
  canPickFolder: false,
};
const input: EvalRunInput = {
  kind: "benchmark",
  name: "Run",
  setups: [{ harness: "codex", model: "model", config: "current", augments: [] }],
  taskIds: ["one"],
  trials: 2,
  wallMs: 60000,
  preset: "smoke",
};

describe("evaluation form", () => {
  test("counts setup × task × trial runs", () => {
    expect(
      evaluationRunCount({
        ...input,
        setups: [input.setups[0]!, input.setups[0]!],
        taskIds: ["one", "two"],
      }),
    ).toBe(8);
  });
  test("explains invalid inputs and active runs", () => {
    expect(evaluationStartReason(input, catalog, false)).toBeNull();
    expect(evaluationStartReason(input, { ...catalog, activeRunId: "run" }, false)).toContain(
      "active",
    );
    expect(
      evaluationStartReason(
        {
          ...input,
          setups: [{ harness: "codex", model: "invalid model", config: "current", augments: [] }],
        },
        catalog,
        false,
      ),
    ).toContain("model");
    expect(evaluationStartReason({ ...input, taskIds: [] }, catalog, false)).toContain("task");
    expect(evaluationStartReason({ ...input, trials: 11 }, catalog, false)).toContain("trial");
    expect(evaluationStartReason({ ...input, wallMs: 1.5 }, catalog, false)).toContain("timeout");
  });
  test("task and trial edits make presets custom", () => {
    expect(presetAfterEdit("smoke", "tasks")).toBe("custom");
    expect(presetAfterEdit("quick", "trials")).toBe("custom");
    expect(presetAfterEdit("quick", "setup")).toBe("quick");
  });
});

const cell = (
  cellId: string,
  outcome: EvalCell["outcome"],
  agentMs: number,
  cost: EvalCell["cost"],
): EvalCell => ({
  cellId,
  setupKey: "codex:model:current",
  taskId: "real",
  trial: 1,
  outcome,
  agentMs,
  verifyMs: null,
  endToEndMs: null,
  tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
  cost,
  observedModel: null,
  session: null,
  prepMs: null,
  raw: { status: "", exitStatus: null, verify: null, error: null, runId: null },
});
const summary = (passed: number, exitCode: number) => ({
  diffStat: { files: ["a.ts"], added: 4, removed: 2 },
  checks: [{ command: "bun test", exitCode, timedOut: false, durationMs: 1, log: "x" }],
  hidden: { passed, total: 1, files: [] },
  fileOverlap: 0.5,
  sizeRatio: 2,
  turns: null,
  toolCalls: null,
});

describe("real results", () => {
  test("aggregates trials without hiding unavailable cost", () => {
    const real = {
      cells: { a: summary(1, 0), b: summary(0, 1) },
    } as unknown as NonNullable<EvalResults["real"]>;
    const row = realRow(
      "k",
      "codex",
      [
        cell("a", "passed", 1000, { kind: "priced", usd: 1, basis: "harness-reported" }),
        cell("b", "verify-failed", 3000, { kind: "unavailable", reason: "not-found" }),
      ],
      real,
    );
    expect(row.passRate).toBe(0.5);
    expect(row.hidden).toEqual({ passed: 1, total: 2 });
    expect(row.checks).toEqual({ passed: 1, total: 2 });
    expect(row.agentP50Ms).toBe(1000);
    expect(row.agentRange).not.toBeNull();
    expect(row.tokens).toBe(30);
    expect(row.cost).toContain("1/2 priced");
    expect(row.cost).toContain("not-found");
    const none = realRow(
      "k",
      "x",
      [cell("c", "passed", 1, { kind: "unavailable", reason: "not-metered" })],
      real,
    );
    expect(none.cost).toBe("n/a (not-metered)");
  });
  test("splits a unified patch per file", () => {
    const files = patchFiles(
      "diff --git a/x.ts b/x.ts\nindex 1..2\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/y.ts b/y.ts\n+c",
    );
    expect(files.map((f) => f.path)).toEqual(["x.ts", "y.ts"]);
    expect(files[0]!.lines).toEqual(["@@ -1 +1 @@", "-a", "+b"]);
  });
});

const clean = (augments: AugmentId[] = []): EvalSetup => ({
  harness: "codex",
  model: "model",
  config: "clean",
  augments,
});

describe("augments", () => {
  test("choices exist only for clean or default config and only for the harness's recipes", () => {
    expect(augmentChoices(catalog, "codex", "current")).toEqual([]);
    for (const config of ["clean", "default"] as const)
      expect(augmentChoices(catalog, "codex", config).map((a) => a.id)).toEqual([
        "rtk",
        "codegraph",
        "ptc",
      ]);
    expect(augmentChoices(catalog, "claude", "clean").map((a) => a.id)).toEqual([
      "rtk",
      "codegraph",
      "caveman",
    ]);
  });

  test("sweep gives a clean baseline plus one setup per available augment", () => {
    expect(augmentSweep([clean()], 0, catalog)).toEqual([
      clean(),
      clean(["rtk"]),
      clean(["codegraph"]),
    ]);
  });

  test("sweep turns a current setup into clean and respects the setup limit", () => {
    const current: EvalSetup = { ...clean(), config: "current" };
    const other: EvalSetup = { ...clean(), model: "other" };
    const sweep = augmentSweep([other, other, current], 2, {
      ...catalog,
      limits: { ...catalog.limits, maxSetups: 4 },
    });
    expect(sweep).toEqual([other, other, clean(), clean(["rtk"])]);
  });

  test("setup text and uniqueness include augments", () => {
    expect(setupText(clean())).toBe("codex · model · clean");
    expect(setupText(clean(["codegraph", "rtk"]))).toBe("codex · model · clean · +codegraph +rtk");
    const withAugment = { ...input, setups: [clean(), clean(["rtk"])] };
    expect(evaluationStartReason(withAugment, catalog, false)).toBeNull();
    expect(
      evaluationStartReason({ ...withAugment, setups: [clean(), clean()] }, catalog, false),
    ).toBe("Each setup must be unique.");
  });

  test("verdict table renders a verdict row", () => {
    const verdict: AugmentVerdict = {
      baseline: "codex:model:clean",
      augmented: "codex:model:clean+rtk",
      harness: "codex",
      model: "model",
      config: "clean",
      augments: ["rtk"],
      pairs: 24,
      minTrials: 3,
      passDelta: 0,
      better: 1,
      worse: 1,
      tokenDelta: -0.2,
      costDelta: -0.25,
      savingBasis: "cost",
      prepMs: 1500,
      verdict: "adopt",
      reason: "Saved 25% cost with no quality loss.",
    };
    const html = renderToStaticMarkup(createElement(AugmentVerdictTable, { verdicts: [verdict] }));
    for (const text of [
      "Adopt",
      "24",
      "0.0 pts",
      "-25.0%",
      "cost",
      "1 / 1",
      "1.5 s",
      verdict.reason,
    ])
      expect(html).toContain(text);
  });
});

describe("combos", () => {
  const combo = (patch: Partial<EvalComboInfo> = {}): EvalComboInfo => ({
    id: "pair",
    label: "Codex pair",
    setups: [clean(), clean(["rtk"])],
    taskIds: ["one"],
    trials: 3,
    wallMs: 120000,
    problem: null,
    ...patch,
  });
  const form = (overrides: Partial<EvalCatalog>, setups = input.setups) =>
    renderToStaticMarkup(
      createElement(EvalForm, {
        catalog: { ...catalog, ...overrides },
        input: { ...input, setups },
        onChange: () => {},
        onStart: () => {},
        onCombosChange: () => {},
        busy: false,
      }),
    );

  test("loading a combo fills setups, tasks, trials, and timeout as a custom preset", () => {
    expect(applyCombo(combo(), catalog)).toEqual({
      input: {
        kind: "benchmark",
        name: "Codex pair",
        setups: [clean(), clean(["rtk"])],
        taskIds: ["one"],
        trials: 3,
        wallMs: 120000,
        preset: "custom",
      },
      dropped: [],
    });
  });

  test("loading drops what this machine lacks and lists it", () => {
    const { input: loaded, dropped } = applyCombo(
      combo({
        setups: [
          clean(["context-mode", "rtk"]),
          { harness: "claude", model: "haiku", config: "clean", augments: [] },
        ],
        taskIds: ["one", "gone"],
      }),
      catalog,
    );
    expect(loaded.setups).toEqual([clean(["rtk"])]);
    expect(loaded.taskIds).toEqual(["one"]);
    expect(dropped).toEqual([
      "Augment context-mode: not in the catalog",
      "Setup claude · haiku · clean: claude is not installed",
      "Task gone: not in the catalog",
    ]);
  });

  test("the combos row is hidden without combos and shows a broken combo's problem", () => {
    expect(form({ combos: [] })).not.toContain("Combos");
    const html = form({ combos: [combo({ problem: "codex is not installed" })] });
    for (const text of ["Combos", "Codex pair", "2 setups · 1 tasks × 3", "codex is not installed"])
      expect(html).toContain(text);
    expect(html).toContain("Save as combo…");
  });

  test("a user augment carries a user badge", () => {
    const user = { ...augment("context-mode", ["codex"], true), source: "user" as const };
    const html = form({ augments: [user] }, [clean()]);
    expect(html).toMatch(/context-mode<span[^>]*>user<\/span>/);
  });

  test("a pool that mixed augment definitions shows a drift warning", () => {
    const entry: AugmentPoolEntry = {
      harness: "codex",
      model: "model",
      config: "clean",
      augments: ["rtk"],
      harnessVersion: "1",
      runIds: ["a", "b"],
      pairs: 24,
      minTrials: 3,
      passDelta: 0,
      better: 0,
      worse: 0,
      tokenDelta: -0.2,
      costDelta: null,
      savingBasis: "tokens",
      prepMs: null,
      verdict: "adopt",
      reason: "Saved tokens.",
      recipeDrift: false,
    };
    const render = (recipeDrift: boolean) =>
      renderToStaticMarkup(
        createElement(AugmentPoolPanel, { entries: [{ ...entry, recipeDrift }] }),
      );
    expect(render(false)).not.toContain("recipe drift");
    expect(render(true)).toContain("recipe drift");
  });
});
