import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { previewOmittedCount } from "../../tools.ts";
import { getJson } from "../api.ts";
import { Badge } from "../badges.tsx";
import { EmptyState, ErrorState, StatCard, Tooltip } from "../common.tsx";
import { DateRangeControl } from "../date-range-control.tsx";
import { relativeTime } from "../date-time.ts";
import { errorRateDisplay } from "../error-rate.ts";
import { useDialogFocusTrap } from "../focus.ts";
import {
  capitalize,
  durationPrecise,
  errorMessage,
  firstLine,
  formatBytes,
  formatInt,
  isPresent,
} from "../format.ts";
import { Icon } from "../icons.tsx";
import { Link } from "../link.tsx";
import { mcpServerLabel, mcpServerLabels } from "../mcp-server.ts";
import {
  type McpSortKey,
  mcpSortValue,
  nextSort,
  SortableHeader,
  type SortState,
  sortRows,
  type ToolSortKey,
  toolSortValue,
} from "../sorting.tsx";
import { toolCallStatus } from "../tool-call-status.ts";
import {
  clearToolCallFilters,
  isDrilldownActivationKey,
  type ToolFilters,
  toolDateRangeFromFilters,
  toolFiltersFromSearch,
  toolFiltersHref,
  withToolDateRange,
} from "../tool-filters.ts";
import {
  type ScopedToolSummary,
  toolSummaryForScope,
  toolSummaryKey,
  toolSummaryNeedsRefresh,
  toolSummaryQuery,
  topToolLabel,
} from "../tool-summary.ts";
import { toolTableColumns } from "../tool-table-layout.ts";
import type {
  DashboardData,
  DateRangeSelection,
  ToolCallPage,
  ToolCallRow,
  ToolRow,
} from "../types.ts";

export function toolAggregate(
  tools: ToolRow[],
  summary: ToolCallPage["summary"],
  scope: Pick<ToolFilters, "tool" | "server"> = { tool: "", server: "" },
) {
  const resolvedSummary = summary ?? { calls: 0, errors: 0, p50_ms: null, p95_ms: null };
  const totalCalls = resolvedSummary.calls;
  const totalErrors = resolvedSummary.errors;
  const scopedTools = tools.filter(
    (row) =>
      (scope.tool === "" || row.tool_name === scope.tool) &&
      (scope.server === "" || row.mcp_server === scope.server),
  );
  return {
    totalCalls,
    errorRate: totalCalls === 0 ? 0 : (totalErrors / totalCalls) * 100,
    p50: resolvedSummary.p50_ms,
    p95: resolvedSummary.p95_ms,
    topTool:
      scopedTools.slice().sort((left, right) => right.calls - left.calls)[0]?.tool_name ?? null,
  };
}

export function toolCallInputLabel(value: string | null): string {
  if (!isPresent(value)) {
    return "—";
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const key of ["path", "file_path", "command", "cmd", "query", "url"]) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim() !== "") {
          return firstLine(candidate, 120);
        }
      }
    }
  } catch {}
  return firstLine(value, 120);
}

export function prettyToolValue(value: string | null): string {
  if (!isPresent(value)) {
    return "No value recorded.";
  }
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function ToolValueElision({ value }: { value: string | null }) {
  const omitted = previewOmittedCount(value);
  if (omitted == null) {
    return null;
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Icon name="minus" />
      <span>
        Middle elided, {formatInt(omitted)} characters omitted. Open the transcript for the whole
        value.
      </span>
    </p>
  );
}

export function ToolCallStatus({ call }: { call: ToolCallRow }) {
  const status = toolCallStatus(call.is_error, call.has_result);
  const badge = (
    <Badge className="gap-1" tone={status.tone}>
      <Icon name={status.icon} />
      {status.label}
    </Badge>
  );
  if (status.title == null) {
    return badge;
  }
  return (
    <Tooltip content={status.title}>
      {(tooltipProps) => (
        <span {...tooltipProps}>
          {badge}
          <span className="sr-only">{status.title}</span>
        </span>
      )}
    </Tooltip>
  );
}

export function DrilldownTableRow({
  children,
  href,
  label,
}: {
  children: ReactNode;
  href: string;
  label: string;
}) {
  const activate = () => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: An anchor cannot legally wrap a table row.
    <TableRow
      aria-label={label}
      className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={activate}
      onKeyDown={(event: ReactKeyboardEvent<HTMLTableRowElement>) => {
        if (!isDrilldownActivationKey(event.key)) {
          return;
        }
        event.preventDefault();
        activate();
      }}
      role="link"
      tabIndex={0}
    >
      {children}
    </TableRow>
  );
}

