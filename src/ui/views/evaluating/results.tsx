import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type CellOutcome,
  type EvalResults,
  type EvalRunManifest,
  GRADED_OUTCOME,
} from "../../../eval/types.ts";
import { Badge as ToneBadge } from "../../badges.tsx";
import { money } from "../../format.ts";
import { setupText } from "../evaluating-form.ts";
import { AugmentVerdictTable } from "./augments.tsx";
import { CostTimeScatter, duration, Help, Leaders, percent, Scoreboard } from "./scoreboard.tsx";

const verdict = {
  inconclusive: "Inconclusive on this sample",
  "consistently-better": "Consistently better on this sample",
  "consistently-worse": "Consistently worse on this sample",
} as const;

export function EvalResultsView({
  results,
  busy,
  onResume,
  onOpenCell,
}: {
  results: EvalResults;
  busy: boolean;
  onOpenCell: (cellId: string) => void;
  onResume: (run: EvalRunManifest, retryFailed: boolean) => void;
}) {
  const { manifest, setups, cells } = results;
  const [baseline, setBaseline] = useState("");
  const [retryFailed, setRetryFailed] = useState(false);
  const selectedBaseline = setups.some((setup) => setup.setupKey === baseline)
    ? baseline
    : setups[0]?.setupKey;
  const pairs = results.paired.filter((pair) => pair.baseline === selectedBaseline);
  const byKey = new Map(setups.map((setup) => [setup.setupKey, setup]));
  const tasks =
    manifest.input.kind === "real"
      ? [...new Set(cells.map((cell) => cell.taskId))]
      : manifest.input.taskIds;
  const descriptive = tasks.length < 20 || setups.some((setup) => setup.eligibleTasks < 20);
  const totalSpend = setups.reduce((sum, setup) => sum + (setup.spendUsd ?? 0), 0);
  return (
    <TooltipProvider>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              {setups.length} setups · {tasks.length} tasks × {manifest.input.trials} trials ·{" "}
              {money(totalSpend)} spend
            </CardDescription>
            {results.warnings.length > 0 && (
              <details className="text-sm text-muted-foreground">
                <summary className="w-max cursor-pointer">
                  {descriptive ? "Descriptive results, not a ranking" : "Read before comparing"} ·{" "}
                  {results.warnings.length} notes
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {results.warnings.map((warning, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: warning strings may repeat
                    <li key={`${index}-${warning}`}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            {setups.length > 1 && <Leaders setups={setups} />}
            <Scoreboard setups={setups} />
            <Tabs defaultValue={setups.length > 1 ? "scatter" : "tasks"}>
              <TabsList>
                {setups.length > 1 && <TabsTrigger value="scatter">Cost vs time</TabsTrigger>}
                {setups.length > 1 && <TabsTrigger value="paired">Paired comparison</TabsTrigger>}
                <TabsTrigger value="tasks">Task × setup</TabsTrigger>
              </TabsList>
              <TabsContent value="scatter" className="pt-3">
                <CostTimeScatter setups={setups} />
              </TabsContent>
              <TabsContent value="paired" className="space-y-3 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Compare pass proportions on the same tasks.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    Baseline
                    <Select value={selectedBaseline} onValueChange={setBaseline}>
                      <SelectTrigger className="w-56" aria-label="Baseline setup">
                        <SelectValue placeholder="Choose baseline" />
                      </SelectTrigger>
                      <SelectContent>
                        {setups.map((setup) => (
                          <SelectItem key={setup.setupKey} value={setup.setupKey}>
                            {setupText(setup.setup)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                {pairs.length ? (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Setup</TableHead>
                          <TableHead>Better tasks</TableHead>
                          <TableHead>Worse tasks</TableHead>
                          <TableHead>Tied tasks</TableHead>
                          <TableHead>Verdict</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pairs.map((pair) => (
                          <TableRow key={pair.other}>
                            <TableCell>
                              {byKey.has(pair.other)
                                ? setupText(byKey.get(pair.other)!.setup)
                                : pair.other}
                            </TableCell>
                            <TableCell>{pair.better}</TableCell>
                            <TableCell>{pair.worse}</TableCell>
                            <TableCell>{pair.tied}</TableCell>
                            <TableCell>{verdict[pair.verdict]}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No paired comparisons available for this baseline.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="tasks" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">
                  Passed / graded trials; unavailable outcomes are not graded.
                </p>
                <section
                  className="overflow-x-auto rounded-md border"
                  aria-label="Task by setup results"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable scroll container so keyboard users can scroll the table
                  tabIndex={0}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Task</TableHead>
                        {setups.map((setup) => (
                          <TableHead key={setup.setupKey}>{setupText(setup.setup)}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tasks.map((task) => (
                        <TableRow key={task}>
                          <TableHead scope="row">{task}</TableHead>
                          {setups.map((setup) => {
                            const trials = cells.filter(
                              (cell) => cell.taskId === task && cell.setupKey === setup.setupKey,
                            );
                            const graded = trials.filter((cell) => GRADED_OUTCOME[cell.outcome]);
                            const passed = graded.filter(
                              (cell) => cell.outcome === "passed",
                            ).length;
                            const rate = graded.length ? passed / graded.length : null;
                            return (
                              <TableCell key={setup.setupKey}>
                                <span
                                  className={`inline-block rounded px-2 py-1 ${rate == null ? "bg-muted text-muted-foreground" : rate === 1 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : rate === 0 ? "bg-destructive/10 text-destructive" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}
                                >
                                  <Help
                                    text={
                                      trials.length
                                        ? trials
                                            .map((cell) => `Trial ${cell.trial}: ${cell.outcome}`)
                                            .join("; ")
                                        : "No trials recorded"
                                    }
                                  >
                                    {passed}/{graded.length}{" "}
                                    {rate == null ? "ungraded" : percent(rate)}
                                  </Help>
                                </span>
                                <span className="mt-1 flex flex-wrap gap-1">
                                  {trials.map((cell) => (
                                    <Button
                                      key={cell.cellId}
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs"
                                      aria-label={`Watch ${setupText(setup.setup)} ${task} trial ${cell.trial}`}
                                      onClick={() => onOpenCell(cell.cellId)}
                                    >
                                      Watch t{cell.trial}
                                    </Button>
                                  ))}
                                </span>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              </TabsContent>
            </Tabs>
            {(manifest.status === "interrupted" || manifest.status === "cancelled") && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={retryFailed}
                    onCheckedChange={(checked) => setRetryFailed(checked === true)}
                  />
                  Retry infrastructure errors
                </label>
                <Button disabled={busy} onClick={() => onResume(manifest, retryFailed)}>
                  Resume
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        {results.augmentVerdicts.length > 0 && (
          <AugmentVerdictTable verdicts={results.augmentVerdicts} />
        )}
        {results.interrupted.length > 0 && (
          <Card>
            <CardContent>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="px-0">
                    Interrupted attempts ({results.interrupted.length})
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="space-y-2 text-sm">
                    {results.interrupted.map((attempt) => (
                      <li key={attempt.runId}>
                        {attempt.cellId || "Unknown cell"} · {attempt.startedAt} ·{" "}
                        {attempt.cost.kind === "priced"
                          ? `${money(attempt.cost.usd)} (${attempt.cost.basis})`
                          : `Cost unavailable (${attempt.cost.reason})`}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Partial spend is separate from completed cell results.
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="px-0">
                  Run manifest
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 break-words text-sm">
                <p>
                  ach: {manifest.provenance.achCommit}
                  {manifest.provenance.achDirty ? " (dirty)" : " (clean)"} ·{" "}
                  {manifest.provenance.achDir}
                </p>
                <p>
                  Harness versions:{" "}
                  {Object.entries(manifest.provenance.harnessVersions)
                    .map(([harness, version]) => `${harness}: ${version}`)
                    .join(", ") || "Unavailable"}
                </p>
                <p>Timeout per cell: {duration(manifest.input.wallMs)}</p>
                <p>Hermetic root: {manifest.provenance.hermeticRoot}</p>
                <p>{manifest.provenance.globalConfigNote}</p>
                <div>
                  <p className="font-medium">Task hashes</p>
                  <ul>
                    {Object.entries(manifest.provenance.taskHashes).map(([task, hash]) => (
                      <li key={task}>
                        {task}: {hash}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium">Execution order</p>
                  <ol className="list-inside list-decimal">
                    {manifest.provenance.executionOrder.map((item, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: order entries may repeat
                      <li key={`${index}-${item}`}>{item}</li>
                    ))}
                  </ol>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
