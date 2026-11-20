import { Fragment, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CompareCell } from "../../compare.ts";
import { getJson } from "../api.ts";
import { ModelBadge, ToolBadge, toolLabel } from "../badges.tsx";
import { dateRangeQuery } from "../date-range.ts";
import { DateRangeControl } from "../date-range-control.tsx";
import { formatInt, money } from "../format.ts";
import { Link } from "../link.tsx";
import { readStorage, writeStorage } from "../safe-storage.ts";
import type { DashboardData, DateRangeSelection } from "../types.ts";

// better: null for volume totals and descriptive shares, which depend on how much a cell was used, not how well it did.
type Metric = { label: string; value: (cell: CompareCell) => number | null; format: (value: number) => string; better: "lower" | "higher" | null; priced?: boolean };
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const METRICS = {
  sessions: { label: "Sessions", value: (c) => c.sessions, format: formatInt, better: null },
  cost: { label: "Priced cost", value: (c: CompareCell) => c.costUsd, format: money, better: null, priced: true },
  median: { label: "Cost/task median", value: (c: CompareCell) => c.costPerTaskMedian, format: money, better: "lower", priced: true },
  p90: { label: "Cost/task p90", value: (c: CompareCell) => c.costPerTaskP90, format: money, better: "lower", priced: true },
  input: { label: "Input tokens", value: (c) => c.tokens.input, format: formatInt, better: null },
  output: { label: "Output tokens", value: (c) => c.tokens.output, format: formatInt, better: null },
  cacheRead: { label: "Cache read", value: (c) => c.tokens.cacheRead, format: formatInt, better: null },
  cacheWrite: { label: "Cache write", value: (c) => c.tokens.cacheWrite, format: formatInt, better: null },
  reasoning: { label: "Reasoning tokens", value: (c) => c.tokens.reasoning, format: formatInt, better: null },
  cacheShare: { label: "Cache read share", value: (c) => c.cacheReadShare, format: percent, better: "higher" },
  subagentShare: { label: "Subagent cost share", value: (c: CompareCell) => c.subagentCostShare, format: percent, better: null, priced: true },
  completed: { label: "Completed (heuristic)", value: (c) => c.completedRate, format: percent, better: "higher" },
  failed: { label: "Failed", value: (c) => c.failedRate, format: percent, better: "lower" },
  abandoned: { label: "Abandoned", value: (c) => c.abandonedRate, format: percent, better: "lower" },
  outputPerDollar: { label: "Output tokens/$", value: (c: CompareCell) => c.outputTokensPerDollar, format: formatInt, better: "higher", priced: true },
  active: { label: "Active seconds median", value: (c) => c.activeSecondsMedian, format: formatInt, better: "lower" },
  unpriced: { label: "Unpriced tasks", value: (c) => c.unpricedTasks, format: formatInt, better: null },
} satisfies Record<string, Metric>;
type MetricKey = keyof typeof METRICS;
const defaultMetrics: MetricKey[] = ["cost", "median", "p90", "outputPerDollar", "cacheShare", "subagentShare", "completed", "unpriced"];
const metricKeys: MetricKey[] = [...defaultMetrics, ...(Object.keys(METRICS) as MetricKey[]).filter((key) => !defaultMetrics.includes(key))];
const columnsStorageKey = "agent-benchmarks-compare-columns-v1";
const toolsStorageKey = "agent-benchmarks-compare-tools-v1";
const modelsStorageKey = "agent-benchmarks-compare-models-v2";

function savedList(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(readStorage(key) ?? "[]");
    if (Array.isArray(saved)) return saved.filter((item): item is string => typeof item === "string");
  } catch {}
  return [];
}

function modelKey(provider: string | null, model: string): string {
  return JSON.stringify([provider, model]);
}

function modelLabel(provider: string | null, model: string): string {
  return provider == null ? model || "Unknown model" : `${provider}/${model || "Unknown model"}`;
}

