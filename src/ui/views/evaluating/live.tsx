import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CellLiveState,
  CellStream,
  EvalCell,
  EvalCellActivityEvent,
  EvalResults,
  LiveStep,
} from "../../../eval/types.ts";
import { getJson } from "../../api.ts";
import { durationPrecise, money } from "../../format.ts";
import {
  compareChoices,
  compareKeyOf,
  defaultCompareKey,
  mergeStream,
  watchTarget,
} from "./live-model.ts";
import { setupText } from "./real-results.tsx";

const stateStyle: Record<CellLiveState, string> = {
  live: "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
  done: "border-sky-500/60 text-sky-600 dark:text-sky-400",
  queued: "text-muted-foreground",
  unknown: "border-amber-500/60 text-amber-600 dark:text-amber-400",
};

const kindStyle: Record<LiveStep["kind"], string> = {
  message: "border-border",
  tool_call: "border-amber-500/70",
  tool_result: "border-emerald-500/70",
  usage: "border-border text-muted-foreground",
  error: "border-destructive text-destructive",
};

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** Fetches each cell's steps once it is done, and only the new steps while it is not. */
function useCellStreams(
  results: EvalResults,
  cellIds: string[],
  activity: EvalCellActivityEvent | null,
) {
  const runId = results.manifest.id;
  const [streams, setStreams] = useState<Record<string, CellStream>>({});
  const known = useRef(streams);
  known.current = streams;
  const { liveCellId, done } = results.progress;
  const wanted = cellIds.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on any run signal
  useEffect(() => {
    const controller = new AbortController();
    const load = async (cellId: string, after: number): Promise<void> => {
      const url = `/api/evals/${encodeURIComponent(runId)}/cells/${encodeURIComponent(cellId)}/events?after=${after}`;
      const next = await getJson<CellStream>(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (next.nextSeq < after) return load(cellId, 0);
      setStreams((prev) => ({ ...prev, [cellId]: mergeStream(prev[cellId], next, after) }));
    };
    for (const cellId of wanted === "" ? [] : wanted.split("\n")) {
      const current = known.current[cellId];
      if (current?.state === "done") continue;
      load(cellId, current?.nextSeq ?? 0).catch((error: unknown) => {
        if (!controller.signal.aborted) console.error("[evaluating/live] cell fetch failed", error);
      });
    }
    return () => controller.abort();
  }, [runId, wanted, activity, liveCellId, done, results.manifest.status]);
  return streams;
}

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

function stepLine(step: LiveStep): { label: string; text: string; detail: string | null } {
  switch (step.kind) {
    case "message":
      return { label: "agent", text: step.text, detail: step.text };
    case "tool_call":
      return { label: step.tool, text: step.summary, detail: step.detail };
    case "tool_result":
      return {
        label: step.isError ? "error result" : "result",
        text: step.summary,
        detail: step.detail,
      };
    case "usage":
      return {
        label: "usage",
        text: [
          step.costUsd == null ? null : money(step.costUsd),
          step.outputTokens == null ? null : `${step.outputTokens} out tokens`,
        ]
          .filter(Boolean)
          .join(" · "),
        detail: null,
      };
    case "error":
      return { label: "error", text: step.text, detail: step.text };
  }
}

function StepRow({
  step,
  startedAt,
  expanded,
  onToggle,
}: {
  step: LiveStep;
  startedAt: number | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const line = stepLine(step);
  const time = startedAt != null && step.ts > 0 ? clock(step.ts - startedAt) : null;
  const content = (
    <span className="block truncate">
      {time != null && <span className="text-muted-foreground">{time} </span>}
      <span className="font-semibold">{line.label}</span> {line.text}
    </span>
  );
  return (
    <div
      className={`my-0.5 block w-full min-w-0 border-l-2 pl-2 text-left font-mono text-xs ${kindStyle[step.kind]}`}
    >
      {line.detail == null ? (
        content
      ) : (
        <button
          type="button"
          className="block w-full min-w-0 text-left"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {content}
        </button>
      )}
      {expanded && line.detail != null && (
        <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2">
          {line.detail}
        </pre>
      )}
    </div>
  );
}

function StepList({ steps, startedAt }: { steps: LiveStep[]; startedAt: number | null }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToEnd = useRef(true);
  const last = steps.at(-1)?.seq;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a step arrives
  useEffect(() => {
    const element = scroller.current;
    if (element != null && pinnedToEnd.current) element.scrollTop = element.scrollHeight;
  }, [last]);
  const toggle = (seq: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(seq)) next.add(seq);
      return next;
    });
  return (
    <div
      ref={scroller}
      className="max-h-[60vh] min-h-24 overflow-y-auto"
      onScroll={(event) => {
        const element = event.currentTarget;
        pinnedToEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
    >
      {steps.map((step) => (
        <StepRow
          key={step.seq}
          step={step}
          startedAt={startedAt}
          expanded={open.has(step.seq)}
          onToggle={() => toggle(step.seq)}
        />
      ))}
    </div>
  );
}

function emptyText(state: CellLiveState | undefined): string {
  if (state === "queued") return "Waiting for this cell to start";
  if (state === "unknown") return "Current cell unknown";
  return "No steps recorded";
}

function CellColumn({
  cell,
  label,
  stream,
  now,
}: {
  cell: EvalCell | undefined;
  label: string;
  stream: CellStream | undefined;
  now: number;
}) {
  const state: CellLiveState = stream?.state ?? (cell?.outcome === "pending" ? "queued" : "done");
  const elapsed =
    state === "live" && stream?.startedAt != null
      ? now - stream.startedAt
      : state === "done"
        ? (cell?.agentMs ?? null)
        : null;
  const cost = stream?.totals.costUsd ?? (cell?.cost.kind === "priced" ? cell.cost.usd : null);
  return (
    <Card className={`min-w-0 ${state === "live" ? "border-emerald-500/60" : ""}`}>
      <CardContent className="min-w-0 space-y-2 p-3">
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-semibold [overflow-wrap:anywhere]">{label}</div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <Badge variant="outline" className={stateStyle[state]}>
              {state === "live" ? "● live" : state}
            </Badge>
            {state === "done" && cell != null && cell.outcome !== "pending" && (
              <Badge variant="secondary">{cell.outcome}</Badge>
            )}
            {elapsed != null && (
              <span className="text-muted-foreground">{durationPrecise(elapsed)}</span>
            )}
            {stream != null && state !== "queued" && (
              <span className="text-muted-foreground">
                {stream.totals.toolCalls} tool calls{cost == null ? "" : ` · ${money(cost)}`}
              </span>
            )}
          </div>
        </div>
        {stream == null || stream.steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyText(stream?.state)}</p>
        ) : (
          <StepList steps={stream.steps} startedAt={stream.startedAt} />
        )}
      </CardContent>
    </Card>
  );
}

