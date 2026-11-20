import type { Database } from "bun:sqlite";
import { realpathSync } from "node:fs";
import { isPriceable } from "../cost.ts";
import { sessionUsageAvailableSql } from "../stats.ts";
import type { CellCost, CellTokens } from "./types.ts";

export interface EvalRegistryRun {
  runId: string;
  sessionId?: string;
  cwd?: string;
  startedAt: number;
  updatedAt?: number;
}

export interface JoinedSessionCost {
  cost: CellCost;
  tokens: CellTokens | null;
  session: { tool: string; sourceSessionId: string } | null;
  observedModel: string | null;
}

export function joinSessionCost(
  db: Database,
  tool: string,
  registry: EvalRegistryRun,
): JoinedSessionCost {
  const candidates = registry.sessionId
    ? db
        .query<{ id: number }, [string, string]>(
          "SELECT id FROM session WHERE tool = ?1 AND source_session_id = ?2 AND is_subagent = 0 LIMIT 2",
        )
        .all(tool, registry.sessionId)
    : [];
  const roots = candidates.length === 1 ? candidates : findByCwdAndTime(db, tool, registry);
  if (roots.length !== 1) {
    return unavailable(roots.length > 1 ? "ambiguous" : "not-found");
  }
  const root = db
    .query<{ id: number; source_session_id: string; model: string | null }, [number]>(
      "SELECT id, source_session_id, model FROM session WHERE id = ?",
    )
    .get(roots[0]!.id)!;
  const rows = db
    .query<CostRow, [number]>(`WITH RECURSIVE tree(id) AS (
    SELECT id FROM session WHERE id = ?
    UNION ALL
    SELECT child.id FROM session child JOIN tree parent ON child.parent_session_id = parent.id
    WHERE child.is_subagent = 1
  ) SELECT s.id, s.model, s.estimated_cost_usd, ${sessionUsageAvailableSql("s")} AS usage_available,
      s.total_input_tokens, s.total_output_tokens, s.total_cache_read_tokens, s.total_cache_creation_tokens,
      (SELECT json_group_array(json_object('model', u.model, 'reportedCost', u.reported_cost_usd))
       FROM session_model_usage u WHERE u.session_id = s.id) AS usage_json
    FROM tree JOIN session s ON s.id = tree.id`)
    .all(root.id);
  const fullyPriced = rows.every((row) => {
    const usage = JSON.parse(row.usage_json) as { model: string; reportedCost: number | null }[];
    return (
      row.usage_available === 1 &&
      (usage.length === 0
        ? isPriceable(row.model ?? "")
        : usage.every(
            (item) => item.reportedCost != null || isPriceable(item.model || row.model || ""),
          ))
    );
  });
  if (!fullyPriced) {
    return {
      cost: { kind: "unavailable", reason: "unpriced-model" },
      tokens: null,
      session: { tool, sourceSessionId: root.source_session_id },
      observedModel: root.model,
    };
  }
  return {
    cost: {
      kind: "priced",
      usd: rows.reduce((sum, row) => sum + row.estimated_cost_usd, 0),
      basis: "list-price-estimate",
    },
    tokens: rows.reduce<CellTokens>(
      (tokens, row) => ({
        input: tokens.input + row.total_input_tokens,
        output: tokens.output + row.total_output_tokens,
        cacheRead: tokens.cacheRead + row.total_cache_read_tokens,
        cacheWrite: tokens.cacheWrite + row.total_cache_creation_tokens,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ),
    session: { tool, sourceSessionId: root.source_session_id },
    observedModel: root.model,
  };
}

type CostRow = {
  id: number;
  model: string | null;
  estimated_cost_usd: number;
  usage_available: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  usage_json: string;
};

function findByCwdAndTime(db: Database, tool: string, registry: EvalRegistryRun): { id: number }[] {
  const cwd = registry.cwd;
  if (cwd == null) return [];
  let realCwd: string;
  try {
    realCwd = realpathSync(cwd);
  } catch (error) {
    console.error(
      `[eval/cost] hermetic cwd no longer exists for ${registry.runId}; matching its path text`,
      error,
    );
    realCwd = cwd;
  }
  const start = registry.startedAt - 60_000;
  const end = (registry.updatedAt ?? registry.startedAt) + 60_000;
  return db
    .query<{ id: number }, [string, string, string, string]>(
      `SELECT id FROM session
     WHERE tool = ?1 AND is_subagent = 0 AND cwd = ?2
       AND started_at >= ?3 AND started_at <= ?4 LIMIT 2`,
    )
    .all(tool, realCwd, new Date(start).toISOString(), new Date(end).toISOString());
}

function unavailable(reason: "not-found" | "ambiguous"): JoinedSessionCost {
  return {
    cost: { kind: "unavailable", reason },
    tokens: null,
    session: null,
    observedModel: null,
  };
}
