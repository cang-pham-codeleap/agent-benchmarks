import { memo, type ReactNode, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getJson } from "../api.ts";
import dosuOfficialUrl from "../assets/dosu-official.svg";
import { Badge, displayModelLabel, ModelBadge, ReasoningBadge, ToolBadge } from "../badges.tsx";
import { StatCard, Tooltip } from "../common.tsx";
import { EMPTY_SESSION_IDS, SESSION_PAGE_SIZE, SESSION_TABLE_SKELETON_KEYS } from "../constants.ts";
import { dateRangeQuery } from "../date-range.ts";
import { DateRangeControl } from "../date-range-control.tsx";
import { fullDateTime, sessionListDate } from "../date-time.ts";
import { dosuBadgeAriaLabel, dosuEvidenceSummary } from "../dosu-badge.ts";
import { basename, compact, costDisplay, formatInt, money } from "../format.ts";
import { Icon } from "../icons.tsx";
import { Link, visit } from "../link.tsx";
import { shouldShowSessionSkeleton } from "../loading-state.ts";
import {
  projectSessionsHref,
  sessionIncludesArchived,
  sessionPageFromPath,
  sessionProjectFilter,
  sessionRepoFilter,
  sessionsArchivedHref,
  sessionsClearFilterHref,
  sessionsPageHref,
} from "../navigation.ts";
import {
  scopedSessionSummaryKey,
  sessionCardMetrics,
  sessionSummaryPath,
  sessionThreadCost,
  sessionThreadUsageAvailable,
} from "../session-summary.ts";
import { sessionDisplayTitle, subagentDescriptor } from "../session-title.ts";
import type {
  DashboardData,
  DateRangeSelection,
  SessionPageState,
  SessionSummary,
  Summary,
} from "../types.ts";

