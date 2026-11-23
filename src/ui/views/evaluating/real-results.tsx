import { Fragment, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type CellArtifacts,
  type CellOutcome,
  type EvalCell,
  type EvalResults,
  type EvalSetup,
  GRADED_OUTCOME,
  type RealCellSummary,
} from "../../../eval/types.ts";
import { getJson } from "../../api.ts";
import { durationPrecise, errorMessage, money } from "../../format.ts";
import { Link } from "../../link.tsx";
import { setupText } from "../evaluating-form.ts";

export const REFERENCE = "reference";
const MAX_COMPARE = 3;

const pct = (value: number | null) => (value == null ? "n/a" : `${Math.round(value * 100)}%`);
const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const range = (values: number[], format: (value: number) => string) =>
  values.length > 1 ? `${format(Math.min(...values))}–${format(Math.max(...values))}` : null;

export interface RealRow {
  key: string;
  label: string;
  cells: EvalCell[];
  outcomes: Partial<Record<CellOutcome, number>>;
  passRate: number | null;
  hidden: { passed: number; total: number } | null;
  checks: { passed: number; total: number };
  diff: { files: number; added: number; removed: number } | null;
  overlap: number | null;
  sizeRatio: number | null;
  agentP50Ms: number | null;
  agentRange: string | null;
  tokens: number | null;
  cost: string;
  costRange: string | null;
}

export function realRow(
  key: string,
  label: string,
  cells: EvalCell[],
  real: EvalResults["real"],
): RealRow {
  const summaries = cells.flatMap((cell) => real?.cells[cell.cellId] ?? []);
  const outcomes: RealRow["outcomes"] = {};
  for (const cell of cells) outcomes[cell.outcome] = (outcomes[cell.outcome] ?? 0) + 1;
  const ran = cells.filter((cell) => GRADED_OUTCOME[cell.outcome]);
  const hidden = summaries.flatMap((summary) => summary.hidden ?? []);
  const checks = summaries.flatMap((summary) => summary.checks);
  const times = cells.flatMap((cell) => cell.agentMs ?? []).sort((a, b) => a - b);
  const tokens = cells.flatMap((cell) =>
    cell.tokens ? cell.tokens.input + cell.tokens.output : [],
  );
  const prices = cells.flatMap((cell) => (cell.cost.kind === "priced" ? cell.cost.usd : []));
  const reasons = [
    ...new Set(cells.flatMap((cell) => (cell.cost.kind === "unavailable" ? cell.cost.reason : []))),
  ];
  const total = prices.reduce((sum, value) => sum + value, 0);
  const diffMean = (pick: (summary: RealCellSummary) => number) =>
    Math.round(mean(summaries.map(pick)) ?? 0);
  return {
    key,
    label,
    cells,
    outcomes,
    passRate: ran.length
      ? ran.filter((cell) => cell.outcome === "passed").length / ran.length
      : null,
    hidden: hidden.length
      ? {
          passed: hidden.reduce((sum, h) => sum + h.passed, 0),
          total: hidden.reduce((sum, h) => sum + h.total, 0),
        }
      : null,
    checks: {
      passed: checks.filter((check) => check.exitCode === 0 && !check.timedOut).length,
      total: checks.length,
    },
    diff: summaries.length
      ? {
          files: diffMean((summary) => summary.diffStat.files.length),
          added: diffMean((summary) => summary.diffStat.added),
          removed: diffMean((summary) => summary.diffStat.removed),
        }
      : null,
    overlap: mean(summaries.flatMap((summary) => summary.fileOverlap ?? [])),
    sizeRatio: mean(summaries.flatMap((summary) => summary.sizeRatio ?? [])),
    agentP50Ms: times.length ? times[Math.floor((times.length - 1) / 2)]! : null,
    agentRange: range(times, durationPrecise),
    tokens: tokens.length ? tokens.reduce((sum, value) => sum + value, 0) : null,
    cost: !prices.length
      ? `n/a (${reasons.join(", ") || "no cells"})`
      : reasons.length
        ? `${money(total)} (${prices.length}/${cells.length} priced; ${reasons.join(", ")})`
        : money(total),
    costRange: range(prices, money),
  };
}

export function realRows(results: EvalResults): RealRow[] {
  return results.setups.map((summary) =>
    realRow(
      summary.setupKey,
      setupText(summary.setup),
      results.cells.filter((cell) => cell.setupKey === summary.setupKey),
      results.real,
    ),
  );
}

export interface PatchFile {
  path: string;
  lines: string[];
}

export function patchFiles(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  for (const line of patch.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) files.push({ path: header[2]!, lines: [] });
    else if (
      files.length &&
      !/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line)
    )
      files.at(-1)!.lines.push(line);
  }
  return files;
}

