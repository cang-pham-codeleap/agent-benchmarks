import type { Database } from "bun:sqlite";
import { isPriceable } from "./cost.ts";
import { sessionDatePredicate } from "./date-filter.ts";
import { sessionUserStatePredicateForDatabase } from "./session-user-state.ts";
import { visibleSessionPredicate } from "./session-visibility.ts";
import { sessionSourcePredicate } from "./source-filter.ts";
import { type StatsFilter, sessionUsageAvailableSql } from "./stats.ts";

export interface CompareFilter extends StatsFilter {
  workType?: string | null;
  outcome?: string | null;
}

type Tokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
};
export interface CompareCell {
  tool: string;
  provider: string | null;
  model: string;
  tasks: number;
  sessions: number;
  costUsd: number | null;
  unpricedTasks: number;
  costPerTaskMedian: number | null;
  costPerTaskP90: number | null;
  tokens: Tokens;
  cacheReadShare: number | null;
  completedRate: number;
  failedRate: number;
  abandonedRate: number;
  outputTokensPerDollar: number | null;
  activeSecondsMedian: number | null;
  subagentCostShare: number | null;
  modelUsage: {
    provider: string | null;
    model: string;
    requests: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  }[];
}

type Usage = CompareCell["modelUsage"][number];
type SessionRow = {
  root_id: number;
  root_tool: string;
  root_provider: string | null;
  root_model: string | null;
  root_outcome: string | null;
  id: number;
  model: string | null;
  estimated_cost_usd: number;
  usage_available: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_reasoning_tokens: number;
  active_seconds: number;
  usage_json: string;
};

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  return values[Math.ceil(values.length * p) - 1] ?? null;
}

