import { ArrowLeft } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AugmentPoolEntry,
  BenchmarkRunInput,
  EvalCatalog,
  EvalCellActivityEvent,
  EvalProgressEvent,
  EvalResults,
  EvalRunManifest,
  RealRunInput,
} from "../../eval/types.ts";
import { getJson } from "../api.ts";
import { ApiFailureState } from "../api-failure.tsx";
import { durationPrecise } from "../format.ts";
import { Link, visit } from "../link.tsx";
import { AugmentPoolPanel } from "./evaluating/augments.tsx";
import { EvalForm } from "./evaluating/form.tsx";
import { LiveView } from "./evaluating/live.tsx";
import { RealTaskForm } from "./evaluating/real-form.tsx";
import { RealResultsView } from "./evaluating/real-results.tsx";
import { EvalResultsView } from "./evaluating/results.tsx";
import { setupText } from "./evaluating-form.ts";

function initialInput(catalog: EvalCatalog): BenchmarkRunInput {
  const preset = catalog.presets.find((item) => item.id === "smoke");
  const harness = catalog.harnesses.find((item) => item.installed);
  return {
    kind: "benchmark",
    name: `Evaluation ${new Date().toLocaleDateString()}`,
    setups: harness
      ? [{ harness: harness.harness, model: "", config: "current", augments: [] }]
      : [],
    taskIds: preset?.taskIds ?? [],
    trials: preset?.trials ?? 1,
    wallMs: catalog.limits.defaultWallMs,
    preset: preset?.id ?? "custom",
  };
}

