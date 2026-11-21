import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { achCellId, type RunRecord } from "../src/eval/ledger.ts";
import {
  cellStateOf,
  type LiveContext,
  plannedCells,
  projectTranscript,
  readCellStream,
  resolveLive,
} from "../src/eval/live.ts";
import { safeCellDir } from "../src/eval/paths.ts";
import type { BenchmarkRunInput } from "../src/eval/types.ts";

const input: BenchmarkRunInput = {
  kind: "benchmark",
  name: "synthetic",
  setups: [
    { harness: "claude", model: "m1", config: "current" },
    { harness: "codex", model: "m2", config: "current" },
  ],
  taskIds: ["task-a"],
  trials: 1,
  wallMs: 1000,
  preset: "custom",
};

const [claudeCell, codexCell] = plannedCells(input) as [string, string];
const claudeAch = achCellId(input.setups[0]!, "task-a", 1);

const line = (event: object) => `${JSON.stringify(event)}\n`;

function context(overrides: Partial<LiveContext> = {}): LiveContext {
  return {
    planned: plannedCells(input),
    ledger: new Map(),
    records: [],
    currentCell: null,
    isAlive: () => true,
    ...overrides,
  };
}

function record(overrides: Partial<RunRecord>): RunRecord {
  return { runId: "r1", agent: "claude", startedAt: 1000, ...overrides };
}

describe("projectTranscript", () => {
  const raw =
    line({ type: "step", timestamp: 1 }) +
    line({ type: "message", timestamp: 2, content: "hello" }) +
    line({ type: "message", timestamp: 3, content: "" }) +
    "{not json}\n" +
    line({
      type: "tool_call",
      timestamp: 4,
      functionName: "Bash",
      arguments: { command: "ls -la" },
    }) +
    line({ type: "tool_result", timestamp: 5, content: "x".repeat(40_000), isError: true }) +
    line({ type: "usage", timestamp: 6, usage: { costUsd: 0.25, outputTokens: 9 } }) +
    line({ type: "model_call_end" }) +
    line({ type: "error", timestamp: "2026-01-01T00:00:00Z", message: "boom" }) +
    line({ type: "ach.seal" }) +
    '{"type":"message","content":"half writ';

  test("projects known events, skips the rest, and leaves a partial last line", () => {
    const { steps, nextSeq } = projectTranscript(raw);
    expect(nextSeq).toBe(10);
    expect(steps.map((step) => [step.seq, step.kind])).toEqual([
      [1, "message"],
      [4, "tool_call"],
      [5, "tool_result"],
      [6, "usage"],
      [8, "error"],
    ]);
    expect(steps[1]).toMatchObject({ tool: "Bash", summary: "ls -la", ts: 4 });
    const result = steps[2]!;
    if (result.kind !== "tool_result") throw new Error("expected tool_result");
    expect(result.isError).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(160);
    expect(result.detail.length).toBeLessThan(17_000);
    expect(steps[3]).toMatchObject({ costUsd: 0.25, outputTokens: 9 });
    expect(steps[4]).toMatchObject({ text: "boom", ts: Date.parse("2026-01-01T00:00:00Z") });
  });

  test("a completed last line is consumed once its newline arrives", () => {
    const first = projectTranscript(raw);
    const next = projectTranscript(`${raw}"}\n`);
    expect(next.nextSeq).toBe(first.nextSeq + 1);
    expect(next.steps.at(-1)).toMatchObject({ seq: 10, kind: "message", text: "half writ" });
  });

  test("empty and newline-free input consume nothing", () => {
    expect(projectTranscript("")).toEqual({ steps: [], nextSeq: 0 });
    expect(projectTranscript('{"type":"message"')).toEqual({ steps: [], nextSeq: 0 });
  });
});

