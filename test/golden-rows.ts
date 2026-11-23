import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INGEST_PIPELINE_REVISION } from "../src/ingest.ts";
import { decodeMessageRaw } from "../src/message-storage.ts";
import { MODEL_USAGE_FORMAT_VERSION } from "../src/model-usage.ts";
import { SESSION_ECONOMICS_FORMAT_VERSION } from "../src/token-economics.ts";

export const GOLDEN_NOW = new Date("2026-11-04T22:00:00.000Z");

export function decodeGoldenRows(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (row != null && typeof row === "object" && "raw" in row && row.raw instanceof Uint8Array) {
      return { ...row, raw: decodeMessageRaw(row.raw) };
    }
    return row;
  });
}

export const ROW_QUERIES = {
  sessions: `
    SELECT s.tool, s.source_session_id, p.path AS project_path, p.name AS project_name,
           s.title, s.cwd, s.git_branch, s.model, s.cli_version, s.started_at, s.ended_at,
           s.message_count, s.total_input_tokens, s.total_output_tokens,
           s.total_cache_read_tokens, s.total_cache_creation_tokens,
           s.total_reasoning_tokens, s.est_reasoning_tokens, s.reasoning_source,
           s.estimated_cost_usd, s.is_archived, s.source_path,
           s.turn_count, s.error_count, s.interruption_count, s.compaction_count,
           s.sidechain_message_count, s.agent_spawn_count, s.skill_count, s.command_count,
           s.thinking_block_count, s.thinking_chars, s.active_seconds, s.outcome, s.work_type
    FROM session s LEFT JOIN project p ON p.id = s.project_id
    ORDER BY s.tool, s.source_session_id`,
  messages: `
    SELECT s.tool, s.source_session_id, m.seq, m.source_uuid, m.parent_source_uuid,
           m.role, m.model, m.stop_reason, m.timestamp, m.input_tokens, m.output_tokens,
           m.cache_read_tokens, m.cache_creation_tokens, m.raw
    FROM message m JOIN session s ON s.id = m.session_id
    ORDER BY s.tool, s.source_session_id, m.seq`,
  blocks: `
    SELECT s.tool, s.source_session_id, m.seq, b.ordinal, b.type, b.text,
           b.tool_name, b.tool_use_id, b.tool_input, b.tool_result
    FROM block b JOIN message m ON m.id = b.message_id JOIN session s ON s.id = b.session_id
    ORDER BY s.tool, s.source_session_id, m.seq, b.ordinal`,
  tool_calls: `
    SELECT s.tool, s.source_session_id, m.seq, tc.ordinal, tc.tool_kind, tc.tool_name,
           tc.mcp_server, tc.tool_base_name, tc.tool_use_id, tc.input, tc.is_error,
           tc.input_bytes, tc.has_result, tc.output_preview, tc.output_bytes,
           tc.duration_ms, tc.timestamp
    FROM tool_call tc
    LEFT JOIN message m ON m.id = tc.message_id
    JOIN session s ON s.id = tc.session_id
    ORDER BY s.tool, s.source_session_id, m.seq, tc.ordinal, tc.tool_use_id`,
  file_refs: `
    SELECT s.tool, s.source_session_id, m.seq, f.path, f.rel_path, f.ext,
           f.operation, f.timestamp
    FROM file_ref f
    LEFT JOIN message m ON m.id = f.message_id
    JOIN session s ON s.id = f.session_id
    ORDER BY s.tool, s.source_session_id, m.seq, f.path, f.operation`,
  recommendations: `
    SELECT key, kind, category, title, detail, suggestion, prompt, url,
           link_label, icon, tone, impact_label, score, status, status_source, note
    FROM recommendation
    ORDER BY key`,
  model_usage: `
    SELECT s.tool, s.source_session_id, u.provider, u.model, u.tier, u.requests,
           u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_creation_tokens,
           u.cache_creation_1h_tokens, u.reported_cost_usd
    FROM session_model_usage u JOIN session s ON s.id = u.session_id
    ORDER BY s.tool, s.source_session_id, u.provider, u.model, u.tier`,
  economics: `
    SELECT s.tool, s.source_session_id,
           json_remove(e.vector_json, '$.id', '$.input_cost', '$.output_cost', '$.reported_cost')
             AS vector
    FROM session_economics e JOIN session s ON s.id = e.session_id
    ORDER BY s.tool, s.source_session_id`,
} as const;

type RowDump = keyof typeof ROW_QUERIES;

const DERIVED_ROW_VERSIONS = {
  INGEST_PIPELINE_REVISION: {
    value: INGEST_PIPELINE_REVISION,
    file: "src/ingest.ts",
    dumps: ["sessions", "messages", "blocks", "tool_calls", "file_refs"],
  },
  MODEL_USAGE_FORMAT_VERSION: {
    value: MODEL_USAGE_FORMAT_VERSION,
    file: "src/model-usage.ts",
    dumps: ["model_usage"],
  },
  SESSION_ECONOMICS_FORMAT_VERSION: {
    value: SESSION_ECONOMICS_FORMAT_VERSION,
    file: "src/token-economics.ts",
    dumps: ["economics"],
  },
} as const satisfies Record<string, { value: number; file: string; dumps: RowDump[] }>;

type DerivedRowVersion = keyof typeof DERIVED_ROW_VERSIONS;
export type RevisionLock = Record<DerivedRowVersion, { value: number; sha256: string }>;

// Every sync reprices stored sessions, so a rate change needs no re-derive.
function withoutRepricedCost(row: unknown): unknown {
  if (row == null || typeof row !== "object") return row;
  const { estimated_cost_usd: _, ...rest } = row as Record<string, unknown>;
  return rest;
}

export function goldenRevisionLock(goldenDir: string): RevisionLock {
  return Object.fromEntries(
    Object.entries(DERIVED_ROW_VERSIONS).map(([name, { value, dumps }]) => {
      const hash = createHash("sha256");
      for (const dump of dumps) {
        const rows = JSON.parse(readFileSync(join(goldenDir, "rows", `${dump}.json`), "utf8"));
        hash.update(JSON.stringify((rows as unknown[]).map(withoutRepricedCost)));
      }
      return [name, { value, sha256: hash.digest("hex") }];
    }),
  ) as RevisionLock;
}

export function unbumpedRevisionErrors(locked: RevisionLock, current: RevisionLock): string[] {
  const reingested =
    locked.INGEST_PIPELINE_REVISION.value !== current.INGEST_PIPELINE_REVISION.value;
  return (Object.keys(DERIVED_ROW_VERSIONS) as DerivedRowVersion[]).flatMap((name) => {
    const was = locked[name];
    const now = current[name];
    if (was === undefined || was.sha256 === now.sha256 || was.value !== now.value || reingested) {
      return [];
    }
    const { file, dumps } = DERIVED_ROW_VERSIONS[name];
    return [
      `Derived ${dumps.join(", ")} rows changed but ${name} is still ${now.value}, so existing archives keep the old rows. Bump ${name} in ${file}, then run: bun scripts/regen-goldens.ts --i-reviewed-the-diff`,
    ];
  });
}
