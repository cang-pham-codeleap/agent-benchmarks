import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type EvalResults, type EvalRunManifest, GRADED_OUTCOME } from "../../../eval/types.ts";
import { durationPrecise, money } from "../../format.ts";
import { setupText } from "../evaluating-form.ts";
import { AugmentVerdictTable } from "./augments.tsx";

const percent = (value: number | null) =>
  value == null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
const duration = (value: number | null) => (value == null ? "Unavailable" : durationPrecise(value));
const verdict = {
  inconclusive: "Inconclusive on this sample",
  "consistently-better": "Consistently better on this sample",
  "consistently-worse": "Consistently worse on this sample",
} as const;

function Help({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cursor-help underline decoration-dotted underline-offset-4"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

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
  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Public tasks, verifier readable by agent</Badge>
          {(tasks.length < 20 || setups.some((setup) => setup.eligibleTasks < 20)) && (
            <Badge variant="secondary">Descriptive only</Badge>
          )}
        </div>
        {results.warnings.map((warning, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: warning strings may repeat
          <Alert key={`${index}-${warning}`}>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              {manifest.input.name} · {manifest.status} · Pass rate is the task mean over the common
              eligible tasks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <section
              className="overflow-x-auto rounded-md border"
              aria-label="Evaluation summary"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable scroll container so keyboard users can scroll the table
              tabIndex={0}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Setup</TableHead>
                    <TableHead>Pass rate</TableHead>
                    <TableHead>pass@k</TableHead>
                    <TableHead>pass^k</TableHead>
                    <TableHead>Spend</TableHead>
                    <TableHead>Cost/solved</TableHead>
                    <TableHead>Time/solved</TableHead>
                    <TableHead>Agent p50 / p95</TableHead>
                    <TableHead>Outcomes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {setups.map((summary) => (
                    <TableRow key={summary.setupKey}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline">{summary.setup.harness}</Badge>
                          <span>{summary.setup.model}</span>
                          <Badge variant="secondary">{summary.setup.config}</Badge>
                          {summary.setup.augments.map((id) => (
                            <Badge key={id} variant="outline">
                              +{id}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {percent(summary.passRate)}
                        {summary.passRateCi && (
                          <span className="block text-xs text-muted-foreground">
                            95% CI {percent(summary.passRateCi.lo)}–{percent(summary.passRateCi.hi)}{" "}
                            · fixed suite, {summary.eligibleTasks} tasks
                          </span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {summary.graded}/{summary.planned} graded/planned
                        </span>
                      </TableCell>
                      <TableCell>
                        {summary.passAtK == null ? (
                          <Help text={summary.kUnavailableReason || "Not enough graded trials."}>
                            Unavailable
                          </Help>
                        ) : (
                          <>
                            {percent(summary.passAtK)}{" "}
                            <span className="text-muted-foreground">(k={summary.k})</span>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        {summary.passHatK == null ? (
                          <Help text={summary.kUnavailableReason || "Not enough graded trials."}>
                            Unavailable
                          </Help>
                        ) : (
                          <>
                            {percent(summary.passHatK)}{" "}
                            <span className="text-muted-foreground">(k={summary.k})</span>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        {summary.spendUsd == null
                          ? summary.priced.priced
                            ? `Priced subtotal ${money(summary.pricedSubtotalUsd)}, ${summary.priced.priced}/${summary.priced.total} cells`
                            : `Unavailable, 0/${summary.priced.total} cells priced`
                          : money(summary.spendUsd)}
                      </TableCell>
                      <TableCell>
                        {summary.costPerSolvedUsd == null
                          ? summary.passed === 0 && summary.graded > 0
                            ? "No solved tasks"
                            : "Unavailable"
                          : money(summary.costPerSolvedUsd)}
                      </TableCell>
                      <TableCell>{duration(summary.timePerSolvedMs)}</TableCell>
                      <TableCell>
                        {duration(summary.agentP50Ms)} / {duration(summary.agentP95Ms)}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-36 flex-wrap gap-1">
                          {Object.entries(summary.outcomes)
                            .filter(([, count]) => count > 0)
                            .map(([outcome, count]) => (
                              <Badge
                                key={outcome}
                                variant={
                                  GRADED_OUTCOME[outcome as keyof typeof GRADED_OUTCOME]
                                    ? "outline"
                                    : "secondary"
                                }
                              >
                                {outcome} {count}
                              </Badge>
                            ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Paired comparison</h3>
                  <p className="text-sm text-muted-foreground">
                    Compare pass proportions on the same tasks.
                  </p>
                </div>
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
            </div>
            <div className="space-y-3">
              <div>
                <h3 className="font-semibold">Task × setup</h3>
                <p className="text-sm text-muted-foreground">
                  Passed / graded trials; unavailable outcomes are not graded.
                </p>
              </div>
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
                          const passed = graded.filter((cell) => cell.outcome === "passed").length;
                          const rate = graded.length ? passed / graded.length : null;
                          return (
                            <TableCell key={setup.setupKey}>
                              <span
                                className={`inline-block rounded px-2 py-1 ${rate == null ? "bg-muted text-muted-foreground" : rate === 1 ? "bg-primary/15" : rate === 0 ? "bg-destructive/10" : "bg-accent"}`}
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
            </div>
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
