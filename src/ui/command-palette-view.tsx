import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { getJson } from "./api.ts";
import { buildCommandPaletteGroups, type CommandPaletteItem } from "./command-palette.ts";
import { fullDateTime } from "./date-time.ts";
import {
  createSessionSearchIndex,
  fetchSessionSearchIndex,
  type SessionHighlightRange,
  type SessionHighlights,
  type SessionSearchIndex,
  type SessionSearchIndexRow,
} from "./fuzzy.ts";
import { Icon } from "./icons.tsx";
import { locationPath } from "./link.tsx";
import { navItems } from "./nav-items.ts";
import { readRecentSearches, rememberSearch } from "./recent-searches.ts";
import { searchRouteHref } from "./search-request.ts";
import { stripMarkupTags } from "./session-title.ts";
import type { IconName } from "./types.ts";

export type PaletteItemKind = "recent" | "session" | "page" | "action" | "content-search";

export interface PaletteItem extends CommandPaletteItem {
  activate: () => void;
  detail?: string;
  highlights?: SessionHighlights;
  icon: IconName;
  kind: PaletteItemKind;
  row?: SessionSearchIndexRow;
}

export function CommandPalette({
  open,
  refreshKey,
  ...dialogProps
}: {
  analyticsReportHref: string;
  onClose: () => void;
  onNavigate: (href: string) => void;
  onRunSync: () => void;
  onToggleTheme: () => void;
  open: boolean;
  refreshKey: number;
  syncing: boolean;
}) {
  const [rows, setRows] = useState<SessionSearchIndexRow[]>([]);
  const [loadedRefreshKey, setLoadedRefreshKey] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [indexError, setIndexError] = useState<unknown>(null);

  useEffect(() => {
    if (!open || loadedRefreshKey === refreshKey) {
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setIndexError(null);
    void fetchSessionSearchIndex((offset, limit) =>
      getJson<SessionSearchIndexRow[]>(
        `/api/sessions/search-index?limit=${limit}&offset=${offset}`,
        { signal: controller.signal },
      ),
    )
      .then((nextRows) => {
        if (controller.signal.aborted) {
          return;
        }
        setRows(nextRows.map((row) => ({ ...row, title: row.title == null ? null : stripMarkupTags(row.title) })));
        setLoadedRefreshKey(refreshKey);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setIndexError(error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [loadedRefreshKey, open, refreshKey]);

  const fuzzyIndex: SessionSearchIndex = useMemo(() => createSessionSearchIndex(rows), [rows]);

  return open ? (
    <CommandPaletteDialog
      {...dialogProps}
      fuzzyIndex={fuzzyIndex}
      indexError={indexError}
      loading={loading}
      rows={rows}
    />
  ) : null;
}

export function CommandPaletteDialog({
  analyticsReportHref,
  fuzzyIndex,
  indexError,
  loading,
  onClose,
  onNavigate,
  onRunSync,
  onToggleTheme,
  rows,
  syncing,
}: {
  analyticsReportHref: string;
  fuzzyIndex: SessionSearchIndex;
  indexError: unknown;
  loading: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
  onRunSync: () => void;
  onToggleTheme: () => void;
  rows: SessionSearchIndexRow[];
  syncing: boolean;
}) {
  const [query, setQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches);
  const requestClose = onClose;
  const normalizedQuery = query.trim();
  const matches = useMemo(
    () => (normalizedQuery === "" ? [] : fuzzyIndex.search(normalizedQuery, 10)),
    [fuzzyIndex, normalizedQuery],
  );
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const recentItems: PaletteItem[] = recentSearches.map((recent) => ({
    id: `recent:${recent}`,
    label: recent,
    detail: "Search transcript content",
    icon: "clock",
    kind: "recent",
    activate: () => {
      rememberSearch(recent);
      onNavigate(searchRouteHref(recent, locationPath()));
    },
  }));
  const sessionMatches =
    normalizedQuery === ""
      ? rows.slice(0, 6).map((row) => ({ id: row.id, highlights: {} }))
      : matches;
  const sessionItems: PaletteItem[] = sessionMatches.flatMap((match) => {
    const row = rowById.get(match.id);
    if (row == null) {
      return [];
    }
    return [
      {
        id: `session:${row.id}`,
        label: row.title?.trim() || `Session ${row.id}`,
        detail: paletteSessionDetail(row),
        highlights: match.highlights,
        icon: "sessions",
        kind: "session",
        row,
        activate: () => onNavigate(`/sessions/${row.id}`),
      },
    ];
  });
  const pageItems: PaletteItem[] = navItems
    .filter((item) => commandPaletteTextMatches(normalizedQuery, item.label))
    .map((item) => ({
      id: `page:${item.key}`,
      label: item.label,
      detail: item.href,
      icon: item.icon,
      kind: "page",
      activate: () => onNavigate(item.href),
    }));
  const availableActions: PaletteItem[] = [
    ...(syncing
      ? []
      : [
          {
            id: "action:sync",
            label: "Run sync",
            detail: "Ingest changed local session logs",
            icon: "refresh" as const,
            kind: "action" as const,
            activate: onRunSync,
          },
        ]),
    {
      id: "action:theme",
      label: "Toggle theme",
      detail: "Cycle system, light, and dark",
      icon: "sun",
      kind: "action",
      activate: () => {
        onToggleTheme();
        requestClose();
      },
    },
    {
      id: "action:report",
      label: "Analytics report",
      detail: "Review and export the active date range",
      icon: "chart",
      kind: "action",
      activate: () => onNavigate(analyticsReportHref),
    },
    {
      id: "action:settings",
      label: "Settings",
      detail: "Agent, terminal, and editor preferences",
      icon: "settings",
      kind: "action",
      activate: () => onNavigate("/settings"),
    },
  ];
  const actionItems = availableActions.filter((item) =>
    commandPaletteTextMatches(normalizedQuery, `${item.label} ${item.detail ?? ""}`),
  );
  const contentSearch: PaletteItem | null =
    normalizedQuery === ""
      ? null
      : {
          id: "content-search",
          label: `Search transcript content for “${normalizedQuery}”`,
          detail: "Messages, tool calls, and results",
          icon: "search",
          kind: "content-search",
          activate: () => {
            const remembered = rememberSearch(normalizedQuery);
            setRecentSearches(remembered);
            onNavigate(searchRouteHref(normalizedQuery, locationPath()));
          },
        };
  const groups = buildCommandPaletteGroups({
    query,
    recent: recentItems,
    sessions: sessionItems,
    pages: pageItems,
    actions: actionItems,
    contentSearch,
  });
  const quickMatchCount = sessionItems.length + pageItems.length + actionItems.length;
  return (
    <CommandDialog open onOpenChange={(open) => { if (!open) requestClose(); }} title="Search and commands" description="Search sessions, pages, and commands">
      <Command shouldFilter={false} loop>
        <CommandInput aria-label="Search sessions and commands" placeholder="Search sessions or run a command…" value={query} onValueChange={setQuery} />
        <div aria-live="polite" className="px-4 text-sm text-muted-foreground">
          {loading && rows.length === 0 ? <p role="status">Loading session index…</p> : null}
          {indexError != null && rows.length === 0 ? <p role="status" className="text-destructive">Session shortcuts are unavailable. Pages and actions still work.</p> : null}
          {normalizedQuery !== "" && quickMatchCount === 0 && !loading && indexError == null ? <p>No quick matches. Try transcript search below.</p> : null}
        </div>
        <CommandList className="max-h-[60vh]">
          {groups.map((group) => (
            <CommandGroup key={group.id} heading={group.label ?? "Transcript search"}>
              {group.items.map((item) => (
                <CommandItem key={item.id} value={item.id} onSelect={() => item.activate()} className="gap-3">
                  <Icon name={item.icon} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <strong className="truncate font-medium"><PaletteHighlightedText ranges={item.highlights?.title} text={item.label} /></strong>
                    {item.kind === "session" && item.row != null ? <span className="truncate text-xs text-muted-foreground"><PaletteSessionMeta highlights={item.highlights} row={item.row} /></span> : item.detail == null ? null : <span className="text-xs text-muted-foreground">{item.detail}</span>}
                  </span>
                  {item.kind === "session" && item.row?.started_at != null ? (
                    <time className="text-xs text-muted-foreground" dateTime={item.row.started_at} title={fullDateTime(item.row.started_at) ?? item.row.started_at}>
                      <PaletteHighlightedText ranges={item.highlights?.started_at} text={item.row.started_at.slice(0, 10)} />
                    </time>
                  ) : item.kind === "content-search" ? <kbd>↵</kbd> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
        <footer className="flex gap-4 border-t px-4 py-3 text-xs text-muted-foreground">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </footer>
      </Command>
    </CommandDialog>
  );
}

export function commandPaletteTextMatches(query: string, text: string): boolean {
  if (query === "") {
    return true;
  }
  const lower = text.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((term) => lower.includes(term));
}

export function paletteSessionDetail(row: SessionSearchIndexRow): string {
  return [row.project, row.tool, row.model]
    .filter((value) => value != null && value !== "")
    .join(" · ");
}

export function PaletteSessionMeta({
  highlights,
  row,
}: {
  highlights: SessionHighlights | undefined;
  row: SessionSearchIndexRow;
}) {
  const values = [
    { field: "project" as const, value: row.project },
    { field: "tool" as const, value: row.tool },
    { field: "model" as const, value: row.model },
  ].filter(
    (entry): entry is { field: "project" | "tool" | "model"; value: string } =>
      entry.value != null && entry.value !== "",
  );
  return (
    <span>
      {values.map((entry, index) => (
        <span key={entry.field}>
          {index > 0 ? " · " : null}
          <PaletteHighlightedText ranges={highlights?.[entry.field]} text={entry.value} />
        </span>
      ))}
    </span>
  );
}

export function PaletteHighlightedText({
  ranges,
  text,
}: {
  ranges: readonly SessionHighlightRange[] | undefined;
  text: string;
}) {
  if (ranges == null || ranges.length === 0) {
    return text;
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    const [start, end] = range;
    if (start > cursor) {
      parts.push(<span key={`text-${index}`}>{text.slice(cursor, start)}</span>);
    }
    parts.push(<mark key={`match-${index}`}>{text.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push(<span key="text-tail">{text.slice(cursor)}</span>);
  }
  return <>{parts}</>;
}
