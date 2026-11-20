import { describe, expect, test } from "bun:test";
import type { EvalCatalog, EvalRunInput } from "../src/eval/types.ts";
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
    },
  ],
  tasks: [{ id: "one", language: "shell", description: "One", suites: [] }],
  presets: [],
  limits: { maxTrials: 10, maxSetups: 4, defaultWallMs: 60000, maxWallMs: 600000 },
  activeRunId: null,
};
const input: EvalRunInput = {
  name: "Run",
  setups: [{ harness: "codex", model: "model" }],
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
        { ...input, setups: [{ harness: "codex", model: "invalid model" }] },
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
