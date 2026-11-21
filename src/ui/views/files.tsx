import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { getJson } from "../api.ts";
import { ApiFailureState } from "../api-failure.tsx";
import { EmptyState } from "../common.tsx";
import { TABLE_ROW_LIMIT } from "../constants.ts";
import { dateRangeQuery, withDateQuery } from "../date-range.ts";
import { DateRangeControl } from "../date-range-control.tsx";
import { relativeTime } from "../date-time.ts";
import { basename, capitalize, formatInt } from "../format.ts";
import { Link } from "../link.tsx";
import { projectSessionsHref } from "../navigation.ts";
import {
  type FileSortKey,
  fileSortValue,
  fileTotal,
  nextSort,
  SortableHeader,
  type SortState,
  sortRows,
} from "../sorting.tsx";
import type { DateBounds, DateRangeSelection, FileRow } from "../types.ts";

export function FilesView({
  dateBounds,
  dateRange,
  onDateRangeChange,
  reloadKey,
}: {
  dateBounds: DateBounds | null;
  dateRange: DateRangeSelection;
  onDateRangeChange: (range: DateRangeSelection) => void;
  reloadKey: number;
}) {
  const [group, setGroup] = useState<"path" | "ext">("path");
  const [op, setOp] = useState<"read" | "edit" | "write" | "delete" | null>(null);
  const [fileRows, setFileRows] = useState<FileRow[]>([]);
  const [fileError, setFileError] = useState<unknown>(null);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesRetryKey, setFilesRetryKey] = useState(0);
  const [fileSort, setFileSort] = useState<SortState<FileSortKey>>({
    key: "total",
    direction: "desc",
  });
  const sortedFileRows = useMemo(
    () => sortRows(fileRows, fileSort, fileSortValue),
    [fileRows, fileSort],
  );

  useEffect(() => {
    void filesRetryKey;
    void reloadKey;
    const controller = new AbortController();
    const opParam = op == null ? "" : `&op=${op}`;
    setFileError(null);
    setFilesLoading(true);
    void getJson<FileRow[]>(
      withDateQuery(
        `/api/files?group=${group}&limit=${TABLE_ROW_LIMIT}${opParam}`,
        dateRangeQuery(dateRange),
      ),
      { signal: controller.signal },
    )
      .then(setFileRows)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setFileError(reason);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setFilesLoading(false);
        }
      });
    return () => controller.abort();
  }, [dateRange, filesRetryKey, group, op, reloadKey]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">File hotspots</h1>
          <p className="text-sm text-muted-foreground">
            What agents touch most. Heavy re-reads with few edits are AGENTS.md / skill candidates;
            heavy edits are churn.
          </p>
        </div>
        <DateRangeControl bounds={dateBounds} range={dateRange} onChange={onDateRangeChange} />
      </header>

      <div className="flex flex-wrap gap-4">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="text-sm text-muted-foreground">Group by</legend>
          <Button
            variant={group === "path" ? "secondary" : "outline"}
            aria-pressed={group === "path"}
            onClick={() => setGroup("path")}
            type="button"
          >
            Files
          </Button>
          <Button
            variant={group === "ext" ? "secondary" : "outline"}
            aria-pressed={group === "ext"}
            onClick={() => setGroup("ext")}
            type="button"
          >
            Languages
          </Button>
        </fieldset>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="text-sm text-muted-foreground">Operation</legend>
          <Button
            variant={op == null ? "secondary" : "outline"}
            aria-pressed={op == null}
            onClick={() => setOp(null)}
            type="button"
          >
            All ops
          </Button>
          {(["read", "edit", "write", "delete"] as const).map((name) => (
            <Button
              variant={op === name ? "secondary" : "outline"}
              aria-pressed={op === name}
              key={name}
              onClick={() => setOp(name)}
              type="button"
            >
              {capitalize(name)}
            </Button>
          ))}
        </fieldset>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{group === "ext" ? "Languages" : "Hotspots"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Per-operation counts from tool-call evidence, ordered by activity
          </p>
        </CardHeader>
        {fileError != null ? (
          <ApiFailureState error={fileError} onRetry={() => setFilesRetryKey((key) => key + 1)} />
        ) : filesLoading && fileRows.length === 0 ? (
          <div className="px-6 text-sm text-muted-foreground">Loading file activity…</div>
        ) : fileRows.length === 0 ? (
          <EmptyState
            icon="file"
            message="Hotspots appear once your session logs contain file activity."
            title="No file activity"
          />
        ) : (
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader
                      label={group === "ext" ? "Extension" : "File"}
                      onSort={(key) => setFileSort((sort) => nextSort(sort, key))}
                      sort={fileSort}
                      sortKey="key"
                    />
                    {group === "path" ? (
                      <SortableHeader
                        label="Project"
                        onSort={(key) => setFileSort((sort) => nextSort(sort, key))}
                        sort={fileSort}
                        sortKey="project"
                      />
                    ) : null}
                    <SortableHeader
                      align="right"
                      label="Reads"
                      onSort={(key) => setFileSort((sort) => nextSort(sort, key))}
                      sort={fileSort}
                      sortKey="reads"
                    />
                    <SortableHeader
                      align="right"
                      label="Edits"
                      onSort={(key) => setFileSort((sort) => nextSort(sort, key))}
                      sort={fileSort}
                      sortKey="edits"
                    />
                    <SortableHeader
                      align="right"
                      label="Writes"
                      onSort={(key) => setFileSort((sort) => nextSort(sort, key))}
                      sort={fileSort}
                      sortKey="writes"
                    />
                    <SortableHeader
                      align="right"
                      label="Deletes"
                      onSort={(key) => setFileSort((sort) => nextSort(sort, key))}
                      sort={fileSort}
                      sortKey="deletes"
                    />
                    <SortableHeader
                      align="right"
                      label="Sessions"
                      onSort={(key) => setFileSort((sort) => nextSort(sort, key))}
                      sort={fileSort}
                      sortKey="sessions"
                    />
                    <SortableHeader
                      align="right"
                      label="Total"
                      onSort={(key) => setFileSort((sort) => nextSort(sort, key))}
                      sort={fileSort}
                      sortKey="total"
                    />
                    <SortableHeader
                      align="right"
                      label="Modified"
                      onSort={(key) => setFileSort((sort) => nextSort(sort, key))}
                      sort={fileSort}
                      sortKey="last_touched_at"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFileRows.map((row) => (
                    <TableRow key={`${group}-${row.project ?? ""}-${row.key}`}>
                      <TableCell className="max-w-xs truncate font-mono">
                        <Link href={`/search?q=${encodeURIComponent(`"${row.key}"`)}`}>
                          {row.key}
                        </Link>
                      </TableCell>
                      {group === "path" ? (
                        <TableCell className="text-muted-foreground" title={row.project ?? ""}>
                          {row.project == null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <Link href={projectSessionsHref(row.project)}>
                              {basename(row.project)}
                            </Link>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatInt(row.reads)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatInt(row.edits)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatInt(row.writes)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatInt(row.deletes)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatInt(row.sessions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatInt(fileTotal(row))}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {relativeTime(row.last_touched_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
