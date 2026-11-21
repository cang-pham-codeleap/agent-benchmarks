import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { achCellId, evalTaskIds, type RunRecord } from "./ledger.ts";
import { apiCellId, parseApiCellId, safeCellDir } from "./paths.ts";
import type { CellLiveState, CellStream, EvalRunInput, LiveStep } from "./types.ts";

const SUMMARY_CHARS = 160;
const DETAIL_BYTES = 16 * 1024;

type RawEvent = Record<string, unknown>;
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type StepBody = DistributiveOmit<LiveStep, "seq" | "ts">;

const text = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);

const oneLine = (value: string): string => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_CHARS ? `${flat.slice(0, SUMMARY_CHARS - 1)}…` : flat;
};

const capped = (value: string): string =>
  value.length > DETAIL_BYTES ? `${value.slice(0, DETAIL_BYTES)}\n… truncated` : value;

/** The first string argument is the most telling one-liner (command, path, pattern, query). */
function argumentSummary(args: unknown): string {
  if (typeof args === "string") return oneLine(args);
  if (args != null && typeof args === "object") {
    const first = Object.values(args).find((value) => typeof value === "string");
    return oneLine(typeof first === "string" ? first : JSON.stringify(args));
  }
  return "";
}

/** One entry per raw event type; types absent here (step, model_call_*, ach.seal, ...) are skipped. */
const projectors: Record<string, (event: RawEvent) => StepBody | null> = {
  message: (event) => {
    const body = text(event.content);
    return body.trim() === "" ? null : { kind: "message", text: capped(body) };
  },
  tool_call: (event) => ({
    kind: "tool_call",
    tool: typeof event.functionName === "string" ? event.functionName : "tool",
    summary: argumentSummary(event.arguments),
    detail: capped(text(event.arguments)),
  }),
  tool_result: (event) => ({
    kind: "tool_result",
    isError: event.isError === true,
    summary: oneLine(text(event.content)),
    detail: capped(text(event.content)),
  }),
  usage: (event) => {
    const usage = (event.usage ?? {}) as RawEvent;
    const { costUsd, outputTokens } = usage;
    return {
      kind: "usage",
      costUsd: typeof costUsd === "number" ? costUsd : null,
      outputTokens: typeof outputTokens === "number" ? outputTokens : null,
    };
  },
  error: (event) => ({ kind: "error", text: capped(text(event.message)) }),
};

function timestamp(value: unknown): number {
  if (typeof value === "number") return value;
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Projects an ach raw transcript. `seq` is the 0-based line index, so it is a stable cursor;
 * a trailing line without a newline may still be mid-write and is left for the next read.
 */
export function projectTranscript(raw: string): { steps: LiveStep[]; nextSeq: number } {
  const complete = raw.slice(0, raw.lastIndexOf("\n") + 1);
  const lines = complete === "" ? [] : complete.slice(0, -1).split("\n");
  const steps: LiveStep[] = [];
  lines.forEach((line, seq) => {
    let event: RawEvent;
    try {
      event = JSON.parse(line) as RawEvent;
    } catch {
      return;
    }
    if (event == null || typeof event !== "object" || typeof event.type !== "string") return;
    const body = Object.hasOwn(projectors, event.type) ? projectors[event.type]!(event) : null;
    if (body != null) steps.push({ seq, ts: timestamp(event.timestamp), ...body } as LiveStep);
  });
  return { steps, nextSeq: lines.length };
}

export function plannedCells(input: EvalRunInput): string[] {
  return input.setups.flatMap((setup) =>
    evalTaskIds(input).flatMap((taskId) =>
      Array.from({ length: input.trials }, (_, index) =>
        apiCellId(setup.config, achCellId(setup, taskId, index + 1)),
      ),
    ),
  );
}

export interface LiveContext {
  planned: string[];
  /** API cell id to the registry run id of its ledger row. */
  ledger: Map<string, { runId: string | null }>;
  records: RunRecord[];
  currentCell: string | null;
  isAlive: (pid: number) => boolean;
}

export interface LiveResolution {
  record: RunRecord | null;
  /** Null with a record present means the live cell cannot be determined. */
  cellId: string | null;
}

export function resolveLive(ctx: LiveContext): LiveResolution {
  const record =
    ctx.records.find(
      (candidate) =>
        candidate.status === "running" && candidate.pid != null && ctx.isAlive(candidate.pid),
    ) ?? null;
  if (record == null) return { record: null, cellId: null };
  const dir = record.cwd == null ? null : basename(record.cwd);
  const byCwd = ctx.planned.find((cellId) => {
    const parsed = parseApiCellId(cellId);
    return parsed != null && dir === safeCellDir(parsed.achCellId);
  });
  const fallback =
    ctx.currentCell != null && ctx.planned.includes(ctx.currentCell) ? ctx.currentCell : null;
  return { record, cellId: byCwd ?? fallback };
}

function recordFor(ctx: LiveContext, live: LiveResolution, cellId: string): RunRecord | null {
  if (live.cellId === cellId) return live.record;
  const runId = ctx.ledger.get(cellId)?.runId;
  if (runId != null) return ctx.records.find((record) => record.runId === runId) ?? null;
  const achId = parseApiCellId(cellId)?.achCellId;
  const dir = achId == null ? null : safeCellDir(achId);
  return (
    ctx.records
      .filter(
        (record) =>
          record !== live.record &&
          (record.cellId === achId || (record.cwd != null && basename(record.cwd) === dir)),
      )
      .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
  );
}

export function cellStateOf(ctx: LiveContext, live: LiveResolution, cellId: string): CellLiveState {
  if (live.cellId === cellId) return "live";
  if (ctx.ledger.has(cellId)) return "done";
  if (recordFor(ctx, live, cellId) != null) return "done";
  return live.record != null && live.cellId == null ? "unknown" : "queued";
}

/** Null when `cellId` is not a cell of the run. */
export function readCellStream(ctx: LiveContext, cellId: string, after: number): CellStream | null {
  if (!ctx.planned.includes(cellId)) return null;
  const live = resolveLive(ctx);
  const record = recordFor(ctx, live, cellId);
  const path = record?.rawTranscript;
  const { steps, nextSeq } = projectTranscript(
    path != null && existsSync(path) ? readFileSync(path, "utf8") : "",
  );
  const costs = steps.flatMap((step) =>
    step.kind === "usage" && step.costUsd != null ? [step.costUsd] : [],
  );
  return {
    cellId,
    state: cellStateOf(ctx, live, cellId),
    startedAt: record?.startedAt ?? null,
    steps: steps.filter((step) => step.seq >= after),
    nextSeq,
    totals: {
      toolCalls: steps.filter((step) => step.kind === "tool_call").length,
      costUsd: costs.at(-1) ?? null,
    },
  };
}
