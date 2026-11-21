import { describe, expect, test } from "bun:test";
import { readUiFile, readUiSource, sourceBetween, sourceFrom } from "./ui-source.ts";

const main = readUiSource();

describe("Tools and MCP presentation", () => {
  test("archive refreshes reload call rows and both summary request paths", () => {
    const tools = sourceFrom(readUiFile("views/tools.tsx"), "function ToolsView(");
    expect(readUiFile("main.tsx")).toContain("reloadKey={actions.reloadKey}");
    expect(tools).toContain("[callQuery, locationFilters.offset, reloadKey, summaryScopeKey]");
    expect(tools).toContain(
      "[laterCallPage, reloadKey, summaryNeedsRefresh, summaryQuery, summaryScopeKey]",
    );
    expect(tools).toContain("toolSummaryNeedsRefresh(savedSummary, summaryScopeKey, reloadKey)");
  });

  test("an elided value says so instead of appearing unformatted", () => {
    const detail = sourceBetween(main, "function ToolValueElision(", "function ToolCallStatus(");
    expect(detail).toContain("previewOmittedCount");
    expect(detail).toContain("Middle elided");
    const panel = sourceBetween(main, "function ToolCallDetail(", "function ToolsView(");
    expect(panel).toContain("<ToolValueElision value={call.input_preview} />");
    expect(panel).toContain("<ToolValueElision value={call.output_preview} />");
  });

  test("renders accessible icon-and-text statuses in the table and detail dialog", () => {
    const status = sourceBetween(main, "function ToolCallStatus(", "function DrilldownTableRow(");
    const detail = sourceBetween(main, "function ToolCallDetail(", "function ToolsView(");
    const tools = sourceFrom(readUiFile("views/tools.tsx"), "function ToolsView(");

    expect(status).toContain("toolCallStatus(call.is_error, call.has_result)");
    expect(status).toContain("<Badge");
    expect(status).toContain("<Icon name={status.icon} />");
    expect(status).toContain("{status.label}");
    expect(status).toContain("<Tooltip content={status.title}>");
    expect(status).toContain("{(tooltipProps) =>");
    expect(status).toContain('<span className="sr-only">{status.title}</span>');
    expect(status).not.toContain("title={status.title ?? undefined}");
    expect(detail).toContain("<ToolCallStatus call={call} />");
    expect(tools).toContain("<ToolCallStatus call={call} />");
  });

  test("keeps tool and MCP drilldowns independent from stale call filters", () => {
    const tools = sourceFrom(readUiFile("views/tools.tsx"), "function ToolsView(");

    expect(tools).toContain("const clearedCallFilters = clearToolCallFilters(locationFilters)");
    expect(tools.match(/\.\.\.clearedCallFilters/g)).toHaveLength(2);
    expect(tools).not.toMatch(/\.\.\.locationFilters,\s+(server|tool): row\./);
  });

  test("gives call details room to scan and a compact transcript action", () => {
    const detail = sourceBetween(main, "function ToolCallDetail(", "function ToolsView(");
    expect(detail).toContain('aria-modal="true"');

    expect(detail).toContain("<dt>Input size</dt>");
    expect(detail).toContain("<dt>Output size</dt>");
    expect(detail).toContain('<Icon name="messages" />');
    expect(detail).toContain("View in transcript");
  });

  test("uses normalized table colgroups", () => {
    const tools = sourceFrom(readUiFile("views/tools.tsx"), "function ToolsView(");

    expect(tools).toContain('toolTableColumns("mcp", durationAvailable)');
    expect(tools).toContain('toolTableColumns("tools", durationAvailable)');
    expect(tools).toContain('toolTableColumns("calls", durationAvailable)');
    expect(tools.match(/<colgroup>/g)).toHaveLength(3);
    expect(tools.match(/style=\{\{ width: `\$\{column\.width\}%` \}\}/g)).toHaveLength(3);
  });

  test("server names are formatted for display only, never for identity", () => {
    const tools = sourceFrom(readUiFile("views/tools.tsx"), "function ToolsView(");

    expect(tools).toContain("...data.mcp.map((row) => row.mcp_server)");
    expect(tools).toContain("...data.tools.map((row) => row.mcp_server)");
    expect(tools).toContain("server: row.mcp_server,");
    expect(tools).toContain("value={`server:${row.mcp_server}`}");
    expect(tools).toContain("title={row.mcp_server}");
    expect(tools).not.toMatch(/value=\{(formatMcpServer|mcpServerLabel)\(/);
    expect(tools).not.toMatch(/server: (formatMcpServer|mcpServerLabel)\(/);
    expect(tools).not.toContain("formatMcpServer(");
  });
});