function storedModelLabel(key: string): string {
  const [provider, model] = JSON.parse(key) as [string | null, string];
  return modelLabel(provider, model);
}

function savedModels(): string[] {
  return savedList(modelsStorageKey).filter((key) => {
    try {
      const value: unknown = JSON.parse(key);
      return Array.isArray(value) && value.length === 2 && (value[0] === null || typeof value[0] === "string") && typeof value[1] === "string";
    } catch { return false; }
  });
}

function PickList({ label, selected, options, format, onToggle, onClear }: {
  label: string; selected: string[]; options: string[]; format: (value: string) => string;
  onToggle: (value: string) => void; onClear: () => void;
}) {
  return <Popover>
    <PopoverTrigger asChild><Button variant="outline" className="max-w-56 truncate">{label}: {selected.length ? selected.map(format).join(", ") : "All"}</Button></PopoverTrigger>
    <PopoverContent className="w-72 p-0" align="start">
      <Command>
        <CommandInput placeholder={`Search ${label.toLowerCase()}...`} aria-label={`Search ${label}`} />
        <CommandList>
          <CommandEmpty>No {label.toLowerCase()} found.</CommandEmpty>
          <CommandItem onSelect={onClear} disabled={!selected.length}>Show all</CommandItem>
          {options.map((value) => <CommandItem key={value} value={format(value)} aria-label={`${format(value)}, ${selected.includes(value) ? "selected" : "not selected"}`} onSelect={() => onToggle(value)}><Checkbox className="pointer-events-none" checked={selected.includes(value)} tabIndex={-1} aria-hidden="true" /> {format(value)}</CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}

function initialMetrics(): MetricKey[] {
  try {
    const saved: unknown = JSON.parse(readStorage(columnsStorageKey) ?? "null");
    if (Array.isArray(saved)) return metricKeys.filter((key) => saved.includes(key));
  } catch {}
  return defaultMetrics;
}

export function CompareView({ data, dateRange, onDateRangeChange, reloadKey }: {
  data: DashboardData; dateRange: DateRangeSelection;
  onDateRangeChange: (range: DateRangeSelection) => void; reloadKey: number;
}) {
  const [project, setProject] = useState("");
  const [workType, setWorkType] = useState("");
  const [outcome, setOutcome] = useState("");
  const [search, setSearch] = useState("");
  const [minimum, setMinimum] = useState(5);
  const [sort, setSort] = useState<{ key: MetricKey | "tasks"; direction: "asc" | "desc" }>({ key: "cost", direction: "desc" });
  const [visibleMetrics, setVisibleMetrics] = useState<MetricKey[]>(initialMetrics);
  const [tools, setTools] = useState<string[]>(() => savedList(toolsStorageKey));
  const [models, setModels] = useState<string[]>(savedModels);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [result, setResult] = useState<{ query: string; cells: CompareCell[] } | null>(null);
  const [error, setError] = useState(false);
  const params = new URLSearchParams(dateRangeQuery(dateRange));
  if (project) params.set("project", project);
  if (workType) params.set("work_type", workType === "unclassified" ? "" : workType);
  if (outcome) params.set("outcome", outcome === "unclassified" ? "" : outcome);
  const query = params.toString();
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void getJson<CompareCell[]>(`/api/analytics/compare?${query}`, { signal: controller.signal })
      .then((cells) => { if (!controller.signal.aborted) setResult({ query, cells }); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [query, reloadKey]);
  const cells = result?.query === query ? result.cells : [];
  const toolOptions = [...new Set(cells.map((cell) => cell.tool))].sort();
  const modelOptions = [...new Set(cells.filter((cell) => !tools.length || tools.includes(cell.tool)).map((cell) => modelKey(cell.provider, cell.model)))].sort((a, b) => storedModelLabel(a).localeCompare(storedModelLabel(b)));
  const shown = cells.filter((cell) => (!tools.length || tools.includes(cell.tool)) && (!models.length || models.includes(modelKey(cell.provider, cell.model))) && `${toolLabel(cell.tool)} ${modelLabel(cell.provider, cell.model)}`.toLowerCase().includes(search.toLowerCase()));
  const sorted = useMemo(() => [...shown].sort((a, b) => {
    const x = sort.key === "tasks" ? a.tasks : METRICS[sort.key].value(a);
    const y = sort.key === "tasks" ? b.tasks : METRICS[sort.key].value(b);
    if (x == null) return y == null ? 0 : 1;
    if (y == null) return -1;
    return (x - y) * (sort.direction === "asc" ? 1 : -1);
  }), [shown, sort]);
  const best = new Map<MetricKey, number>();
  for (const key of metricKeys) {
    const values = shown.filter((cell) => cell.tasks >= minimum).map(METRICS[key].value).filter((value): value is number => value != null);
    if (values.length && METRICS[key].better != null) best.set(key, METRICS[key].better === "lower" ? Math.min(...values) : Math.max(...values));
  }
  function toggleMetric(key: MetricKey) {
    const next = visibleMetrics.includes(key) ? visibleMetrics.filter((item) => item !== key) : [...visibleMetrics, key];
    if (sort.key === key && visibleMetrics.includes(key)) setSort({ key: "tasks", direction: "desc" });
    setVisibleMetrics(next);
    writeStorage(columnsStorageKey, JSON.stringify(next));
  }
  function sortBy(key: MetricKey | "tasks") {
    setSort((old) => ({ key, direction: old.key === key && old.direction === "asc" ? "desc" : "asc" }));
  }
  function pick(storageKey: string, current: string[], set: (next: string[]) => void, value: string) {
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    set(next);
    writeStorage(storageKey, JSON.stringify(next));
  }
  return <div className="flex flex-col gap-6 p-6">
    <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-tight">Compare</h1><p className="text-sm text-muted-foreground">Compare harness, provider, and primary model across tasks and their subagents.</p></div>
      <DateRangeControl bounds={data.dateBounds} range={dateRange} onChange={onDateRangeChange} />
    </header>
    <Card>
      <CardHeader><CardTitle>Harness × provider × model</CardTitle><CardDescription>Transcript ending (heuristic), not success. Cost statistics exclude unpriced tasks. ★ marks the best value among eligible cells.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">Project<Select value={project || "all"} onValueChange={(v) => setProject(v === "all" ? "" : v)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{data.projects.map((p) => <SelectItem key={p.path} value={p.path}>{p.name || p.path}</SelectItem>)}</SelectContent></Select></label>
          <label className="grid gap-1 text-sm">Work type<Select value={workType || "all"} onValueChange={(v) => setWorkType(v === "all" ? "" : v)}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All work types</SelectItem><SelectItem value="unclassified">Unclassified</SelectItem>{["debugging", "feature", "refactor", "research", "ops"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></label>
          <label className="grid gap-1 text-sm">Transcript ending (heuristic)<Select value={outcome || "all"} onValueChange={(v) => setOutcome(v === "all" ? "" : v)}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All endings</SelectItem><SelectItem value="unclassified">Unclassified</SelectItem>{["completed", "failed", "abandoned"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></label>
          <label className="grid gap-1 text-sm">Minimum tasks for best<Input className="w-24" type="number" min="1" value={minimum} onChange={(e) => setMinimum(Math.max(1, Number(e.target.value) || 1))} /></label>
          <PickList label="Harness" selected={tools} options={toolOptions} format={toolLabel} onToggle={(v) => pick(toolsStorageKey, tools, setTools, v)} onClear={() => { setTools([]); writeStorage(toolsStorageKey, "[]"); }} />
          <PickList label="Model" selected={models} options={modelOptions} format={storedModelLabel} onToggle={(v) => pick(modelsStorageKey, models, setModels, v)} onClear={() => { setModels([]); writeStorage(modelsStorageKey, "[]"); }} />
          <Input className="w-44" aria-label="Search comparisons" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button variant="ghost" onClick={() => { setProject(""); setWorkType(""); setOutcome(""); setMinimum(5); setSearch(""); setTools([]); setModels([]); writeStorage(toolsStorageKey, "[]"); writeStorage(modelsStorageKey, "[]"); }}>Clear</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">Columns</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{metricKeys.map((key) => <DropdownMenuCheckboxItem key={key} checked={visibleMetrics.includes(key)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleMetric(key)}>{METRICS[key].label}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">Could not load comparison data. Change a filter or retry the sync.</p> : result?.query !== query ? <p className="text-sm text-muted-foreground">Loading comparison…</p> : shown.length === 0 ? <p className="text-sm text-muted-foreground">No tasks match these filters.</p> :
        <div className="overflow-x-auto rounded-md border [&_[data-slot=table-container]]:overflow-visible" role="region" aria-label="Harness, provider, and model comparison" tabIndex={0}><Table><TableHeader><TableRow><TableHead scope="col" className="sticky left-0 z-10 bg-card">Harness / provider / model</TableHead><TableHead scope="col" aria-sort={sort.key === "tasks" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><Button variant="ghost" size="sm" onClick={() => sortBy("tasks")}>Tasks {sort.key === "tasks" ? (sort.direction === "asc" ? "↑" : "↓") : null}</Button></TableHead>{metricKeys.filter((key) => visibleMetrics.includes(key)).map((key) => <TableHead scope="col" key={key} aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><Button variant="ghost" size="sm" onClick={() => sortBy(key)}>{METRICS[key].label} {sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : null}</Button></TableHead>)}</TableRow></TableHeader>
          <TableBody>{sorted.map((cell) => {
            const id = JSON.stringify([cell.tool, cell.provider, cell.model]);
            const href = new URLSearchParams(query); href.set("tool", cell.tool); href.set("model", cell.model);
            return <Fragment key={id}><TableRow className={cell.tasks < minimum ? "text-muted-foreground" : undefined}><TableHead scope="row" className="sticky left-0 z-10 bg-card"><Button variant="ghost" className="justify-start" aria-expanded={expanded === id} onClick={() => setExpanded(expanded === id ? null : id)}><span aria-hidden="true">{expanded === id ? "−" : "+"}</span> <ToolBadge tool={cell.tool} /> <ModelBadge model={modelLabel(cell.provider, cell.model)} /></Button></TableHead><TableCell>{formatInt(cell.tasks)}{cell.unpricedTasks > 0 ? <small className="block text-muted-foreground">priced {formatInt(cell.tasks - cell.unpricedTasks)}/{formatInt(cell.tasks)}</small> : null}</TableCell>{metricKeys.filter((key) => visibleMetrics.includes(key)).map((key) => {
              const value = METRICS[key].value(cell); const winner = value != null && cell.tasks >= minimum && best.get(key) === value;
              return <TableCell key={key}>{winner ? <strong>{METRICS[key].format(value)} ★</strong> : value == null ? "—" : METRICS[key].format(value)}</TableCell>;
            })}</TableRow>{expanded === id ? <TableRow><TableCell className="whitespace-normal" colSpan={visibleMetrics.length + 2}><Link href={`/sessions?${href}`}>View sessions with this harness and model (all providers)</Link><p className="mt-2 text-muted-foreground">Per-model usage across this cell’s tasks and descendants</p>{cell.modelUsage.length ? <ul className="mt-2 list-inside list-disc">{cell.modelUsage.map((u) => <li key={modelKey(u.provider, u.model)}>{modelLabel(u.provider, u.model)}: {formatInt(u.requests)} requests, {formatInt(u.input)} input, {formatInt(u.output)} output, {formatInt(u.cacheRead)} cache read, {formatInt(u.cacheWrite)} cache write</li>)}</ul> : <p>No per-model usage recorded.</p>}</TableCell></TableRow> : null}</Fragment>;
          })}</TableBody></Table></div>}
      </CardContent>
    </Card>
  </div>;
}
