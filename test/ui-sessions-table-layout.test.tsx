import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionSummary } from "../src/ui/types.ts";
import { SessionTableRow, SessionTableSkeletonRows } from "../src/ui/views/sessions.tsx";


const session: SessionSummary = {
  id: 1,
  tool: "opencode",
  source_session_id: "synthetic",
  title: "Synthetic session",
  project_path: "/tmp/project",
  model: "claude-sonnet-5-5",
  reasoning_effort: "medium",
  reasoning_effort_levels: [],
  total_reasoning_tokens: 0,
  reasoning_source: null,
  started_at: "2026-10-18T19:04:00.000Z",
  message_count: 47662,
  total_input_tokens: 0,
  total_output_tokens: 0,
  usage_available: true,
  estimated_cost_usd: 1124.88,
  cost_source: "agent-benchmarks",
  model_provider: null,
  user_state: null,
  is_user_archived: false,
  is_subagent: false,
  parent_session_id: null,
  spawn_tool_use_id: null,
  agent_id: null,
  agent_type: null,
  spawn_depth: null,
  context_window_tokens: 200000,
  peak_context_tokens: 120000,
  compaction_count: 2,
  subagent_count: 3,
  subagent_estimated_cost_usd: 7.25,
  ingest_issue_count: 0,
  informational_ingest_issue_count: 0,
  dosu_mcp_direct_calls: 0,
  dosu_mcp_tree_calls: 0,
};

describe("sessions table", () => {
  test("renders the session link, metrics and expandable subagents", () => {
    const markup = renderToStaticMarkup(
      <table><tbody><SessionTableRow depth={0} expanded={false} onToggle={() => {}} session={session} /></tbody></table>,
    );
    expect(markup).toContain('href="/sessions/1"');
    expect(markup).toContain("Synthetic session");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Expand subagents for Synthetic session");
    expect(markup).toContain("47,662");
  });

  test("renders eleven placeholder cells per skeleton row", () => {
    const markup = renderToStaticMarkup(<table><tbody><SessionTableSkeletonRows /></tbody></table>);
    const rows = [...markup.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect((row[1]?.match(/<td\b/g) ?? [])).toHaveLength(11);
  });
});
