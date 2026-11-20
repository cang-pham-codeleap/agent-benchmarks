import { Fragment, useEffect, useMemo, useState } from "react";
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
const columnsStorageKey = "decant-compare-columns-v1";
const toolsStorageKey = "decant-compare-tools-v1";
const modelsStorageKey = "decant-compare-models-v2";

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
  return <details className="compare-columns">
    <summary>{label}: {selected.length ? selected.map(format).join(", ") : "All"}</summary>
    <fieldset><legend>{label}</legend>
      <button type="button" onClick={onClear} disabled={!selected.length}>Show all</button>
      {options.map((value) => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} /> {format(value)}</label>)}
    </fieldset>
  </details>;
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
  const shown = cells.filter((cell) => (!tools.length || tools.includes(cell.tool)) && (!models.length || models.includes(modelKey(cell.provider, cell.model))));
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
  return <div className="view-stack">
    <header className="page-heading inline-heading"><div><h1>Compare</h1><p>Compare harness, provider, and primary model across tasks and their subagents.</p></div>
      <DateRangeControl bounds={data.dateBounds} range={dateRange} onChange={onDateRangeChange} />
    </header>
    <section className="panel">
      <div className="panel-heading"><div><h2>Harness × provider × model</h2><p>Transcript ending (heuristic), not success. Cost statistics exclude unpriced tasks. ★ marks the best value among eligible cells.</p></div></div>
      <div className="session-list-controls" style={{ padding: "0 1rem 1rem", flexWrap: "wrap" }}>
        <label>Project <select value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{data.projects.map((p) => <option key={p.path} value={p.path}>{p.name || p.path}</option>)}</select></label>
        <label>Work type <select value={workType} onChange={(e) => setWorkType(e.target.value)}><option value="">All work types</option><option value="unclassified">Unclassified</option>{["debugging", "feature", "refactor", "research", "ops"].map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Transcript ending (heuristic) <select value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">All endings</option><option value="unclassified">Unclassified</option>{["completed", "failed", "abandoned"].map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Minimum tasks for best <input type="number" min="1" value={minimum} onChange={(e) => setMinimum(Math.max(1, Number(e.target.value) || 1))} style={{ width: "5rem" }} /></label>
        <PickList label="Harness" selected={tools} options={toolOptions} format={toolLabel} onToggle={(v) => pick(toolsStorageKey, tools, setTools, v)} onClear={() => { setTools([]); writeStorage(toolsStorageKey, "[]"); }} />
        <PickList label="Model" selected={models} options={modelOptions} format={storedModelLabel} onToggle={(v) => pick(modelsStorageKey, models, setModels, v)} onClear={() => { setModels([]); writeStorage(modelsStorageKey, "[]"); }} />
        <details className="compare-columns">
          <summary>Columns</summary>
          <fieldset><legend>Visible metrics</legend>{metricKeys.map((key) => <label key={key}><input type="checkbox" checked={visibleMetrics.includes(key)} onChange={() => toggleMetric(key)} /> {METRICS[key].label}</label>)}</fieldset>
        </details>
      </div>
      {error ? <p role="alert">Could not load comparison data. Change a filter or retry the sync.</p> : result?.query !== query ? <p>Loading comparison…</p> : shown.length === 0 ? <p>No tasks match these filters.</p> :
      <div className="table-scroll" role="region" aria-label="Harness, provider, and model comparison" tabIndex={0}><table className="data-table compare-table"><thead><tr><th scope="col">Harness / provider / model</th><th scope="col" aria-sort={sort.key === "tasks" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button className="sort-header" type="button" onClick={() => sortBy("tasks")}>Tasks {sort.key === "tasks" ? (sort.direction === "asc" ? "↑" : "↓") : null}</button></th>{metricKeys.filter((key) => visibleMetrics.includes(key)).map((key) => <th scope="col" key={key} aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button className="sort-header" type="button" onClick={() => sortBy(key)}>{METRICS[key].label} {sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : null}</button></th>)}</tr></thead>
        <tbody>{sorted.map((cell) => {
          const id = JSON.stringify([cell.tool, cell.provider, cell.model]);
          const href = new URLSearchParams(query); href.set("tool", cell.tool); href.set("model", cell.model);
          return <Fragment key={id}><tr className={cell.tasks < minimum ? "compare-low-sample" : undefined}><th scope="row"><button className="compare-identity" type="button" aria-expanded={expanded === id} onClick={() => setExpanded(expanded === id ? null : id)}><span aria-hidden="true">{expanded === id ? "−" : "+"}</span> <ToolBadge tool={cell.tool} /> <ModelBadge model={modelLabel(cell.provider, cell.model)} /></button></th><td>{formatInt(cell.tasks)}{cell.unpricedTasks > 0 ? <small>priced {formatInt(cell.tasks - cell.unpricedTasks)}/{formatInt(cell.tasks)}</small> : null}</td>{metricKeys.filter((key) => visibleMetrics.includes(key)).map((key) => {
            const value = METRICS[key].value(cell); const winner = value != null && cell.tasks >= minimum && best.get(key) === value;
            return <td key={key}>{winner ? <strong>{METRICS[key].format(value)} ★</strong> : value == null ? "—" : METRICS[key].format(value)}</td>;
          })}</tr>{expanded === id ? <tr><td className="compare-details" colSpan={visibleMetrics.length + 2}><Link href={`/sessions?${href}`}>View sessions with this harness and model (all providers)</Link><p>Per-model usage across this cell’s tasks and descendants</p>{cell.modelUsage.length ? <ul>{cell.modelUsage.map((u) => <li key={modelKey(u.provider, u.model)}>{modelLabel(u.provider, u.model)}: {formatInt(u.requests)} requests, {formatInt(u.input)} input, {formatInt(u.output)} output, {formatInt(u.cacheRead)} cache read, {formatInt(u.cacheWrite)} cache write</li>)}</ul> : <p>No per-model usage recorded.</p>}</td></tr> : null}</Fragment>;
        })}</tbody></table></div>}
    </section>
  </div>;
}
