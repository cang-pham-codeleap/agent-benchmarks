import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { contextStripKeyIndex } from "../src/ui/context-window-strip.tsx";
import { ALL_DATE_RANGE, checkCustomRange, REVERSED_RANGE_MESSAGE } from "../src/ui/date-range.ts";
import { DateRangeControl } from "../src/ui/date-range-control.tsx";
import { readUiFile, readUiSource, sourceBetween, sourceFrom } from "./ui-source.ts";

const main = readUiSource();

describe("UI interaction contracts", () => {
  test("aborts and ignores stale load-more search responses", () => {
    const search = sourceBetween(main, "function SearchView(", "function groupSearchHits(");

    expect(search).toContain("loadMoreControllerRef.current?.abort()");
    expect(search).toContain("signal: controller.signal");
    expect(search).toContain("searchEpochRef.current !== epoch");
    expect(search).toContain("loadMoreControllerRef.current === controller");
  });

  test("does not activate stale search results and exposes arrow selection to assistive tech", () => {
    const search = sourceBetween(main, "function SearchView(", "function groupSearchHits(");

    expect(search).toContain("resultsQueryRef.current = null");
    expect(search).toContain("setHits([])");
    expect(search).toContain("resultsQueryRef.current === query.trim()");
    expect(search).toContain('role="combobox"');
    expect(search).toContain('role="listbox"');
    expect(search).toContain('role="option"');
    expect(search).toContain("aria-activedescendant={activeHitId}");
    expect(search).toContain("aria-selected={index === activeIndex}");
  });

  test("keeps fast transcript search scoped and settles totals without replacing results", () => {
    const search = sourceBetween(main, "function SearchView(", "function groupSearchHits(");
    const fastRequest = search.slice(
      search.indexOf("include_total: false"),
      search.indexOf("include_total: true"),
    );

    expect(search).toContain("searchRequestScope(path, { from: rangeFrom, to: rangeTo })");
    expect(search).toContain("include_total: false");
    expect(search).toContain("include_total: true");
    expect(search).toContain("setTotal(response.total)");
    expect(fastRequest).not.toContain("setTotal(response.total)");
    expect(fastRequest).not.toContain("setTotalIsCapped(response.total_is_capped)");
    const totalRequest = search.slice(
      search.indexOf("include_total: true"),
      search.indexOf("}, 500);"),
    );
    expect(totalRequest).toContain(".catch(() => {})");
    expect(totalRequest).not.toContain("setError");
    expect(search).toContain("searchPageMayHaveMore");
    expect(search).toContain("total: totalRef.current");
    expect(search).toContain("exactSearchRemaining(total, hits.length, totalIsCapped)");
    expect(search).not.toContain("total == null || hits.length >= total");
  });

  test("opens the command dialog from desktop, mobile, and keyboard shortcuts", () => {
    const app = sourceBetween(main, "function App()", "function renderView(");
    const palette = readUiFile("command-palette-view.tsx");
    const command = readUiFile("components/ui/command.tsx");
    expect(app).toContain("shouldOpenCommandPalette({");
    expect(app).toContain("setCommandPaletteOpen(true)");
    expect(app).toContain('aria-label="Open command palette"');
    expect(app).toContain('aria-label="Search"');
    expect(palette).toContain("<CommandDialog open");
    expect(palette).toContain("<Command shouldFilter={false} loop>");
    expect(palette).toContain('aria-label="Search sessions and commands"');
    expect(palette).toContain("onSelect={() => item.activate()}");
    expect(command).toContain("CommandPrimitive");
    expect(palette).toContain("navigate</span>");
  });

  test("exposes tool-call details through a keyboard-accessible inspect button", () => {
    const tools = readUiFile("views/tools.tsx");
    expect(tools).toMatch(/<button\s+aria-label=\{`Inspect \$\{call\.tool_name/);
    expect(tools).toContain('type="button"');
    expect(tools).toContain('role="dialog"');
    expect(tools).toContain('aria-modal="true"');
  });

  test("report and share privacy reviews use dialogs", () => {
    for (const file of ["report-export.tsx", "share-chart.tsx"]) {
      const source = readUiFile(file);
      expect(source).toContain("<Dialog open={open}");
      expect(source).toContain("<DialogContent");
      expect(source).toContain("<DialogTitle>");
      expect(source).toContain("<PrivacyReviewLists");
    }
  });

  test("keeps compaction anchors exposed in the accessibility tree", () => {
    const chart = sourceBetween(
      main,
      "function ContextWindowStrip(",
      "function compactionTokenRange(",
    );

    expect(chart).not.toContain('role="img"');
    expect(chart).toContain("Compactions ");
    expect(chart).toContain(" through ");
    expect(chart).toContain("href={`#message-");
  });

  test("gives keyboard users the context strip's click-to-jump", () => {
    const chart = sourceBetween(
      main,
      "function ContextWindowStrip(",
      "function compactionTokenRange(",
    );

    expect(chart).toContain('aria-label={`Context window usage across');
    expect(chart).toContain("void onJump(scrubPoint.seq)");
    expect(chart).toContain("onKeyDown={handleKeyDown}");
    expect(contextStripKeyIndex("ArrowRight", null, 4)).toBe(0);
    expect(contextStripKeyIndex("ArrowRight", 2, 4)).toBe(3);
    expect(contextStripKeyIndex("ArrowRight", 3, 4)).toBe(3);
    expect(contextStripKeyIndex("ArrowLeft", null, 4)).toBe(3);
    expect(contextStripKeyIndex("ArrowLeft", 0, 4)).toBe(0);
    expect(contextStripKeyIndex("Home", 2, 4)).toBe(0);
    expect(contextStripKeyIndex("End", 0, 4)).toBe(3);
    expect(contextStripKeyIndex("Enter", 1, 4)).toBeNull();
    expect(contextStripKeyIndex("ArrowRight", null, 0)).toBeNull();
  });

  test("keeps archive visibility in session pagination and navigation state", () => {
    const app = sourceBetween(main, "function App()", "function renderView(");
    const render = sourceBetween(main, "function renderView(", "function NotFoundView(");
    const sessions = sourceBetween(
      main,
      "function SessionsView(",
      "function SessionTableSkeletonRows(",
    );
    const row = sourceBetween(main, "function SessionTableRow(", "function DosuProvenanceBadge(");

    expect(app).toContain("useSessionPage({");
    expect(app).toContain("includeArchivedSessions");
    expect(app).toContain("reloadKey");
    expect(app).toContain("reloadKey,");
    expect(render).toContain("reloadKey={actions.reloadKey}");
    expect(main).toContain('"&include_archived=true"');
    expect(app).toContain("sessionPageState,");
    expect(main).toContain("sessionPageExhausted({");
    expect(sessions).toContain("scopedSessionSummaryKey(scopedSummaryRequest, reloadKey)");
    expect(sessions).toContain("<span>Show archived</span>");
    expect(sessions).toContain("sessionsArchivedHref(path, checked === true)");
    expect(row).toContain('session.is_user_archived ? <Badge tone="neutral">Archived</Badge>');
  });

  test("keeps the shell summary archive-wide while scoped session cards reload independently", () => {
    const loaders = sourceBetween(main, "const SLICE_LOADERS:", "const SHELL_SLICES:");
    const summaryStart = loaders.indexOf("  summary: {");
    const summaryEnd = loaders.indexOf("  byModel: {", summaryStart);
    expect(summaryStart).toBeGreaterThanOrEqual(0);
    expect(summaryEnd).toBeGreaterThan(summaryStart);
    const summaryLoader = loaders.slice(summaryStart, summaryEnd);

    expect(summaryLoader).toContain('withDateQuery("/api/stats/summary", q)');
    expect(summaryLoader).not.toContain("project");
    expect(summaryLoader).not.toContain("include_archived");
    expect(summaryLoader).not.toContain("sessionSummaryPath");
  });

  test("uses one compact date-range control across every date-scoped view", () => {
    const app = sourceBetween(main, "function App()", "function renderView(");
    const sessions = sourceFrom(readUiFile("views/sessions.tsx"), "function SessionsView(");
    const analytics = sourceFrom(readUiFile("views/analytics.tsx"), "function AnalyticsView(");
    const tools = sourceFrom(readUiFile("views/tools.tsx"), "function ToolsView(");
    const files = sourceFrom(readUiFile("views/files.tsx"), "function FilesView(");
    const control = sourceFrom(readUiFile("date-range-control.tsx"), "function DateRangeControl(");

    expect(app).toContain("SLICE_LOADERS[slice].load(dashboardQuery)");
    for (const view of [sessions, analytics, tools, files]) {
      expect(view).toContain("<DateRangeControl");
    }
    expect(analytics).toContain("sourceScopeQuery(dateRangeQuery(dateRange), source)");
    expect(control).toContain('<Icon name="clock" />');
    expect(control).toContain('<Icon name="chevronDown" />');
    expect(control.match(/<span>Custom range<\/span>/g)).toHaveLength(1);
    expect(control).not.toContain('choosePreset("custom")');
    expect(control).not.toContain('name="chevronLeft"');
    expect(control).not.toContain('name="chevronRight"');
  });

  test("provides labelled date inputs in a popover and announces reversed ranges", () => {
    const control = readUiFile("date-range-control.tsx");
    const markup = renderToStaticMarkup(createElement(DateRangeControl, {
      bounds: null, onChange: () => {}, range: ALL_DATE_RANGE,
    }));
    expect(markup).toContain('aria-label="Time range: All time"');
    expect(control).toContain("<Popover open={open}");
    expect(control).toContain("<PopoverContent");
    expect(control).toContain('aria-label="From date"');
    expect(control).toContain('aria-label="To date"');
    expect(control).toContain('aria-live="polite"');
    expect(control).toContain("{REVERSED_RANGE_MESSAGE}");
    expect(checkCustomRange("2026-10-23", "2026-10-01").status).toBe("reversed");
    expect(REVERSED_RANGE_MESSAGE.length).toBeGreaterThan(0);
  });

  test("keeps a Today selection on the current UTC date while the app stays open", () => {
    const app = sourceBetween(main, "function App()", "function renderView(");
    expect(app).toContain(
      'useTodayRollover(dateRangeSelection.preset === "today", setDateRangeSelection)',
    );
    const hook = sourceFrom(readUiFile("date-range-control.tsx"), "function useTodayRollover(");
    expect(hook).toContain("scheduleUtcDayRollover(refresh)");
    expect(hook).toContain('document.addEventListener("visibilitychange", refreshWhenVisible)');
    expect(hook).toContain('document.removeEventListener("visibilitychange", refreshWhenVisible)');
    expect(hook).toContain("stop();");
  });

  test("applies one Analytics source scope to every rendered aggregate and report", () => {
    const app = sourceBetween(readUiFile("main.tsx"), "function App()", "function renderView(");
    const analytics = sourceBetween(
      readUiFile("views/analytics.tsx"),
      "function AnalyticsView(",
      "function ActivityPanel(",
    );
    const slices = readUiFile("data-slices.ts");
    const routes = sourceBetween(slices, "const ROUTE_SLICES:", "function slicesForView(");
    const shell = sourceBetween(slices, "const SHELL_SLICES:", "const ROUTE_SLICES:");

    expect(app).toContain(
      'activeView === "analytics" ? sourceScopeQuery(dateQuery, sourceSelection) : dateQuery',
    );
    expect(app).toContain("SLICE_LOADERS[slice].load(dashboardQuery)");
    expect(shell).toContain('"summary"');
    for (const slice of [
      "sessionSources",
      "byDay",
      "byModel",
      "byRepo",
      "byOutcome",
      "previousSummary",
      "activity",
      "modelSparklines",
      "tokenEconomics",
    ]) {
      expect(routes).toContain(`"${slice}"`);
    }
    expect(analytics).toContain("sourceScopeQuery(dateRangeQuery(dateRange), source)");
    expect(analytics).toContain('withDateQuery("/api/reports/analytics.html", analyticsQuery)');
    expect(analytics).toContain('withDateQuery("/reports/analytics", analyticsQuery)');
  });

  test("exposes session state actions through the shared accessible overflow menu", () => {
    const overflow = sourceFrom(readUiFile("common.tsx"), "function OverflowMenu(");
    const session = sourceBetween(
      main,
      "function SessionDetailView(",
      "function SessionDetailSkeleton(",
    );

    expect(overflow).toContain("event.currentTarget.open = false");
    expect(overflow).toContain('event.key !== "Escape"');
    expect(overflow).toContain("aria-label={label}");
    expect(overflow).toContain('querySelector("summary")?.focus()');
    expect(session).toContain("archiveActionFor(detail.summary)");
    expect(session).toContain("Archive session");
    expect(session).toContain("Unarchive session");
    expect(session).toContain("Delete session");
    expect(session).not.toContain("Delete session…");
    expect(session).toContain("sessionStateRequest(id, state)");
    expect(session).toContain("sessionStateMutationGenerationRef.current !== mutationGeneration");
  });

  test("requires a focus-managed explicit confirmation before archive deletion", () => {
    const dialog = sourceBetween(
      main,
      "function DeleteSessionDialog(",
      "function SessionDetailView(",
    );

    expect(dialog).toContain("useDialogFocusTrap(open, dialogRef, requestClose)");
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('role="alertdialog"');
    expect(dialog).toContain("aria-labelledby={titleId}");
    expect(dialog).toContain("aria-describedby={descriptionId}");
    expect(dialog).toContain("useBackdropDismiss(open && !pending, backdropRef, requestClose)");
    expect(dialog).toContain("DELETE_SESSION_EXPLANATION");
    expect(dialog).toContain("DELETE_SESSION_EYEBROW");
    expect(dialog).toContain("Delete from Decant");
    expect(main).toContain("dialog.focus()");
  });
});