export function compareCells(db: Database, filter: CompareFilter = {}): CompareCell[] {
  const date = sessionDatePredicate("s", filter);
  const source = sessionSourcePredicate("s", filter.source);
  const clauses = [
    "s.is_subagent = 0",
    visibleSessionPredicate("s"),
    sessionUserStatePredicateForDatabase(db, "s", filter.includeArchived === true),
    date.sql,
    source.sql,
  ];
  const params = [...date.params, ...source.params];
  for (const [value, sql] of [
    [filter.project, "EXISTS (SELECT 1 FROM project p WHERE p.id = s.project_id AND p.path = ?)"],
    [
      filter.repo,
      "EXISTS (SELECT 1 FROM project p WHERE p.id = s.project_id AND COALESCE(p.root_path, p.path) = ?)",
    ],
    [filter.tool, "s.tool = ?"],
    [filter.workType, "COALESCE(s.work_type, '') = ?"],
    [filter.outcome, "COALESCE(s.outcome, '') = ?"],
  ] as const) {
    if (value != null) {
      clauses.push(sql);
      params.push(value);
    }
  }
  const rows = db
    .query(`WITH RECURSIVE tree(root_id, root_tool, root_provider, root_model, root_outcome, id) AS (
    SELECT s.id, s.tool, s.provider, s.model, s.outcome, s.id FROM session s WHERE ${clauses.filter(Boolean).join(" AND ")}
    UNION ALL
    SELECT tree.root_id, tree.root_tool, tree.root_provider, tree.root_model, tree.root_outcome, child.id
    FROM tree JOIN session child ON child.parent_session_id = tree.id AND child.is_subagent = 1
  ) SELECT tree.*, s.model, s.estimated_cost_usd, ${sessionUsageAvailableSql("s")} AS usage_available,
    s.total_input_tokens, s.total_output_tokens, s.total_cache_read_tokens,
    s.total_cache_creation_tokens, s.total_reasoning_tokens, s.active_seconds,
    (SELECT json_group_array(json_object('provider', u.provider, 'model', u.model, 'requests', u.requests,
      'input', u.input_tokens, 'output', u.output_tokens, 'cacheRead', u.cache_read_tokens,
      'cacheWrite', u.cache_creation_tokens, 'reportedCost', u.reported_cost_usd)) FROM session_model_usage u WHERE u.session_id = s.id) AS usage_json
    FROM tree JOIN session s ON s.id = tree.id`)
    .all(...params) as SessionRow[];

  type Task = {
    tool: string;
    provider: string | null;
    model: string;
    outcome: string | null;
    sessions: number;
    cost: number;
    subagentCost: number;
    priced: boolean;
    tokens: Tokens;
    active: number;
    usage: Usage[];
  };
  const tasks = new Map<number, Task>();
  for (const row of rows) {
    let task = tasks.get(row.root_id);
    if (task == null) {
      task = {
        tool: row.root_tool,
        provider: row.root_provider,
        model: row.root_model ?? "",
        outcome: row.root_outcome,
        sessions: 0,
        cost: 0,
        subagentCost: 0,
        priced: true,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
        active: 0,
        usage: [],
      };
      tasks.set(row.root_id, task);
    }
    const usage = JSON.parse(row.usage_json) as (Usage & { reportedCost: number | null })[];
    // A harness-reported cost prices that usage even when the model has no list price (e.g. OMP side calls).
    const models = usage.length
      ? usage.filter((u) => u.reportedCost == null).map((u) => u.model || row.model || "")
      : [row.model ?? ""];
    task.priced &&= row.usage_available === 1 && models.every((model) => isPriceable(model));
    task.sessions++;
    task.cost += row.estimated_cost_usd;
    if (row.id !== row.root_id) task.subagentCost += row.estimated_cost_usd;
    task.tokens.input += row.total_input_tokens;
    task.tokens.output += row.total_output_tokens;
    task.tokens.cacheRead += row.total_cache_read_tokens;
    task.tokens.cacheWrite += row.total_cache_creation_tokens;
    task.tokens.reasoning += row.total_reasoning_tokens;
    task.active += row.active_seconds;
    task.usage.push(...usage);
  }
  const groups = new Map<string, Task[]>();
  for (const task of tasks.values()) {
    const key = JSON.stringify([task.tool, task.provider, task.model]);
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const priced = group.filter((task) => task.priced);
    const costs = priced.map((task) => task.cost);
    const cost = costs.reduce((a, b) => a + b, 0);
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
    const usage = new Map<string, Usage>();
    for (const task of group) {
      for (const key of Object.keys(tokens) as (keyof Tokens)[]) tokens[key] += task.tokens[key];
      for (const item of task.usage) {
        const key = JSON.stringify([item.provider, item.model]);
        const existing = usage.get(key) ?? {
          provider: item.provider,
          model: item.model,
          requests: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        };
        existing.requests += item.requests;
        existing.input += item.input;
        existing.output += item.output;
        existing.cacheRead += item.cacheRead;
        existing.cacheWrite += item.cacheWrite;
        usage.set(key, existing);
      }
    }
    const input = tokens.input + tokens.cacheRead + tokens.cacheWrite;
    const rate = (outcome: string) =>
      group.filter((task) => task.outcome === outcome).length / group.length;
    return {
      tool: group[0]!.tool,
      provider: group[0]!.provider,
      model: group[0]!.model,
      tasks: group.length,
      sessions: group.reduce((sum, task) => sum + task.sessions, 0),
      costUsd: priced.length ? cost : null,
      unpricedTasks: group.length - priced.length,
      costPerTaskMedian: percentile(costs, 0.5),
      costPerTaskP90: percentile(costs, 0.9),
      tokens,
      cacheReadShare: input ? tokens.cacheRead / input : null,
      completedRate: rate("completed"),
      failedRate: rate("failed"),
      abandonedRate: rate("abandoned"),
      outputTokensPerDollar:
        cost > 0 ? priced.reduce((sum, task) => sum + task.tokens.output, 0) / cost : null,
      activeSecondsMedian: percentile(
        group.map((task) => task.active),
        0.5,
      ),
      subagentCostShare:
        cost > 0 ? priced.reduce((sum, task) => sum + task.subagentCost, 0) / cost : null,
      modelUsage: [...usage.values()].sort(
        (a, b) =>
          (a.provider ?? "").localeCompare(b.provider ?? "") || a.model.localeCompare(b.model),
      ),
    };
  });
}
