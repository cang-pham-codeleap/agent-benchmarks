import { describe, expect, test } from "bun:test";
import type { EvalCatalog, EvalCell, EvalResults, EvalRunInput } from "../src/eval/types.ts";
import { patchFiles, realRow } from "../src/ui/views/evaluating/real-results.tsx";
import {
  evaluationRunCount,
  evaluationStartReason,
  presetAfterEdit,
} from "../src/ui/views/evaluating-form.ts";

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
  tasks: [{ id: "one", language: "shell", category: "shell", description: "One", suites: [] }],
  presets: [],
  limits: {
    maxTrials: 10,
    maxSetups: 4,
    defaultWallMs: 60000,
    maxWallMs: 600000,
    realDefaultWallMs: 1800000,
  },
  activeRunId: null,
};
const input: EvalRunInput = {
  kind: "benchmark",
  name: "Run",
  setups: [{ harness: "codex", model: "model", config: "current" }],
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
        { ...input, setups: [{ harness: "codex", model: "invalid model", config: "current" }] },
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
