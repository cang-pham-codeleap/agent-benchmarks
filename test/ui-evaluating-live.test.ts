import { describe, expect, test } from "bun:test";
import type { CellStream, EvalCell, EvalResults } from "../src/eval/types.ts";
import {
  compareChoices,
  defaultCompareKey,
  mergeStream,
  watchTarget,
} from "../src/ui/views/evaluating/live-model.ts";

const cell = (cellId: string, taskId: string, trial: number, outcome: EvalCell["outcome"]) =>
  ({ cellId, taskId, trial, outcome, setupKey: cellId }) as EvalCell;

function results(status: string, liveCellId: string | null): EvalResults {
  return {
    manifest: { status },
    cells: [
      cell("a", "t1", 1, "passed"),
      cell("b", "t1", 1, liveCellId === "b" ? "pending" : "passed"),
      cell("c", "t2", 1, "pending"),
    ],
    progress: { done: 1, total: 3, currentCell: null, liveCellId },
  } as EvalResults;
}

describe("watch and compare targets", () => {
  test("pinned wins, then live, then unknown while running, then last recorded", () => {
    expect(watchTarget(results("running", "b"), "a")).toEqual({ cellId: "a", reason: "pinned" });
    expect(watchTarget(results("running", "b"), "gone")).toEqual({ cellId: "b", reason: "live" });
    expect(watchTarget(results("running", null), null)).toEqual({
      cellId: null,
      reason: "unknown",
    });
    expect(watchTarget(results("completed", null), null)).toEqual({
      cellId: "b",
      reason: "recorded",
    });
  });

  test("compare defaults to the live cell's task and trial", () => {
    const run = results("running", "c");
    expect(compareChoices(run.cells).map((choice) => choice.taskId)).toEqual(["t1", "t2"]);
    expect(defaultCompareKey(run, null)).toBe("t2\u00001");
    expect(defaultCompareKey(run, "a")).toBe("t1\u00001");
  });
});

describe("mergeStream", () => {
  const stream = (seqs: number[], nextSeq: number): CellStream => ({
    cellId: "a",
    state: "live",
    startedAt: 1,
    steps: seqs.map((seq) => ({ seq, ts: 0, kind: "error", text: String(seq) })),
    nextSeq,
    totals: { toolCalls: 0, costUsd: null },
  });

  test("appends only unseen steps and replaces on a full fetch", () => {
    const base = stream([0, 1], 2);
    expect(mergeStream(base, stream([1, 2], 3), 1).steps.map((s) => s.seq)).toEqual([0, 1, 2]);
    expect(mergeStream(base, stream([0], 1), 0).steps.map((s) => s.seq)).toEqual([0]);
    expect(mergeStream(undefined, stream([0], 1), 0).nextSeq).toBe(1);
  });
});
