import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareCells } from "../src/compare.ts";
import { closeDb, openDb } from "../src/db.ts";

const workDir = mkdtempSync(join(tmpdir(), "agent-benchmarks-compare-test-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

test("comparison rolls up descendant usage and excludes unpriced tasks from costs", () => {
  const db = openDb(join(workDir, "rollup.db"));
  db.exec(`
    INSERT INTO session(id, tool, source_session_id, model, is_subagent, parent_session_id,
      estimated_cost_usd, total_input_tokens, total_output_tokens, outcome, started_at)
    VALUES
      (1, 'pi', 'root', 'claude-sonnet-4-5', 0, NULL, 1, 10, 20, 'completed', '2026-01-01'),
      (2, 'pi', 'child', 'claude-sonnet-4-5', 1, 1, 2, 30, 40, NULL, '2026-02-01'),
      (3, 'pi', 'grandchild', 'claude-sonnet-4-5', 1, 2, 3, 50, 60, NULL, '2026-02-01'),
      (4, 'pi', 'other', 'claude-sonnet-4-5', 0, NULL, 4, 70, 80, 'failed', '2026-01-01'),
      (5, 'pi', 'unknown', 'unknown-model', 1, 4, 5, 90, 100, NULL, '2026-02-01');
  `);
  const [cell] = compareCells(db, { from: '2026-01-01', to: '2026-01-01' });
  expect(cell).toMatchObject({
    tool: 'pi', model: 'claude-sonnet-4-5', tasks: 2, sessions: 5,
    costUsd: 6, unpricedTasks: 1, costPerTaskMedian: 6,
    subagentCostShare: 5 / 6, completedRate: 0.5, failedRate: 0.5,
    tokens: { input: 250, output: 300 },
  });
  closeDb(db);
});

test("comparison separates root providers and rolls up usage by provider and model", () => {
  const db = openDb(join(workDir, "providers.db"));
  db.exec(`
    INSERT INTO session(id, tool, source_session_id, provider, model, is_subagent, parent_session_id)
    VALUES
      (1, 'pi', 'a', 'alpha', 'claude-sonnet-4-5', 0, NULL),
      (2, 'pi', 'b', 'beta', 'claude-sonnet-4-5', 0, NULL),
      (3, 'pi', 'unknown', NULL, 'claude-sonnet-4-5', 0, NULL),
      (4, 'pi', 'child', 'beta', 'claude-sonnet-4-5', 1, 1),
      (5, 'pi', 'child2', 'alpha', 'claude-sonnet-4-5', 1, 1);
    INSERT INTO session_model_usage(session_id, provider, model, tier, requests, input_tokens,
      output_tokens, cache_read_tokens, cache_creation_tokens, cache_creation_1h_tokens, format_version)
    VALUES
      (1, 'alpha', 'claude-sonnet-4-5', '', 1, 10, 20, 0, 0, 0, 1),
      (4, 'beta', 'claude-sonnet-4-5', '', 2, 30, 40, 0, 0, 0, 1),
      (5, 'alpha', 'claude-sonnet-4-5', '', 3, 50, 60, 0, 0, 0, 1),
      (3, NULL, 'claude-sonnet-4-5', '', 1, 5, 6, 0, 0, 0, 1);
  `);
  const cells = compareCells(db);
  expect(cells).toHaveLength(3);
  expect(cells.find((cell) => cell.provider === 'alpha')).toMatchObject({
    tool: 'pi', model: 'claude-sonnet-4-5', tasks: 1, sessions: 3,
    modelUsage: [
      { provider: 'alpha', model: 'claude-sonnet-4-5', requests: 4, input: 60, output: 80 },
      { provider: 'beta', model: 'claude-sonnet-4-5', requests: 2, input: 30, output: 40 },
    ],
  });
  expect(cells.find((cell) => cell.provider === null)?.modelUsage).toMatchObject([
    { provider: null, model: 'claude-sonnet-4-5', requests: 1 },
  ]);
  closeDb(db);
});