const lineClass = (line: string) =>
  line.startsWith("+")
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : line.startsWith("-")
      ? "bg-destructive/10 text-destructive"
      : line.startsWith("@@")
        ? "text-muted-foreground"
        : "";

// Diff lines repeat (blank lines, braces); pair each with its occurrence count for a stable key.
const occurrenceKeys = (lines: string[]) => {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const n = (seen.get(line) ?? 0) + 1;
    seen.set(line, n);
    return [`${n}:${line}`, line] as const;
  });
};

function PatchView({ patch }: { patch: string }) {
  const files = patchFiles(patch);
  if (!files.length) return <p className="text-sm text-muted-foreground">No changes.</p>;
  return (
    <div className="space-y-2">
      {files.map((file) => (
        <details key={file.path} open className="rounded border">
          <summary className="cursor-pointer bg-muted px-2 py-1 font-mono text-xs">
            {file.path}
          </summary>
          <pre className="overflow-x-auto text-xs leading-5">
            {occurrenceKeys(file.lines).map(([key, line]) => (
              <div key={key} className={`px-2 ${lineClass(line)}`}>
                {line || " "}
              </div>
            ))}
          </pre>
        </details>
      ))}
    </div>
  );
}

function CompareColumn({
  runId,
  entry,
  label,
  cell,
}: {
  runId: string;
  entry: string;
  label: string;
  cell: EvalCell | null;
}) {
  const [artifacts, setArtifacts] = useState<CellArtifacts | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController();
    setArtifacts(null);
    setError(null);
    void getJson<CellArtifacts>(
      `/api/evals/${encodeURIComponent(runId)}/cells/${entry === REFERENCE ? REFERENCE : encodeURIComponent(entry)}`,
      { signal: controller.signal },
    )
      .then((next) => !controller.signal.aborted && setArtifacts(next))
      .catch((failure: unknown) => !controller.signal.aborted && setError(failure));
    return () => controller.abort();
  }, [runId, entry]);
  const session = cell?.session;
  return (
    <div className="min-w-0 space-y-2">
      <p className="truncate text-sm font-medium" title={label}>
        {label}
      </p>
      <Tabs defaultValue="diff">
        <TabsList>
          <TabsTrigger value="diff">Diff</TabsTrigger>
          {cell && <TabsTrigger value="transcript">Transcript</TabsTrigger>}
          {cell && <TabsTrigger value="logs">Check logs</TabsTrigger>}
        </TabsList>
        <TabsContent value="diff">
          {error ? (
            <p className="text-sm text-destructive">{errorMessage(error)}</p>
          ) : artifacts ? (
            <PatchView patch={artifacts.patch} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </TabsContent>
        {cell && (
          <TabsContent value="transcript" className="space-y-2 text-sm">
            {cell.raw.error && (
              <pre className="whitespace-pre-wrap break-all rounded-md border p-2 text-xs">
                {cell.raw.error}
              </pre>
            )}
            {session ? (
              <>
                <Link href={`/sessions/${session.id}`}>Open {session.tool} transcript</Link>
                <p className="break-all text-xs text-muted-foreground">
                  Session {session.sourceSessionId}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">No session recorded for this cell.</p>
            )}
          </TabsContent>
        )}
        {cell && (
          <TabsContent value="logs" className="space-y-2">
            {[
              ...(artifacts?.checks ?? []),
              ...(artifacts?.hidden ?? []).map((h) => ({
                command: `hidden: ${h.path}`,
                logTail: h.logTail,
              })),
            ].map((log) => (
              <div key={log.command}>
                <p className="font-mono text-xs font-medium">{log.command}</p>
                <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                  {log.logTail || "(empty)"}
                </pre>
              </div>
            ))}
            {artifacts && !artifacts.checks.length && !artifacts.hidden.length && (
              <p className="text-sm text-muted-foreground">No checks ran.</p>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function Metrics({ row }: { row: RealRow }) {
  return (
    <>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {Object.entries(row.outcomes).map(([outcome, count]) => (
            <Badge key={outcome} variant={outcome === "passed" ? "outline" : "secondary"}>
              {outcome} {count}
            </Badge>
          ))}
        </div>
        {row.cells.length > 1 && (
          <span className="text-xs text-muted-foreground">pass {pct(row.passRate)}</span>
        )}
      </TableCell>
      <TableCell>{row.hidden ? `${row.hidden.passed}/${row.hidden.total}` : "n/a"}</TableCell>
      <TableCell>{row.checks.total ? `${row.checks.passed}/${row.checks.total}` : "n/a"}</TableCell>
      <TableCell>
        {row.diff ? (
          <>
            {row.diff.files} files <span className="text-emerald-600">+{row.diff.added}</span>{" "}
            <span className="text-destructive">-{row.diff.removed}</span>
          </>
        ) : (
          "n/a"
        )}
      </TableCell>
      <TableCell>{pct(row.overlap)}</TableCell>
      <TableCell>{row.sizeRatio == null ? "n/a" : `${row.sizeRatio.toFixed(2)}×`}</TableCell>
      <TableCell>
        {row.agentP50Ms == null ? "n/a" : durationPrecise(row.agentP50Ms)}
        {row.agentRange && (
          <span className="block text-xs text-muted-foreground">{row.agentRange}</span>
        )}
      </TableCell>
      <TableCell>{row.tokens == null ? "n/a" : row.tokens.toLocaleString()}</TableCell>
      <TableCell>
        {row.cost}
        {row.costRange && (
          <span className="block text-xs text-muted-foreground">{row.costRange}</span>
        )}
      </TableCell>
    </>
  );
}

export function RealResultsView({ results }: { results: EvalResults }) {
  const real = results.real;
  const [picked, setPicked] = useState<string[]>(() => (real?.reference ? [REFERENCE] : []));
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!real) return null;
  const runId = results.manifest.id;
  const rows = realRows(results);
  const reference = real.reference;
  const humanLabel = reference ? `Human (${reference.sha.slice(0, 7)})` : "";
  const cellLabel = (cell: EvalCell) => {
    const setup = results.setups.find((s) => s.setupKey === cell.setupKey)?.setup;
    return `${setup ? setupText(setup) : cell.setupKey} #${cell.trial}`;
  };
  const toggle = (entry: string, on: boolean) =>
    setPicked((current) =>
      on
        ? current.length < MAX_COMPARE
          ? [...current, entry]
          : current
        : current.filter((e) => e !== entry),
    );
  const pick = (entry: string, label: string) => (
    <Checkbox
      aria-label={`Compare ${label}`}
      checked={picked.includes(entry)}
      disabled={!picked.includes(entry) && picked.length >= MAX_COMPARE}
      onCheckedChange={(checked) => toggle(entry, checked === true)}
    />
  );
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Real task</CardTitle>
          <CardDescription>
            {real.task.type === "replay" ? `Replay of ${real.task.sha.slice(0, 7)}` : "Prompt"} on{" "}
            {real.repoPath} @ {real.baseSha.slice(0, 7)}. Tick up to {MAX_COMPARE} entries to
            compare.
          </CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/api/evals/${encodeURIComponent(runId)}/report.html`} download>
            Export HTML
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="overflow-x-auto rounded-md border" aria-label="Real task summary">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead>Setup</TableHead>
                <TableHead>Outcomes</TableHead>
                <TableHead>Hidden</TableHead>
                <TableHead>Checks</TableHead>
                <TableHead>Diff</TableHead>
                <TableHead>Overlap</TableHead>
                <TableHead>Size ratio</TableHead>
                <TableHead>Agent p50</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reference && (
                <TableRow>
                  <TableCell>{pick(REFERENCE, humanLabel)}</TableCell>
                  <TableCell className="font-medium">{humanLabel}</TableCell>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    Reference commit
                  </TableCell>
                  <TableCell>
                    {reference.nonHidden.files.length} files{" "}
                    <span className="text-emerald-600">+{reference.nonHidden.added}</span>{" "}
                    <span className="text-destructive">-{reference.nonHidden.removed}</span>
                  </TableCell>
                  <TableCell colSpan={5} />
                </TableRow>
              )}
              {rows.map((row) => {
                const single = row.cells.length === 1 ? row.cells[0]! : null;
                return (
                  <Fragment key={row.key}>
                    <TableRow>
                      <TableCell>
                        {single ? (
                          pick(single.cellId, row.label)
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={expanded === row.key}
                            onClick={() => setExpanded(expanded === row.key ? null : row.key)}
                          >
                            {expanded === row.key ? "▾" : "▸"} {row.cells.length}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <Metrics row={row} />
                    </TableRow>
                    {expanded === row.key &&
                      row.cells.map((cell) => {
                        const cellRow = realRow(cell.cellId, cellLabel(cell), [cell], real);
                        return (
                          <TableRow key={cell.cellId} className="bg-muted/40">
                            <TableCell>{pick(cell.cellId, cellRow.label)}</TableCell>
                            <TableCell className="pl-6 text-muted-foreground">
                              Trial {cell.trial}
                            </TableCell>
                            <Metrics row={cellRow} />
                          </TableRow>
                        );
                      })}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </section>
        {picked.length > 0 && (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${picked.length}, minmax(0, 1fr))` }}
          >
            {picked.map((entry) => {
              const cell = results.cells.find((c) => c.cellId === entry) ?? null;
              return (
                <CompareColumn
                  key={entry}
                  runId={runId}
                  entry={entry}
                  cell={cell}
                  label={entry === REFERENCE ? humanLabel : cell ? cellLabel(cell) : entry}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
