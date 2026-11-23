import { describe, expect, test } from "bun:test";
import { readUiFile, readUiSource, sourceBetween, sourceFrom } from "./ui-source.ts";

const main = readUiSource();

describe("UI interaction contracts", () => {
  test("opens the command dialog from desktop, mobile, and keyboard shortcuts", () => {
    const app = sourceBetween(main, "function App()", "function renderView(");
    const palette = readUiFile("command-palette-view.tsx");
    const command = readUiFile("components/ui/command.tsx");
    expect(app).toContain("shouldOpenCommandPalette({");
    expect(app).toContain("setCommandPaletteOpen(true)");
    expect(app).toContain('aria-label="Open command palette"');
    expect(app).toContain('aria-label="Search"');
    expect(palette).toMatch(/<CommandDialog\s+open/);
    expect(palette).toContain("<Command shouldFilter={false} loop>");
    expect(palette).toContain('aria-label="Search sessions and commands"');
    expect(palette).toContain("onSelect={() => item.activate()}");
    expect(command).toContain("CommandPrimitive");
    expect(palette).toMatch(/<kbd>↓<\/kbd> navigate\s*<\/span>/);
  });

  test("exposes tool-call details through a keyboard-accessible inspect button", () => {
    const tools = readUiFile("views/tools.tsx");
    expect(tools).toMatch(/<button\s+aria-label=\{`Inspect \$\{call\.tool_name/);
    expect(tools).toContain('type="button"');
    expect(tools).toContain('role="dialog"');
    expect(tools).toContain('aria-modal="true"');
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
});