export function SessionsView({
  data,
  dateRange,
  onDateRangeChange,
  onTextFilterChange,
  path,
  reloadKey,
  sessionPageState,
}: {
  data: DashboardData;
  dateRange: DateRangeSelection;
  onDateRangeChange: (range: DateRangeSelection) => void;
  onTextFilterChange?: (active: boolean) => void;
  path: string;
  reloadKey: number;
  sessionPageState: SessionPageState;
}) {
  const [query, setQuery] = useState("");
  const [scopedSummary, setScopedSummary] = useState<{
    key: string;
    value: Summary;
  } | null>(null);
  const [expandedSessionState, setExpandedSessionState] = useState<{
    ids: Set<number>;
    key: string;
  }>(() => ({ ids: new Set(), key: "" }));
  const { exhausted, loadedPage, loading, refreshing, sessions } = sessionPageState;
  const filtered = filterSessions(sessions, query);
  const project = sessionProjectFilter(path);
  const repo = sessionRepoFilter(path);
  const includeArchived = sessionIncludesArchived(path);
  const page = sessionPageFromPath(path);
  const params = new URLSearchParams(path.split("?", 2)[1] ?? "");
  const compareFilters = ["tool", "model", "work_type", "outcome"].filter((key) => params.has(key));
  const displayedPage = loadedPage ?? page;
  const pageLoading = loading || (loadedPage != null && page !== loadedPage);
  const dateQuery = dateRangeQuery(dateRange);
  const sessionFilterKey = JSON.stringify([dateQuery, project, repo, includeArchived, page, path]);
  const expandedSessions =
    expandedSessionState.key === sessionFilterKey ? expandedSessionState.ids : EMPTY_SESSION_IDS;
  const scopedSummaryRequest =
    project == null && repo == null && !includeArchived
      ? null
      : sessionSummaryPath(project, dateQuery, includeArchived, repo);
  const scopedSummaryRequestKey =
    scopedSummaryRequest == null ? null : scopedSessionSummaryKey(scopedSummaryRequest, reloadKey);
  const currentScopedSummary =
    scopedSummary?.key === scopedSummaryRequestKey ? scopedSummary.value : null;
  const cardSummary = sessionCardMetrics(
    scopedSummaryRequest == null ? data.summary : currentScopedSummary,
    filtered,
    query,
  );
  const estCost = costDisplay(
    cardSummary.estimated_cost_usd,
    cardSummary.sessions,
    cardSummary.usage_sessions,
  );
  const visibleTotal = compareFilters.length
    ? null
    : project == null && repo == null
      ? (data.summary?.sessions ?? null)
      : (currentScopedSummary?.sessions ?? null);
  const listTotal = includeArchived ? null : visibleTotal;
  const pageCount =
    listTotal == null ? null : Math.max(1, Math.ceil(listTotal / SESSION_PAGE_SIZE));
  const hasNextPage = !exhausted;
  const showPagination = displayedPage > 1 || page > 1 || hasNextPage;
  const waitingForSessions = shouldShowSessionSkeleton({
    isLoading: loading,
    loadedRows: sessions.length,
    query,
  });
  const textFilterActive = query.trim() !== "";
  const emptyMessage =
    waitingForSessions || filtered.length > 0
      ? null
      : textFilterActive
        ? "No sessions match that filter."
        : displayedPage > 1
          ? "No sessions on this page."
          : "No sessions ingested yet.";

  useEffect(() => {
    onTextFilterChange?.(textFilterActive);
  }, [onTextFilterChange, textFilterActive]);

  useEffect(() => {
    if (scopedSummaryRequest == null) {
      setScopedSummary(null);
      return;
    }
    let cancelled = false;
    setScopedSummary(null);
    void getJson<Summary>(scopedSummaryRequest)
      .then((summary) => {
        if (!cancelled) {
          setScopedSummary({
            key: scopedSessionSummaryKey(scopedSummaryRequest, reloadKey),
            value: summary,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setScopedSummary(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, scopedSummaryRequest]);

  const toggleSession = useCallback(
    (id: number) => {
      setExpandedSessionState((current) => {
        const next = new Set(current.key === sessionFilterKey ? current.ids : EMPTY_SESSION_IDS);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { ids: next, key: sessionFilterKey };
      });
    },
    [sessionFilterKey],
  );

  const renderRows = (session: SessionSummary, depth = 0): ReactNode[] => {
    const expanded = expandedSessions.has(session.id);
    const rows: ReactNode[] = [
      <SessionTableRow
        depth={depth}
        expanded={expanded}
        key={session.id}
        onToggle={toggleSession}
        session={session}
      />,
    ];
    if (expanded) {
      for (const subagent of session.subagents ?? []) {
        rows.push(...renderRows(subagent, depth + 1));
      }
    }
    return rows;
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
          <p className="text-sm text-muted-foreground">
            Every agent session log on this device, plus imported ATIF trajectories.
          </p>
        </div>
        <DateRangeControl bounds={data.dateBounds} range={dateRange} onChange={onDateRangeChange} />
      </header>

      {compareFilters.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard icon="sessions" label="Sessions" value={formatInt(cardSummary.sessions)} />
          <StatCard icon="messages" label="Messages" value={formatInt(cardSummary.messages)} />
          <StatCard
            icon="money"
            label="Est. cost"
            value={estCost.text}
            valueTitle={estCost.title}
          />
        </div>
      ) : null}

      <Card
        aria-busy={pageLoading || refreshing}
        className="gap-0 overflow-hidden py-0 [contain:layout_paint] [overflow-anchor:none]"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 p-6">
          <h2 className="text-lg font-semibold">Sessions</h2>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeArchived}
                onCheckedChange={(checked) => visit(sessionsArchivedHref(path, checked === true))}
              />
              <span>Show archived</span>
            </label>
            <Input
              aria-label="Filter sessions"
              className="w-64 max-w-full"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by title, model, or tool..."
              value={query}
            />
          </div>
        </div>
        {compareFilters.length ? (
          <div className="flex flex-wrap gap-2 px-6 pb-4">
            {compareFilters.map((key) => (
              <span className="rounded-md border bg-muted px-2 py-1 text-xs" key={key}>
                {key}: {params.get(key) || "Unknown"}
              </span>
            ))}
          </div>
        ) : null}
        {project != null ? (
          <div className="flex flex-wrap gap-2 px-6 pb-4">
            <span className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs">
              Project: <strong>{basename(project)}</strong>
              <Link
                aria-label="Clear project filter"
                href={sessionsClearFilterHref(path, "project")}
              >
                <Icon name="x" />
              </Link>
            </span>
          </div>
        ) : null}
        {repo != null ? (
          <div className="flex flex-wrap gap-2 px-6 pb-4">
            <span
              className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
              title={`${repo}, including its worktrees`}
            >
              Repository: <strong>{basename(repo)}</strong>
              <Link
                aria-label="Clear repository filter"
                href={sessionsClearFilterHref(path, "repo")}
              >
                <Icon name="x" />
              </Link>
            </span>
          </div>
        ) : null}
        <div className="@container border-y">
          <Table className="min-w-[1084px] table-fixed">
            <colgroup>
              <col className="w-[156px]" />
              <col />
              <col className="w-[160px]" />
              <col className="w-[180px]" />
              <col className="hidden w-[120px] @min-[1448px]:table-column" />
              <col className="hidden w-[72px] @min-[1448px]:table-column" />
              <col className="hidden w-[60px] @min-[1448px]:table-column" />
              <col className="hidden w-[112px] @min-[1196px]:table-column" />
              <col className="w-[72px]" />
              <col className="w-[92px]" />
              <col className="w-[144px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="hidden @min-[1448px]:table-cell">Effort</TableHead>
                <TableHead className="hidden text-right @min-[1448px]:table-cell">
                  Peak ctx
                </TableHead>
                <TableHead className="hidden text-right @min-[1448px]:table-cell">Comp.</TableHead>
                <TableHead className="hidden text-right @min-[1196px]:table-cell">
                  Subagents
                </TableHead>
                <TableHead className="text-right">Msgs</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {waitingForSessions ? <SessionTableSkeletonRows /> : null}
              {!waitingForSessions ? filtered.flatMap((session) => renderRows(session)) : null}
            </TableBody>
          </Table>
        </div>
        {emptyMessage == null ? null : (
          <p className="p-6 text-sm text-muted-foreground">{emptyMessage}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4 p-6 text-sm text-muted-foreground">
          <span>
            {sessionsCaption(
              query,
              filtered.length,
              sessions.length,
              listTotal,
              loading,
              includeArchived,
              displayedPage,
            )}
          </span>
          {showPagination ? (
            <nav aria-label="Sessions pagination" className="flex items-center gap-2">
              <Button
                aria-label={`Go to page ${Math.max(1, displayedPage - 1)}`}
                variant="outline"
                disabled={pageLoading || displayedPage <= 1}
                onClick={() => visit(sessionsPageHref(path, displayedPage - 1))}
                type="button"
              >
                <Icon name="chevronLeft" />
                Previous
              </Button>
              <span aria-live="polite">
                {pageLoading && page !== displayedPage
                  ? `Loading page ${formatInt(page)}…`
                  : pageCount == null
                    ? `Page ${formatInt(displayedPage)}`
                    : `Page ${formatInt(displayedPage)} of ${formatInt(pageCount)}`}
              </span>
              <Button
                aria-label={`Go to page ${displayedPage + 1}`}
                variant="outline"
                disabled={pageLoading || !hasNextPage}
                onClick={() => visit(sessionsPageHref(path, displayedPage + 1))}
                type="button"
              >
                Next
                <Icon name="chevronRight" />
              </Button>
            </nav>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

export function SessionTableSkeletonRows() {
  return SESSION_TABLE_SKELETON_KEYS.map((key) => (
    <TableRow key={key}>
      {Array.from({ length: 11 }, (_, index) => (
        <TableCell
          className={
            index >= 4 && index <= 6
              ? "hidden @min-[1448px]:table-cell"
              : index === 7
                ? "hidden @min-[1196px]:table-cell"
                : undefined
          }
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cells
          key={index}
        >
          <Skeleton className="h-4 w-16 animate-none" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

export function filterSessions(sessions: SessionSummary[], query: string): SessionSummary[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return sessions;
  }
  return sessions.filter((session) => sessionMatchesQuery(session, needle));
}

export function sessionMatchesQuery(session: SessionSummary, needle: string): boolean {
  return (
    [
      sessionDisplayTitle(session),
      displayModelLabel(session.model),
      session.reasoning_effort,
      ...(session.reasoning_effort_levels ?? []),
      session.tool,
      session.project_path,
      session.agent_type,
      session.agent_id,
    ]
      .filter((value): value is string => value != null)
      .some((value) => value.toLowerCase().includes(needle)) ||
    (session.subagents ?? []).some((subagent) => sessionMatchesQuery(subagent, needle))
  );
}

export function sessionsCaption(
  query: string,
  visible: number,
  loaded: number,
  total: number | null,
  loading: boolean,
  includeArchived: boolean,
  page: number,
): string {
  if (loading && loaded === 0 && query.trim() === "") {
    return `Loading page ${formatInt(page)}…`;
  }
  if (query.trim() !== "") {
    return `Showing ${formatInt(visible)} matching ${visible === 1 ? "row" : "rows"} on page ${formatInt(page)}`;
  }
  if (loaded === 0) {
    return total == null
      ? `No sessions${includeArchived ? ", including archived" : ""}`
      : `Showing 0 of ${formatInt(total)} sessions`;
  }
  const start = (page - 1) * SESSION_PAGE_SIZE + 1;
  const end = start + Math.max(0, loaded - 1);
  if (total == null) {
    return `Showing ${formatInt(start)}–${formatInt(end)} sessions${includeArchived ? ", including archived" : ""}`;
  }
  return `Showing ${formatInt(start)}–${formatInt(Math.min(end, total))} of ${formatInt(total)} sessions`;
}

export const SessionTableRow = memo(function SessionTableRow({
  depth,
  expanded,
  onToggle,
  session,
}: {
  depth: number;
  expanded: boolean;
  onToggle: (id: number) => void;
  session: SessionSummary;
}) {
  const isSubagent = depth > 0;
  const title = sessionDisplayTitle(session);
  const childCount = Math.max(session.subagent_count, session.subagents?.length ?? 0);
  const hasChildren = childCount > 0;
  const indentStyle = { paddingLeft: `${Math.max(0, Math.min(depth - 1, 5)) * 16}px` };
  return (
    <TableRow className={isSubagent ? "bg-muted/30" : undefined}>
      <TableCell>
        <span className="flex items-center gap-2">
          {hasChildren ? (
            <Button
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} subagents for ${title}`}
              variant="ghost"
              size="icon-xs"
              onClick={() => onToggle(session.id)}
              type="button"
            >
              <Icon name={expanded ? "minus" : "plus"} />
            </Button>
          ) : (
            <span className="size-6 shrink-0" />
          )}
          {isSubagent ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Icon name="cpu" />
              Subagent
            </span>
          ) : (
            <ToolBadge tool={session.tool} />
          )}
        </span>
      </TableCell>
      <TableCell className="max-w-80 truncate">
        <span className="flex flex-col gap-1" style={indentStyle}>
          <span className="flex items-center gap-2">
            <Link href={`/sessions/${session.id}`} title={title}>
              {title}
            </Link>
            {session.is_user_archived ? <Badge tone="neutral">Archived</Badge> : null}
          </span>
          {isSubagent ? (
            <small className="text-muted-foreground">{subagentDescriptor(session)}</small>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="max-w-48 truncate" title={session.project_path ?? ""}>
        {session.project_path == null ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <Link href={projectSessionsHref(session.project_path)} title={session.project_path}>
            {basename(session.project_path)}
          </Link>
        )}
      </TableCell>
      <TableCell>
        <ModelBadge model={session.model} />
      </TableCell>
      <TableCell className="hidden @min-[1448px]:table-cell">
        <ReasoningBadge
          effort={session.reasoning_effort}
          levels={session.reasoning_effort_levels}
          totalReasoningTokens={session.total_reasoning_tokens}
          reasoningSource={session.reasoning_source}
        />
      </TableCell>
      <TableCell className="hidden text-right tabular-nums @min-[1448px]:table-cell">
        <SessionContextPeak session={session} />
      </TableCell>
      <TableCell className="hidden text-right tabular-nums text-muted-foreground @min-[1448px]:table-cell">
        {formatInt(session.compaction_count)}
      </TableCell>
      <TableCell className="hidden text-right tabular-nums @min-[1196px]:table-cell">
        <SubagentRollup session={session} />
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {formatInt(session.message_count)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {sessionThreadUsageAvailable(session) ? (
          money(sessionThreadCost(session))
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        <SessionStartedAt value={session.started_at} />
      </TableCell>
    </TableRow>
  );
});

export function DosuProvenanceBadge({
  session,
}: {
  session: Pick<SessionSummary, "dosu_mcp_direct_calls" | "dosu_mcp_tree_calls">;
}) {
  if (session.dosu_mcp_tree_calls <= 0) {
    return null;
  }
  const evidence = {
    directCalls: session.dosu_mcp_direct_calls,
    treeCalls: session.dosu_mcp_tree_calls,
  };
  return (
    <Tooltip
      content={
        <div className="space-y-1">
          <strong>Optimized with Dosu</strong>
          <p>{dosuEvidenceSummary(evidence)}</p>
        </div>
      }
    >
      {(tooltipProps) => (
        <span
          {...tooltipProps}
          role="img"
          aria-label={dosuBadgeAriaLabel(evidence)}
          className="inline-flex size-6 items-center justify-center rounded-md border [&_img]:size-4"
        >
          <img alt="" src={dosuOfficialUrl} />
        </span>
      )}
    </Tooltip>
  );
}

export function SessionStartedAt({ value }: { value: string | null }) {
  const display = sessionListDate(value);
  if (display == null || value == null) {
    return <span>-</span>;
  }
  return (
    <time dateTime={value} title={fullDateTime(value) ?? display}>
      {display}
    </time>
  );
}

export function SessionContextPeak({ session }: { session: SessionSummary }) {
  const windowTokens = session.context_window_tokens;
  const peak = session.peak_context_tokens;
  const pct =
    windowTokens != null && windowTokens > 0 && peak != null && peak > 0
      ? Math.round((peak / windowTokens) * 100)
      : null;
  if (pct == null || pct === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <span
      className={pct >= 80 ? "font-medium text-destructive" : "text-muted-foreground"}
      title={`Peak context: ${compact(peak ?? 0)} of ${compact(windowTokens ?? 0)} window`}
    >
      {pct}%
    </span>
  );
}

export function SubagentRollup({ session }: { session: SessionSummary }) {
  const count = Math.max(session.subagent_count, session.subagents?.length ?? 0);
  if (count <= 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <span className="inline-flex flex-col" title={`${formatInt(count)} subagents`}>
      <span>{formatInt(count)}</span>
      {session.subagent_estimated_cost_usd > 0 ? (
        <small className="text-muted-foreground">
          +{money(session.subagent_estimated_cost_usd)}
        </small>
      ) : null}
    </span>
  );
}