function ActiveRun({
  result,
  busy,
  onCancel,
  onWatch,
}: {
  result: EvalResults;
  busy: boolean;
  onCancel: (manifest: EvalRunManifest) => void;
  onWatch: (manifest: EvalRunManifest) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const { manifest, progress } = result;
  useEffect(() => {
    if (manifest.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [manifest.status]);
  const elapsed = Math.max(
    0,
    (manifest.endedAt ? new Date(manifest.endedAt).getTime() : now) -
      new Date(manifest.startedAt).getTime(),
  );
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Active run</CardTitle>
            <CardDescription>
              {manifest.input.name} · {manifest.status}
            </CardDescription>
          </div>
          {manifest.status === "running" && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onWatch(manifest)}>
                Watch live
              </Button>
              <AlertDialog.Root>
                <AlertDialog.Trigger asChild>
                  <Button type="button" variant="outline" disabled={busy}>
                    Cancel run
                  </Button>
                </AlertDialog.Trigger>
                <AlertDialog.Portal>
                  <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                  <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg">
                    <AlertDialog.Title className="text-lg font-semibold">
                      Cancel evaluation?
                    </AlertDialog.Title>
                    <AlertDialog.Description className="text-sm text-muted-foreground">
                      Cancel is best effort; leftover processes are listed if any survive.
                    </AlertDialog.Description>
                    <div className="flex justify-end gap-2">
                      <AlertDialog.Cancel asChild>
                        <Button variant="outline">Keep running</Button>
                      </AlertDialog.Cancel>
                      <AlertDialog.Action asChild>
                        <Button variant="destructive" onClick={() => onCancel(manifest)}>
                          Cancel run
                        </Button>
                      </AlertDialog.Action>
                    </div>
                  </AlertDialog.Content>
                </AlertDialog.Portal>
              </AlertDialog.Root>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <span>
            {progress.done} / {progress.total} runs complete
          </span>
          <span>Elapsed {Number.isFinite(elapsed) ? durationPrecise(elapsed) : "unavailable"}</span>
        </div>
        <progress
          aria-label="Evaluation progress"
          value={progress.done}
          max={Math.max(progress.total, 1)}
          className="h-2 w-full accent-primary"
        />
        <p className="break-words text-sm text-muted-foreground">
          Current cell: {progress.currentCell || "Waiting for a cell"}
        </p>
        {manifest.status === "cancel-incomplete" && (
          <Alert variant="destructive">
            <AlertTitle>Cancellation incomplete</AlertTitle>
            <AlertDescription>
              Surviving process IDs: {manifest.survivors.join(", ") || "unavailable"}. Resume is
              unavailable while processes survive.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

type EvalPage = { kind: "new" } | { kind: "history" } | { kind: "run"; id: string };

function evalPage(path: string): EvalPage {
  const params = new URLSearchParams(path.split("?", 2)[1] ?? "");
  const id = params.get("run");
  if (id) return { kind: "run", id };
  return params.get("tab") === "history" ? { kind: "history" } : { kind: "new" };
}

export function EvaluatingView({
  path,
  progress,
  activity,
}: {
  path: string;
  progress: EvalProgressEvent | null;
  activity: EvalCellActivityEvent | null;
}) {
  const page = evalPage(path);
  const selectedId = page.kind === "run" ? page.id : null;
  const pageKey = selectedId ?? page.kind;
  // biome-ignore lint/correctness/useExhaustiveDependencies: pageKey is the trigger; visit only resets scroll on pathname changes
  useEffect(() => window.scrollTo(0, 0), [pageKey]);
  const [catalog, setCatalog] = useState<EvalCatalog | null>(null);
  const [runs, setRuns] = useState<EvalRunManifest[] | null>(null);
  const [pool, setPool] = useState<AugmentPoolEntry[]>([]);
  const [input, setInput] = useState<BenchmarkRunInput | null>(null);
  const [selected, setSelected] = useState<EvalResults | null>(null);
  const [active, setActive] = useState<EvalResults | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [resultError, setResultError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [runView, setRunView] = useState<"results" | "live">("results");
  const [pinned, setPinned] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    setRevision((value) => value + 1);
  };
  const activeId =
    catalog?.activeRunId ??
    runs?.find((run) => run.status === "running" || run.status === "cancel-incomplete")?.id ??
    null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision and progress are refetch triggers
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getJson<EvalCatalog>("/api/evals/catalog", { signal: controller.signal }),
      getJson<EvalRunManifest[]>("/api/evals", { signal: controller.signal }),
    ])
      .then(([nextCatalog, nextRuns]) => {
        if (controller.signal.aborted) return;
        setCatalog(nextCatalog);
        setRuns(nextRuns);
        setInput((current) => current ?? initialInput(nextCatalog));
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure);
      });
    return () => controller.abort();
  }, [revision, progress]);

  const completedRuns = (runs ?? [])
    .filter((run) => run.status === "completed")
    .map((run) => run.id)
    .join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pool changes only when a run completes
  useEffect(() => {
    const controller = new AbortController();
    void getJson<AugmentPoolEntry[]>("/api/evals/augments", { signal: controller.signal })
      .then((nextPool) => {
        if (!controller.signal.aborted) setPool(nextPool);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure);
      });
    return () => controller.abort();
  }, [revision, completedRuns]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision and progress are refetch triggers
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setResultError(null);
      return;
    }
    const controller = new AbortController();
    setResultError(null);
    void getJson<EvalResults>(`/api/evals/${encodeURIComponent(selectedId)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setSelected(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setResultError(failure);
      });
    return () => controller.abort();
  }, [selectedId, revision, progress]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision and progress are refetch triggers
  useEffect(() => {
    if (!activeId) {
      setActive(null);
      return;
    }
    const controller = new AbortController();
    void getJson<EvalResults>(`/api/evals/${encodeURIComponent(activeId)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setActive(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure);
      });
    return () => controller.abort();
  }, [activeId, revision, progress]);

  useEffect(() => {
    if (!progress?.runId || progress.runId === selectedId || progress.runId === activeId) return;
    const controller = new AbortController();
    void getJson<EvalResults>(`/api/evals/${encodeURIComponent(progress.runId)}`, {
      signal: controller.signal,
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure);
    });
    return () => controller.abort();
  }, [progress, selectedId, activeId]);

  function selectRun(id: string, view: "results" | "live" = "results") {
    setPinned(null);
    setRunView(view);
    visit(`/evaluating?run=${encodeURIComponent(id)}`);
  }
  async function mutate(url: string, body: unknown, select: boolean) {
    setBusy(true);
    setError(null);
    try {
      const manifest = await getJson<EvalRunManifest>(url, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (select) selectRun(manifest.id, "live");
      refresh();
    } catch (failure) {
      setError(failure);
      setRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  async function startReal(real: RealRunInput) {
    setBusy(true);
    try {
      const manifest = await getJson<EvalRunManifest>("/api/evals", {
        method: "POST",
        body: JSON.stringify(real),
      });
      selectRun(manifest.id, "live");
      refresh();
    } finally {
      setBusy(false);
    }
  }
  const [tab, setTab] = useState<"benchmark" | "real">("benchmark");
  const current = selected?.manifest.id === selectedId ? selected : null;
  const activeResult = active?.manifest.id === activeId ? active : null;
  return (
    <div className="flex min-w-0 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Evaluating</h1>
        <p className="text-sm text-muted-foreground">
          Run the same tasks on several harness and model setups, then compare verified results.
        </p>
      </header>
      {error != null && <ApiFailureState error={error} onRetry={refresh} />}
      <Tabs
        value={page.kind === "run" ? "history" : page.kind}
        onValueChange={(value) =>
          visit(value === "history" ? "/evaluating?tab=history" : "/evaluating")
        }
      >
        <TabsList variant="line" className="h-10 w-full justify-start border-b pb-0">
          <TabsTrigger value="new" className="flex-none px-3 text-base">
            New evaluation
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-none px-3 text-base">
            History{runs ? ` (${runs.length})` : ""}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {!catalog || !runs || !input ? (
        <div className="space-y-4" role="status" aria-label="Loading evaluations">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <>
          {activeId &&
            (page.kind !== "run" || page.id === activeId) &&
            (activeResult ? (
              <ActiveRun
                result={activeResult}
                busy={busy}
                onWatch={(run) => selectRun(run.id, "live")}
                onCancel={(run) =>
                  void mutate(`/api/evals/${encodeURIComponent(run.id)}/cancel`, {}, false)
                }
              />
            ) : (
              <Skeleton className="h-36 w-full" />
            ))}
          {page.kind === "new" && (
            <>
              {!catalog.ach.ok && (
                <Alert variant="destructive">
                  <AlertTitle>ach checkout unavailable</AlertTitle>
                  <AlertDescription>
                    {catalog.ach.problem || "Configure the ach checkout."}{" "}
                    <Link href="/settings" className="underline">
                      Open Settings
                    </Link>
                  </AlertDescription>
                </Alert>
              )}
              <Tabs value={tab} onValueChange={(value) => setTab(value as "benchmark" | "real")}>
                <TabsList>
                  <TabsTrigger value="benchmark">Benchmark</TabsTrigger>
                  <TabsTrigger value="real">Real tasks</TabsTrigger>
                </TabsList>
                <TabsContent value="benchmark">
                  <EvalForm
                    catalog={catalog}
                    input={input}
                    onChange={setInput}
                    busy={busy}
                    onStart={() => void mutate("/api/evals", input, true)}
                  />
                </TabsContent>
                <TabsContent value="real">
                  <RealTaskForm catalog={catalog} busy={busy} onStart={startReal} />
                </TabsContent>
              </Tabs>
            </>
          )}
          {page.kind === "history" && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Past runs</CardTitle>
                  <CardDescription>Open a run to see its results and live log.</CardDescription>
                </CardHeader>
                <CardContent>
                  {runs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No evaluations yet.{" "}
                      <Link href="/evaluating" className="underline">
                        Start one
                      </Link>{" "}
                      with the Smoke preset to check your setup.
                    </p>
                  ) : (
                    <section
                      className="overflow-x-auto rounded-md border"
                      aria-label="Past evaluation runs"
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable scroll container so keyboard users can scroll the table
                      tabIndex={0}
                    >
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Kind</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead>Setups</TableHead>
                            <TableHead>Cells</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {runs.map((run) => (
                            <TableRow key={run.id}>
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="link"
                                  className="h-auto whitespace-normal p-0 text-left"
                                  onClick={() => selectRun(run.id)}
                                >
                                  {run.input.name}
                                </Button>
                              </TableCell>
                              <TableCell>
                                {run.input.kind === "real" ? "Real" : "Benchmark"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{run.status}</Badge>
                              </TableCell>
                              <TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
                              <TableCell>{run.input.setups.map(setupText).join(", ")}</TableCell>
                              <TableCell>
                                {run.input.setups.length *
                                  (run.input.kind === "real" ? 1 : run.input.taskIds.length) *
                                  run.input.trials}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </section>
                  )}
                </CardContent>
              </Card>
              <AugmentPoolPanel entries={pool} />
            </>
          )}
          {page.kind === "run" && (
            <section className="flex flex-col gap-4" aria-label="Evaluation run">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => visit("/evaluating?tab=history")}
                >
                  <ArrowLeft aria-hidden />
                  All runs
                </Button>
                {current && (
                  <>
                    <h2 className="text-lg font-semibold">{current.manifest.input.name}</h2>
                    <Badge variant="outline">{current.manifest.status}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {new Date(current.manifest.createdAt).toLocaleString()}
                    </span>
                  </>
                )}
              </div>
              {resultError != null ? (
                <ApiFailureState error={resultError} onRetry={refresh} />
              ) : current ? (
                <Tabs
                  key={current.manifest.id}
                  value={runView}
                  onValueChange={(value) => setRunView(value as "results" | "live")}
                >
                  <TabsList>
                    <TabsTrigger value="results">Results</TabsTrigger>
                    <TabsTrigger value="live">Live</TabsTrigger>
                  </TabsList>
                  <TabsContent value="live">
                    <LiveView
                      results={current}
                      activity={activity?.runId === current.manifest.id ? activity : null}
                      pinned={pinned}
                      onPin={setPinned}
                    />
                  </TabsContent>
                  <TabsContent value="results">
                    {current.manifest.status === "cancel-incomplete" &&
                      current.manifest.id !== activeId && (
                        <Alert className="mb-4" variant="destructive">
                          <AlertTitle>Cancellation incomplete</AlertTitle>
                          <AlertDescription>
                            Surviving process IDs:{" "}
                            {current.manifest.survivors.join(", ") || "unavailable"}.
                          </AlertDescription>
                        </Alert>
                      )}
                    <EvalResultsView
                      results={current}
                      busy={busy || !!activeId}
                      onOpenCell={(cellId) => {
                        setPinned(cellId);
                        setRunView("live");
                      }}
                      onResume={(run, retryFailed) =>
                        void mutate(
                          `/api/evals/${encodeURIComponent(run.id)}/resume`,
                          { retryFailed },
                          true,
                        )
                      }
                    />
                    <RealResultsView results={current} />
                  </TabsContent>
                </Tabs>
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