describe("cell state", () => {
  const liveRecord = record({
    status: "running",
    pid: 4242,
    cwd: join("/synthetic", "workspaces", safeCellDir(claudeAch)),
  });

  test("a live record maps to its cell through the cwd directory", () => {
    const ctx = context({ records: [liveRecord] });
    const live = resolveLive(ctx);
    expect(live.cellId).toBe(claudeCell);
    expect(cellStateOf(ctx, live, claudeCell)).toBe("live");
    expect(cellStateOf(ctx, live, codexCell)).toBe("queued");
  });

  test("falls back to the current cell when the cwd matches nothing", () => {
    const ctx = context({
      records: [{ ...liveRecord, cwd: "/synthetic/worktrees/r1" }],
      currentCell: codexCell,
    });
    expect(resolveLive(ctx).cellId).toBe(codexCell);
  });

  test("is unknown, never guessed, when neither source resolves", () => {
    const ctx = context({ records: [{ ...liveRecord, cwd: "/synthetic/worktrees/r1" }] });
    const live = resolveLive(ctx);
    expect(live.cellId).toBeNull();
    expect(cellStateOf(ctx, live, claudeCell)).toBe("unknown");
  });

  test("a running record with a dead process is never live", () => {
    const ctx = context({ records: [liveRecord], isAlive: () => false });
    const live = resolveLive(ctx);
    expect(live).toEqual({ record: null, cellId: null });
    expect(cellStateOf(ctx, live, claudeCell)).toBe("done");
  });

  test("ledger rows and finished records are done, the rest queued", () => {
    const ctx = context({
      ledger: new Map([[claudeCell, { runId: "r1" }]]),
      records: [record({ cellId: achCellId(input.setups[1]!, "task-a", 1), runId: "r2" })],
    });
    const live = resolveLive(ctx);
    expect(cellStateOf(ctx, live, claudeCell)).toBe("done");
    expect(cellStateOf(ctx, live, codexCell)).toBe("done");
    expect(cellStateOf(context(), live, codexCell)).toBe("queued");
  });

  test("a cell re-run by a retry is live despite its earlier ledger row", () => {
    const ctx = context({
      records: [liveRecord],
      ledger: new Map([[claudeCell, { runId: "r0" }]]),
    });
    expect(cellStateOf(ctx, resolveLive(ctx), claudeCell)).toBe("live");
  });

  test("a cell cancelled mid-run keeps its partial record and shows done", () => {
    const ctx = context({ records: [{ ...liveRecord, status: "success" }] });
    expect(cellStateOf(ctx, resolveLive(ctx), claudeCell)).toBe("done");
  });
});

describe("readCellStream", () => {
  test("serves the live cell from its transcript and honours the after cursor", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ab-live-")), "raw.jsonl");
    writeFileSync(
      path,
      line({ type: "message", timestamp: 1, content: "a" }) +
        line({ type: "tool_call", timestamp: 2, functionName: "Read", arguments: "f.ts" }) +
        line({ type: "usage", timestamp: 3, usage: { costUsd: 0.1 } }) +
        line({ type: "usage", timestamp: 4, usage: { costUsd: 0.3 } }),
    );
    const ctx = context({
      records: [
        record({
          status: "running",
          pid: 1,
          rawTranscript: path,
          cwd: `/synthetic/${safeCellDir(claudeAch)}`,
        }),
      ],
    });
    const all = readCellStream(ctx, claudeCell, 0)!;
    expect(all).toMatchObject({
      state: "live",
      startedAt: 1000,
      nextSeq: 4,
      totals: { toolCalls: 1, costUsd: 0.3 },
    });
    const delta = readCellStream(ctx, claudeCell, all.nextSeq - 1)!;
    expect(delta.steps.map((step) => step.seq)).toEqual([3]);
    expect(delta.totals).toEqual(all.totals);
    expect(readCellStream(ctx, claudeCell, 99)!.steps).toEqual([]);
  });

  test("queued cells have no steps and unknown cells are rejected", () => {
    expect(readCellStream(context(), codexCell, 0)).toMatchObject({
      state: "queued",
      steps: [],
      nextSeq: 0,
      startedAt: null,
    });
    expect(readCellStream(context(), "current/nope", 0)).toBeNull();
  });
});
