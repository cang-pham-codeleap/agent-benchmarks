import type { CellStream, EvalCell, EvalResults } from "../../../eval/types.ts";

export type WatchTarget =
  | { cellId: string; reason: "pinned" | "live" | "recorded" }
  | { cellId: null; reason: "unknown" | "none" };

/** Pinned wins; otherwise the live cell; otherwise, once nothing is running, the last recorded cell. */
export function watchTarget(results: EvalResults, pinned: string | null): WatchTarget {
  if (pinned != null && results.cells.some((cell) => cell.cellId === pinned))
    return { cellId: pinned, reason: "pinned" };
  const { liveCellId } = results.progress;
  if (liveCellId != null) return { cellId: liveCellId, reason: "live" };
  if (results.manifest.status === "running") return { cellId: null, reason: "unknown" };
  const recorded = results.cells.findLast((cell) => cell.outcome !== "pending");
  return recorded == null
    ? { cellId: null, reason: "none" }
    : { cellId: recorded.cellId, reason: "recorded" };
}

export interface CompareChoice {
  key: string;
  taskId: string;
  trial: number;
}

export const compareKeyOf = (cell: Pick<EvalCell, "taskId" | "trial">) =>
  `${cell.taskId}\u0000${cell.trial}`;

export function compareChoices(cells: EvalCell[]): CompareChoice[] {
  const seen = new Map<string, CompareChoice>();
  for (const cell of cells) seen.set(compareKeyOf(cell), { key: compareKeyOf(cell), ...cell });
  return [...seen.values()];
}

/** The live (else pinned, else last recorded) cell's task and trial; the first choice when none. */
export function defaultCompareKey(results: EvalResults, pinned: string | null): string | null {
  const target = watchTarget(results, pinned);
  const cell = results.cells.find((candidate) => candidate.cellId === target.cellId);
  return cell == null ? (compareChoices(results.cells)[0]?.key ?? null) : compareKeyOf(cell);
}

/** Appends a delta fetched with `after`; replaces the stream when the transcript was reset. */
export function mergeStream(base: CellStream | undefined, next: CellStream, after: number) {
  if (base == null || after === 0) return next;
  const seen = base.steps.at(-1)?.seq ?? -1;
  return { ...next, steps: [...base.steps, ...next.steps.filter((step) => step.seq > seen)] };
}