export function LiveView({
  results,
  activity,
  pinned,
  onPin,
}: {
  results: EvalResults;
  activity: EvalCellActivityEvent | null;
  pinned: string | null;
  onPin: (cellId: string | null) => void;
}) {
  const [mode, setMode] = useState<"watch" | "compare">("watch");
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const { cells, setups, manifest } = results;
  const label = (cell: EvalCell) => {
    const setup = setups.find((candidate) => candidate.setupKey === cell.setupKey)?.setup;
    return setup == null ? cell.setupKey : setupText(setup);
  };
  const target = watchTarget(results, pinned);
  const targetCell = cells.find((cell) => cell.cellId === target.cellId);
  const choices = compareChoices(cells);
  const compareKey =
    choices.find((choice) => choice.key === chosenKey)?.key ?? defaultCompareKey(results, pinned);
  const columns = cells.filter((cell) => compareKeyOf(cell) === compareKey);
  const shown =
    mode === "watch"
      ? target.cellId == null
        ? []
        : [target.cellId]
      : columns.map((cell) => cell.cellId);
  const streams = useCellStreams(results, shown, activity);
  const now = useNow(manifest.status === "running");
  const running = manifest.status === "running";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="m-0 inline-flex min-w-0 rounded-md border p-0" aria-label="Live mode">
          {(["watch", "compare"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={mode === value ? "secondary" : "ghost"}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value === "watch" ? "Watch" : "Compare"}
            </Button>
          ))}
        </fieldset>
        {mode === "watch" ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {pinned != null && (
              <Button type="button" size="sm" variant="outline" onClick={() => onPin(null)}>
                Follow live
              </Button>
            )}
            <Select value={target.cellId ?? undefined} onValueChange={(value) => onPin(value)}>
              <SelectTrigger className="w-80 max-w-full" aria-label="Cell">
                <SelectValue placeholder="Choose a cell" />
              </SelectTrigger>
              <SelectContent>
                {cells.map((cell) => (
                  <SelectItem key={cell.cellId} value={cell.cellId}>
                    {label(cell)} · {cell.taskId} · trial {cell.trial}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            Task
            <Select value={compareKey ?? undefined} onValueChange={setChosenKey}>
              <SelectTrigger className="w-72 max-w-full" aria-label="Task and trial">
                <SelectValue placeholder="Choose a task" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((choice) => (
                  <SelectItem key={choice.key} value={choice.key}>
                    {choice.taskId} · trial {choice.trial}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {!running && (
        <p className="text-sm text-muted-foreground">Nothing is running. Showing recorded cells.</p>
      )}
      {mode === "watch" && target.reason === "unknown" && (
        <Alert>
          <AlertDescription>
            Current cell unknown. Pick a cell to read its recorded steps; Watch follows the live
            cell once it can be determined.
          </AlertDescription>
        </Alert>
      )}
      {mode === "watch" && target.cellId != null && (
        <CellColumn
          cell={targetCell}
          label={
            targetCell == null
              ? ""
              : `${label(targetCell)} · ${targetCell.taskId} · trial ${targetCell.trial}`
          }
          stream={streams[target.cellId]}
          now={now}
        />
      )}
      {mode === "compare" && (
        <div
          className="grid min-w-0 gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))` }}
        >
          {columns.map((cell) => (
            <CellColumn
              key={cell.cellId}
              cell={cell}
              label={label(cell)}
              stream={streams[cell.cellId]}
              now={now}
            />
          ))}
        </div>
      )}
    </div>
  );
}