export function ToolCallDetail({
  call,
  onClose,
  onTabChange,
  serverLabel,
  tab,
}: {
  call: ToolCallRow;
  onClose: () => void;
  onTabChange: (tab: "preview" | "raw") => void;
  serverLabel: string;
  tab: "preview" | "raw";
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const transcriptHref =
    call.seq == null
      ? `/sessions/${call.session_id}`
      : `/sessions/${call.session_id}#message-${call.seq}`;
  useDialogFocusTrap(true, dialogRef, onClose);
  return (
    <>
      <button
        aria-label="Close tool call details"
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto border-l bg-background p-6 shadow-lg"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <span className="text-sm text-muted-foreground" title={call.mcp_server ?? undefined}>
              {serverLabel || call.tool_kind || "Tool call"}
            </span>
            <h2 className="break-all text-xl font-semibold" id={titleId}>{call.tool_name ?? "Unknown tool"}</h2>
          </div>
          <Button
            aria-label="Close details"
            variant="ghost" size="icon"
            onClick={onClose}
            type="button"
          >
            <Icon name="x" />
          </Button>
        </header>
        <dl className="my-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 [&_dt]:text-muted-foreground [&_dd]:font-medium">
          <div>
            <dt>Status</dt>
            <dd>
              <ToolCallStatus call={call} />
            </dd>
          </div>
          <div>
            <dt>Elapsed</dt>
            <dd>{durationPrecise(call.duration_ms)}</dd>
          </div>
          <div>
            <dt>Input size</dt>
            <dd>{formatBytes(call.input_bytes)}</dd>
          </div>
          <div>
            <dt>Output size</dt>
            <dd>{formatBytes(call.output_bytes)}</dd>
          </div>
        </dl>
        <div className="mb-4">
          <fieldset className="flex gap-2">
            <legend className="sr-only">Detail format</legend>
            {(["preview", "raw"] as const).map((choice) => (
              <Button
                variant={tab === choice ? "secondary" : "outline"}
                aria-pressed={tab === choice}
                key={choice}
                onClick={() => onTabChange(choice)}
                type="button"
              >
                {capitalize(choice)}
              </Button>
            ))}
          </fieldset>
        </div>
        <div className="flex-1 space-y-6 [&_h3]:mb-2 [&_h3]:font-semibold [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-xs">
          <section>
            <h3>Input</h3>
            <ToolValueElision value={call.input_preview} />
            <pre>
              {tab === "raw" ? (call.input_preview ?? "") : prettyToolValue(call.input_preview)}
            </pre>
          </section>
          <section>
            <h3>{call.is_error === true ? "Error output" : "Output preview"}</h3>
            <ToolValueElision value={call.output_preview} />
            <pre>
              {tab === "raw" ? (call.output_preview ?? "") : prettyToolValue(call.output_preview)}
            </pre>
          </section>
        </div>
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
          <div className="flex flex-col text-sm">
            <span>Session</span>
            <strong title={call.session_title ?? undefined}>
              {call.session_title ?? `Session ${call.session_id}`}
            </strong>
          </div>
          <Link className={buttonVariants({ variant: "outline" })} href={transcriptHref}>
            <Icon name="messages" />
            View in transcript
            <Icon name="chevronRight" />
          </Link>
        </footer>
      </section>
    </>
  );
}

export function ToolsView({
  data,
  dateRange,
  mcpStatus,
  onDateRangeChange,
  reloadKey,
  toolsStatus,
}: {
  data: DashboardData;
  dateRange: DateRangeSelection;
  mcpStatus: "loading" | "ready" | "failed";
  onDateRangeChange: (range: DateRangeSelection) => void;
  reloadKey: number;
  toolsStatus: "loading" | "ready" | "failed";
}) {
  const locationFilters = toolFiltersFromSearch(window.location.search);
  const [mcpSort, setMcpSort] = useState<SortState<McpSortKey>>({
    key: "calls",
    direction: "desc",
  });
  const [toolSort, setToolSort] = useState<SortState<ToolSortKey>>({
    key: "calls",
    direction: "desc",
  });
  const [callPage, setCallPage] = useState<ToolCallPage>({
    calls: [],
    total: 0,
    limit: 50,
    offset: locationFilters.offset,
    summary: null,
  });
  const [callError, setCallError] = useState<{ query: string; message: string } | null>(null);
  const [callsRequestKey, setCallsRequestKey] = useState<string | null>(null);
  const [savedSummary, setSavedSummary] = useState<ScopedToolSummary | null>(null);
  const [summaryErrorScope, setSummaryErrorScope] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<ToolCallRow | null>(null);
  const [detailTab, setDetailTab] = useState<"preview" | "raw">("preview");
  const closeToolDetail = useCallback(() => setSelectedCall(null), []);
  const mcpRows = useMemo(
    () => (mcpStatus === "ready" ? sortRows(data.mcp, mcpSort, mcpSortValue) : []),
    [data.mcp, mcpSort, mcpStatus],
  );
  const toolRows = useMemo(
    () => (toolsStatus === "ready" ? sortRows(data.tools, toolSort, toolSortValue) : []),
    [data.tools, toolSort, toolsStatus],
  );
  const toolFilterRows = toolsStatus === "ready" ? data.tools : [];
  const serverFilterRows = mcpStatus === "ready" ? data.mcp : [];
  const serverLabels = useMemo(
    () =>
      mcpServerLabels([
        ...data.mcp.map((row) => row.mcp_server),
        ...data.tools.map((row) => row.mcp_server),
      ]),
    [data.mcp, data.tools],
  );
  const callQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (locationFilters.tool !== "") {
      params.set("tool", locationFilters.tool);
    }
    if (locationFilters.server !== "") {
      params.set("server", locationFilters.server);
    }
    if (locationFilters.errorsOnly) {
      params.set("errors_only", "true");
    }
    if (locationFilters.minMs > 0) {
      params.set("min_ms", String(locationFilters.minMs));
    }
    if (locationFilters.from != null) {
      params.set("from", locationFilters.from);
    }
    if (locationFilters.to != null) {
      params.set("to", locationFilters.to);
    }
    params.set("limit", "50");
    params.set("offset", String(locationFilters.offset));
    return params.toString();
  }, [
    locationFilters.errorsOnly,
    locationFilters.from,
    locationFilters.minMs,
    locationFilters.offset,
    locationFilters.server,
    locationFilters.to,
    locationFilters.tool,
  ]);
  const summaryScopeKey = toolSummaryKey(locationFilters);
  const summaryQuery = toolSummaryQuery(locationFilters);
  const callSummary = toolSummaryForScope(savedSummary, summaryScopeKey);
  const summaryNeedsRefresh = toolSummaryNeedsRefresh(savedSummary, summaryScopeKey, reloadKey);
  const laterCallPage = locationFilters.offset > 0;
  const aggregate = useMemo(
    () =>
      toolAggregate(data.tools, callSummary, {
        tool: locationFilters.tool,
        server: locationFilters.server,
      }),
    [data.tools, callSummary, locationFilters.tool, locationFilters.server],
  );
  const durationAvailable =
    data.tools.some((row) => row.p50_ms != null) ||
    callPage.calls.some((row) => row.duration_ms != null);
  const mcpColumns = toolTableColumns("mcp", durationAvailable);
  const toolColumns = toolTableColumns("tools", durationAvailable);
  const callColumns = toolTableColumns("calls", durationAvailable);

  useEffect(() => {
    const restored = toolDateRangeFromFilters({
      from: locationFilters.from,
      to: locationFilters.to,
    });
    if (restored.from === dateRange.from && restored.to === dateRange.to) {
      return;
    }
    onDateRangeChange(restored);
  }, [dateRange.from, dateRange.to, locationFilters.from, locationFilters.to, onDateRangeChange]);

  useEffect(() => {
    const controller = new AbortController();
    setCallError(null);
    if (locationFilters.offset === 0) {
      setSummaryErrorScope(null);
    }
    void getJson<ToolCallPage>(`/api/tools/calls?${callQuery}`, {
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) {
          return;
        }
        setCallPage(page);
        setCallsRequestKey(callQuery);
        if (page.summary != null) {
          setSavedSummary({ scopeKey: summaryScopeKey, reloadKey, summary: page.summary });
        } else if (locationFilters.offset === 0) {
          setSummaryErrorScope(summaryScopeKey);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCallError({ query: callQuery, message: errorMessage(error) });
          if (locationFilters.offset === 0) {
            setSummaryErrorScope(summaryScopeKey);
          }
        }
      });
    return () => controller.abort();
  }, [callQuery, locationFilters.offset, reloadKey, summaryScopeKey]);

  useEffect(() => {
    if (!laterCallPage || !summaryNeedsRefresh) {
      return;
    }
    const controller = new AbortController();
    setSummaryErrorScope(null);
    void getJson<ToolCallPage>(`/api/tools/calls?${summaryQuery}`, {
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) {
          return;
        }
        if (page.summary == null) {
          setSummaryErrorScope(summaryScopeKey);
        } else {
          setSavedSummary({ scopeKey: summaryScopeKey, reloadKey, summary: page.summary });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSummaryErrorScope(summaryScopeKey);
        }
      });
    return () => controller.abort();
  }, [laterCallPage, reloadKey, summaryNeedsRefresh, summaryQuery, summaryScopeKey]);

  const updateFilters = (patch: Partial<ToolFilters>) => {
    const next = { ...locationFilters, ...patch };
    if (
      patch.tool != null ||
      patch.server != null ||
      patch.errorsOnly != null ||
      patch.minMs != null ||
      patch.from !== undefined ||
      patch.to !== undefined
    ) {
      next.offset = 0;
    }
    const href = toolFiltersHref(next);
    window.history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const clearedCallFilters = clearToolCallFilters(locationFilters);
  const clearedFiltersHref = toolFiltersHref(clearedCallFilters);
  const errorRate = errorRateDisplay(aggregate.totalCalls, aggregate.errorRate);
  const summaryLoading = callSummary == null && summaryErrorScope !== summaryScopeKey;
  const summaryAvailable = callSummary != null;
  const callsCurrent = callsRequestKey === callQuery;
  const currentCallError = callError?.query === callQuery ? callError.message : null;
  const usageDateMatches =
    dateRange.from === locationFilters.from && dateRange.to === locationFilters.to;
  const topToolLoading = toolsStatus === "loading" || !usageDateMatches;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tools &amp; MCP</h1>
          <p className="text-sm text-muted-foreground">Tool and MCP-server call volume, scoped to your session logs.</p>
        </div>
        <DateRangeControl
          bounds={data.dateBounds}
          range={dateRange}
          onChange={(range) => {
            onDateRangeChange(range);
            const href = toolFiltersHref(withToolDateRange(locationFilters, range));
            window.history.pushState(null, "", href);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
        />
      </header>

      <section
        aria-busy={summaryLoading || topToolLoading}
        aria-label="Tool call summary"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          icon="tools"
          label="Total calls"
          value={
            summaryLoading ? "Loading…" : summaryAvailable ? formatInt(aggregate.totalCalls) : "—"
          }
        />
        <StatCard
          alert={summaryAvailable && errorRate.alert}
          icon="info"
          label="Error rate"
          value={summaryLoading ? "Loading…" : summaryAvailable ? errorRate.label : "—"}
        />
        <StatCard
          icon="clock"
          label="Median / p95 elapsed"
          value={
            summaryLoading
              ? "Loading…"
              : aggregate.p50 == null || aggregate.p95 == null
                ? "—"
                : `${durationPrecise(aggregate.p50)} / ${durationPrecise(aggregate.p95)}`
          }
        />
        <StatCard
          icon="bolt"
          label="Top tool"
          value={
            topToolLoading
              ? "Loading…"
              : toolsStatus !== "ready" || aggregate.topTool == null
                ? "—"
                : topToolLabel(aggregate.topTool)
          }
          valueTitle={
            topToolLoading || toolsStatus !== "ready" ? undefined : (aggregate.topTool ?? undefined)
          }
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>MCP servers</CardTitle>
          <p className="text-sm text-muted-foreground">Model Context Protocol servers and their call volume</p>
        </CardHeader>
        {mcpStatus === "loading" ? (
          <div className="px-6 text-sm text-muted-foreground" role="status">
            Loading MCP servers…
          </div>
        ) : mcpStatus === "failed" ? (
          <div className="px-6 text-sm text-muted-foreground">MCP servers could not be loaded.</div>
        ) : mcpRows.length === 0 ? (
          <EmptyState
            icon="cpu"
            message="No MCP tool calls in this range."
            title="No MCP servers"
          />
        ) : (
          <div className="mx-6 overflow-hidden rounded-md border">
            <Table>
              <colgroup>
                {mcpColumns.map((column) => (
                  <col
                    className={undefined}
                    key={column.className}
                    style={{ width: `${column.width}%` }}
                  />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <SortableHeader
                    label="Server"
                    onSort={(key) => setMcpSort((sort) => nextSort(sort, key))}
                    sort={mcpSort}
                    sortKey="server"
                  />
                  <SortableHeader
                    align="right"
                    label="Tools"
                    onSort={(key) => setMcpSort((sort) => nextSort(sort, key))}
                    sort={mcpSort}
                    sortKey="tools"
                  />
                  <SortableHeader
                    align="right"
                    label="Calls"
                    onSort={(key) => setMcpSort((sort) => nextSort(sort, key))}
                    sort={mcpSort}
                    sortKey="calls"
                  />
                  <SortableHeader
                    align="right"
                    label="Errors"
                    onSort={(key) => setMcpSort((sort) => nextSort(sort, key))}
                    sort={mcpSort}
                    sortKey="errors"
                  />
                  {durationAvailable ? (
                    <SortableHeader
                      align="right"
                      label="Median elapsed"
                      onSort={(key) => setMcpSort((sort) => nextSort(sort, key))}
                      sort={mcpSort}
                      sortKey="p50"
                    />
                  ) : null}
                  <SortableHeader
                    align="right"
                    label="Last used"
                    onSort={(key) => setMcpSort((sort) => nextSort(sort, key))}
                    sort={mcpSort}
                    sortKey="last_used"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {mcpRows.map((row) => {
                  const href = toolFiltersHref({
                    ...clearedCallFilters,
                    server: row.mcp_server,
                  });
                  return (
                    <DrilldownTableRow
                      href={href}
                      key={row.mcp_server}
                      label={`Show calls from MCP server ${mcpServerLabel(serverLabels, row.mcp_server)}`}
                    >
                      <TableCell className="font-mono">
                        <span className="inline-flex items-center gap-2">
                          <Icon name="cpu" />
                          <span title={row.mcp_server ?? undefined}>
                            {mcpServerLabel(serverLabels, row.mcp_server)}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatInt(row.tools)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(row.calls)}</TableCell>
                      <TableCell className="text-right">
                        {row.errors > 0 ? (
                          <Badge tone="danger">{formatInt(row.errors)}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      {durationAvailable ? (
                        <TableCell className="text-right text-muted-foreground">{durationPrecise(row.p50_ms)}</TableCell>
                      ) : null}
                      <TableCell className="text-right text-muted-foreground">{relativeTime(row.last_used_at)}</TableCell>
                    </DrilldownTableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tools</CardTitle>
          <p className="text-sm text-muted-foreground">Built-in vs MCP, most-called first</p>
        </CardHeader>
        <div className="mx-6 overflow-hidden rounded-md border">
          <Table aria-busy={toolsStatus === "loading"}>
            <colgroup>
              {toolColumns.map((column) => (
                <col
                  className={undefined}
                  key={column.className}
                  style={{ width: `${column.width}%` }}
                />
              ))}
            </colgroup>
            <TableHeader>
              <TableRow>
                <SortableHeader
                  label="Tool"
                  onSort={(key) => setToolSort((sort) => nextSort(sort, key))}
                  sort={toolSort}
                  sortKey="tool"
                />
                <SortableHeader
                  label="Kind"
                  onSort={(key) => setToolSort((sort) => nextSort(sort, key))}
                  sort={toolSort}
                  sortKey="kind"
                />
                <SortableHeader
                  label="Server"
                  onSort={(key) => setToolSort((sort) => nextSort(sort, key))}
                  sort={toolSort}
                  sortKey="server"
                />
                <SortableHeader
                  align="right"
                  label="Calls"
                  onSort={(key) => setToolSort((sort) => nextSort(sort, key))}
                  sort={toolSort}
                  sortKey="calls"
                />
                <SortableHeader
                  align="right"
                  label="Errors"
                  onSort={(key) => setToolSort((sort) => nextSort(sort, key))}
                  sort={toolSort}
                  sortKey="errors"
                />
                {durationAvailable ? (
                  <SortableHeader
                    align="right"
                    label="Median elapsed"
                    onSort={(key) => setToolSort((sort) => nextSort(sort, key))}
                    sort={toolSort}
                    sortKey="p50"
                  />
                ) : null}
                <SortableHeader
                  align="right"
                  label="Last used"
                  onSort={(key) => setToolSort((sort) => nextSort(sort, key))}
                  sort={toolSort}
                  sortKey="last_used"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {toolRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={durationAvailable ? 7 : 6}>
                    {toolsStatus === "loading"
                      ? "Loading tools…"
                      : toolsStatus === "failed"
                        ? "Tool usage could not be loaded."
                        : "No tool calls."}
                  </TableCell>
                </TableRow>
              ) : null}
              {toolRows.map((row) => {
                const href = toolFiltersHref({
                  ...clearedCallFilters,
                  tool: row.tool_name,
                });
                return (
                  <DrilldownTableRow
                    href={href}
                    key={`${row.tool_name}-${row.tool_kind}-${row.mcp_server ?? ""}`}
                    label={`Show calls to tool ${row.tool_name}`}
                  >
                    <TableCell className="font-mono">{row.tool_name}</TableCell>
                    <TableCell>
                      <Badge tone={row.tool_kind === "mcp" ? "accent" : "neutral"}>
                        {row.tool_kind === "mcp" ? "MCP" : "built-in"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {row.mcp_server != null && row.mcp_server !== "" ? (
                        <span className="inline-flex items-center gap-2">
                          <Icon name="cpu" />
                          <span title={row.mcp_server}>
                            {mcpServerLabel(serverLabels, row.mcp_server)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(row.calls)}</TableCell>
                    <TableCell className="text-right">
                      {row.errors > 0 ? (
                        <Badge tone="danger">{formatInt(row.errors)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    {durationAvailable ? (
                      <TableCell className="text-right text-muted-foreground">{durationPrecise(row.p50_ms)}</TableCell>
                    ) : null}
                    <TableCell className="text-right text-muted-foreground">{relativeTime(row.last_used_at)}</TableCell>
                  </DrilldownTableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Calls</CardTitle>
            <p className="text-sm text-muted-foreground">Inspect individual tool activity, inputs, results, and elapsed time</p>
          </div>
          <span className="text-sm text-muted-foreground">
            {callsCurrent
              ? `${formatInt(callPage.total)} matching`
              : currentCallError == null
                ? "Loading…"
                : "—"}
          </span>
        </CardHeader>
        <div className="flex flex-wrap items-end gap-3 px-6">
          <div className="space-y-1 text-sm">
            <span>Tool</span>
            <Select value={`tool:${locationFilters.tool}`} onValueChange={(value) => updateFilters({ tool: value.slice(5) })}>
              <SelectTrigger aria-label="Tool" className="w-48"><SelectValue>{locationFilters.tool || "All tools"}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="tool:">All tools</SelectItem>
                {locationFilters.tool !== "" && !toolFilterRows.some((row) => row.tool_name === locationFilters.tool) ? (
                  <SelectItem value={`tool:${locationFilters.tool}`}>{locationFilters.tool}</SelectItem>
                ) : null}
                {toolFilterRows.map((row) => <SelectItem key={`${row.tool_name}-${row.mcp_server ?? ""}`} value={`tool:${row.tool_name}`}>{row.tool_name} ({formatInt(row.calls)})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-sm">
            <span>Server</span>
            <Select value={`server:${locationFilters.server}`} onValueChange={(value) => updateFilters({ server: value.slice(7) })}>
              <SelectTrigger aria-label="Server" className="w-48"><SelectValue>{locationFilters.server ? mcpServerLabel(serverLabels, locationFilters.server) : "All servers"}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="server:">All servers</SelectItem>
                {locationFilters.server !== "" && !serverFilterRows.some((row) => row.mcp_server === locationFilters.server) ? (
                  <SelectItem value={`server:${locationFilters.server}`}>{mcpServerLabel(serverLabels, locationFilters.server)}</SelectItem>
                ) : null}
                {serverFilterRows.map((row) => <SelectItem key={row.mcp_server} value={`server:${row.mcp_server}`}>{mcpServerLabel(serverLabels, row.mcp_server)} ({formatInt(row.calls)})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-sm">
            <span>Minimum elapsed</span>
            <Select value={String(locationFilters.minMs)} onValueChange={(value) => updateFilters({ minMs: Number(value) })}>
              <SelectTrigger aria-label="Minimum elapsed" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Any elapsed time</SelectItem>
                <SelectItem value="100">100 ms+</SelectItem>
                <SelectItem value="1000">1 s+</SelectItem>
                <SelectItem value="5000">5 s+</SelectItem>
                <SelectItem value="30000">30 s+</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={locationFilters.errorsOnly} onCheckedChange={(checked) => updateFilters({ errorsOnly: checked === true })} />
            Errors only
          </label>
          {locationFilters.tool !== "" ||
          locationFilters.server !== "" ||
          locationFilters.errorsOnly ||
          locationFilters.minMs > 0 ? (
            <Link className={buttonVariants({ variant: "outline" })} href={clearedFiltersHref}>
              Clear filters
            </Link>
          ) : null}
        </div>
        {currentCallError != null ? (
          <ErrorState
            action={
              <Button variant="outline" onClick={() => updateFilters({})} type="button">
                Retry
              </Button>
            }
            detail={currentCallError}
            title="Tool calls could not be loaded"
          />
        ) : !callsCurrent ? (
          <div className="px-6 text-sm text-muted-foreground">Loading calls…</div>
        ) : callPage.calls.length === 0 ? (
          <EmptyState
            icon="tools"
            message="Try a wider date range or clear one of the filters."
            title="No matching tool calls"
          />
        ) : (
          <>
            <div className="mx-6 overflow-hidden rounded-md border">
              <Table>
                <colgroup>
                  {callColumns.map((column) => (
                    <col
                      className={undefined}
                      key={column.className}
                      style={{ width: `${column.width}%` }}
                    />
                  ))}
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead>Input preview</TableHead>
                    {durationAvailable ? <TableHead className="text-right">Elapsed</TableHead> : null}
                    <TableHead className="text-right">Output</TableHead>
                    <TableHead className="text-right">When</TableHead>
                    <TableHead>Session</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {callPage.calls.map((call) => (
                    <TableRow
                      className="cursor-pointer"
                      key={call.id}
                      onClick={() => {
                        setSelectedCall(call);
                        setDetailTab("preview");
                      }}
                    >
                      <TableCell>
                        <ToolCallStatus call={call} />
                      </TableCell>
                      <TableCell className="font-mono">
                        <button
                          aria-label={`Inspect ${call.tool_name ?? "unknown tool"} call`}
                          className="max-w-full truncate text-left underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-ring"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedCall(call);
                            setDetailTab("preview");
                          }}
                          type="button"
                        >
                          {call.tool_name ?? "Unknown"}
                        </button>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {toolCallInputLabel(call.input_preview)}
                      </TableCell>
                      {durationAvailable ? (
                        <TableCell className="text-right text-muted-foreground">{durationPrecise(call.duration_ms)}</TableCell>
                      ) : null}
                      <TableCell className="text-right text-muted-foreground">{formatBytes(call.output_bytes)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{relativeTime(call.timestamp)}</TableCell>
                      <TableCell>
                        <Link
                          href={`/sessions/${call.session_id}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {call.session_title ?? `Session ${call.session_id}`} →
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 px-6 text-sm">
              <Button
                variant="outline"
                disabled={callPage.offset === 0}
                onClick={() =>
                  updateFilters({ offset: Math.max(0, callPage.offset - callPage.limit) })
                }
                type="button"
              >
                <Icon name="chevronLeft" />
                Previous
              </Button>
              <span className="text-muted-foreground">
                {formatInt(callPage.offset + 1)}–
                {formatInt(Math.min(callPage.offset + callPage.calls.length, callPage.total))} of{" "}
                {formatInt(callPage.total)}
              </span>
              <Button
                variant="outline"
                disabled={callPage.offset + callPage.calls.length >= callPage.total}
                onClick={() => updateFilters({ offset: callPage.offset + callPage.limit })}
                type="button"
              >
                Next
                <Icon name="chevronRight" />
              </Button>
            </div>
          </>
        )}
      </Card>

      {selectedCall != null ? (
        <ToolCallDetail
          call={selectedCall}
          onClose={closeToolDetail}
          onTabChange={setDetailTab}
          serverLabel={mcpServerLabel(serverLabels, selectedCall.mcp_server)}
          tab={detailTab}
        />
      ) : null}
    </div>
  );
}
