import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UI_ROUTE_PATHS } from "../src/route-paths.ts";
import { ReportRouteExportActions } from "../src/ui/report-export.tsx";
import { readUiFile, readUiSource, sourceFrom } from "./ui-source.ts";

const main = readUiSource();
const server = readFileSync(join(import.meta.dir, "..", "src", "server", "sync.ts"), "utf8");

describe("coded UI recovery", () => {
  test("keeps sync failures inline and retries the sync operation", () => {
    expect(main).toContain("const [syncError, setSyncError]");
    expect(main).toContain("setSyncError(err)");
    expect(main).toContain("<ApiFailureState error={syncError} onRetry={runSync} />");
    expect(main).toContain("setLiveConnectionKey((key) => key + 1)");
    expect(main).toContain("Reconnect");
  });

  test("keeps successful dashboard slices visible when a sibling request fails", () => {
    expect(main).toContain("loadSlicesIndependently");
    expect(readUiFile("slice-loading.ts")).toContain("Promise.allSettled");
    expect(main).not.toContain("Promise.all(missing.map");
    expect(main).toContain("collectSliceResults");
    expect(main).toContain("const [failedSlices, setFailedSlices]");
    expect(main).toContain(
      "Some dashboard data could not be loaded. Available data is still shown.",
    );
    expect(main).toContain("activeFailedSlices.join");
    expect(main).toContain("slicesForView(activeView).includes(slice)");
    expect(main).toContain(
      "const relevantFailures = failedSlicesRef.current.filter((slice) => needed.includes(slice))",
    );
    expect(main).toContain("failed: { error: unknown; requestKey: string } | null");
    expect(main).toContain('activeView === "sessions" && sessionFailure === "replace"');
    expect(main).toContain("The session list could not be refreshed.");
  });

  test("refreshes failed slices on reconnect without replacing healthy data", () => {
    expect(main).toContain("const liveDroppedRef = useRef(false)");
    expect(main).toContain("const failedSlicesRef = useRef<DataSlice[]>([])");
    expect(main).toContain("failedSlicesRef.current = failures");
    expect(main).toMatch(
      /if \(liveDroppedRef\.current\) \{\s*liveDroppedRef\.current = false;\s*if \(failedSlicesRef\.current\.length > 0\) \{\s*requestRefresh\(\);\s*\} else \{\s*setArchiveUpdateAvailable\(true\);/,
    );
    expect(main).toContain("liveDroppedRef.current = true");
    expect(main).toMatch(
      /if \(events\.readyState !== EventSource\.OPEN\) \{\s*setLiveDisconnected\(true\);\s*setLiveConnectionKey\(\(key\) => key \+ 1\);/,
    );
  });

  test("preserves the archive update reason in server events", () => {
    expect(server).toMatch(/type: "archive_updated",\s*reason: "manual"/);
    expect(server).toMatch(/type: "archive_updated",\s*reason: event\.reason/);
  });

  test("adds recovery actions to empty Projects and Analytics states", () => {
    expect(readUiFile("views/projects.tsx")).toMatch(/function ProjectsView[\s\S]*?Sync now/);
    expect(readUiFile("views/analytics.tsx")).toMatch(
      /function DailyPanel[\s\S]*?All time[\s\S]*?title="No data in range"/,
    );
  });

  test("file filters catch rejected requests and offer a retry", () => {
    const filesView = sourceFrom(readUiFile("views/files.tsx"), "function FilesView(");
    expect(filesView).toContain(".catch((reason: unknown)");
    expect(filesView).toContain("<ApiFailureState");
    expect(filesView).toContain("setFilesRetryKey");
  });
});

describe("ingest diagnostics", () => {
  test("only actionable dropped lines produce a session-header badge", () => {
    expect(main).toContain("{detail.summary.ingest_issue_count > 0 ? (");
    expect(main).not.toContain(
      "detail.summary.ingest_issue_count > 0 ||\n            detail.summary.informational_ingest_issue_count > 0",
    );
    expect(main).toContain('label="Re-sync"');
    expect(main).toContain("onRetry={() => setIssuesError(null)}");
  });
});

describe("report preview routes", () => {
  test("provide the requested local preview toolbar", () => {
    expect(main).toContain('pathOnly(path) === "/reports/analytics"');
    expect(main).toContain("/reports/session/");
    const toolbar = renderToStaticMarkup(
      createElement(ReportRouteExportActions, {
        downloadHref: "/report.html",
        excluded: [],
        includes: [],
        onPrint: () => {},
        printDisabled: false,
        title: "Analytics report",
      }),
    );
    expect(toolbar).toMatch(/<button[^>]*>[\s\S]*?Download HTML<\/button>/);
    expect(toolbar).toMatch(/<button[^>]*>[\s\S]*?Save as PDF<\/button>/);
    expect(readUiFile("report-export.tsx")).toContain("View report");
    expect(main).toContain("srcDoc={documentHtml}");
    expect(main).toContain(
      'sandbox="allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox"',
    );
    expect(main).toContain("first user-prompt preview (up to 180 characters)");
    expect(main).toContain("Transcript messages beyond the disclosed prompt preview");
    expect(UI_ROUTE_PATHS).toContain("/reports/analytics");
    expect(UI_ROUTE_PATHS).toContain("/reports/session/{id}");
  });
});

describe("transcript presentation", () => {
  test("uses the same compaction numbering in the chart and thread", () => {
    expect(main).toContain("compactionNumberBySeq");
    expect(main).toMatch(/Compaction \$\{compactionNumber\}/);
    expect(main).toContain("href={`#message-${compaction.seq}`}");
    expect(main).toContain("groupContextMarkers");
  });
});
