import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type EvalRegistryRun, joinSessionCost } from "./cost.ts";
import { apiCellId, ledgerFile } from "./paths.ts";
import { realTaskId } from "./real.ts";
import { EVAL_HARNESSES } from "./registry.ts";
import { setupKey } from "./stats.ts";
import type {
  CellOutcome,
  EvalCell,
  EvalConfigMode,
  EvalRunInput,
  EvalSetup,
  InterruptedAttempt,
} from "./types.ts";

export interface EvalLedgerRow {
  v: number;
  cellId: string;
  agent: string;
  task: string;
  model: string | null;
  trial: number;
  status: string;
  runId: string | null;
  exitStatus?: string;
  verify?: string;
  error?: string;
  startedAt: number;
  endedAt: number;
}

interface RunRecord extends EvalRegistryRun {
  agent: string;
  status?: string;
  cellId?: string;
  updatedAt?: number;
  sessionId?: string;
  totals?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
  };
  usage?: {
    usd?: { available: boolean; source?: string; value?: number };
    model?: { observed?: string[] };
    tokens?: { available?: boolean };
  };
  verify?: { durationMs?: number };
}

export function toCellOutcome(
  status: string,
  exitStatus: string | null,
  verify: string | null,
): CellOutcome {
  if (verify === "pass" && (exitStatus == null || exitStatus === "success")) return "passed";
  if (verify === "error") return "verifier-error";
  if (status === "skipped-provider-limit") return "provider-limit";
  if (status === "skipped-unavailable") return "unavailable";
  if (exitStatus === "timeout") return "timeout";
  if (exitStatus === "budget_exceeded" || exitStatus === "turn_limit") return "budget-stop";
  if (verify === "fail") return "verify-failed";
  return status === "pending" ? "pending" : "agent-error";
}

export function evalTaskIds(input: EvalRunInput): string[] {
  return input.kind === "real" ? [realTaskId(input.task)] : input.taskIds;
}

export function achCellId(setup: EvalSetup, taskId: string, trial: number): string {
  const agent = EVAL_HARNESSES[setup.harness]?.achAgent ?? setup.harness;
  return `${agent}:${taskId}:${setup.model}:trial${trial}`;
}

/** Last ledger row per cell across every config group, keyed by API cell id. */
export function readLedgerCells(runDir: string): Map<string, EvalLedgerRow> {
  const cells = new Map<string, EvalLedgerRow>();
  for (const config of Object.keys(ledgerFile) as EvalConfigMode[])
    for (const row of readLedger(join(runDir, ledgerFile[config])))
      cells.set(apiCellId(config, row.cellId), row);
  return cells;
}

export function readEvalCells(
  db: Database,
  runDir: string,
  input: EvalRunInput,
): { cells: EvalCell[]; interrupted: InterruptedAttempt[] } {
  const byCell = readLedgerCells(runDir);
  const registry = readRegistry(runDir);
  const byRun = new Map(registry.map((run) => [run.runId, run]));
  const cells: EvalCell[] = [];
  for (const setup of input.setups) {
    for (const taskId of evalTaskIds(input)) {
      for (let trial = 1; trial <= input.trials; trial++) {
        const cellId = apiCellId(setup.config, achCellId(setup, taskId, trial));
        const row = byCell.get(cellId);
        if (row == null) {
          cells.push(pendingCell(cellId, setupKey(setup), taskId, trial));
          continue;
        }
        const record = row.runId == null ? null : (byRun.get(row.runId) ?? null);
        const harness = EVAL_HARNESSES[setup.harness];
        const joined =
          record == null
            ? null
            : joinSessionCost(db, harness?.sessionTool ?? setup.harness, record);
        let cost = joined?.cost ?? { kind: "unavailable" as const, reason: "not-run" as const };
        let tokens = joined?.tokens ?? null;
        const session = joined?.session ?? null;
        let observedModel = joined?.observedModel ?? null;
        if (
          record?.usage?.usd?.available === true &&
          record.usage.usd.value != null &&
          harness?.metered
        ) {
          cost = { kind: "priced", usd: record.usage.usd.value, basis: "harness-reported" };
          tokens =
            record.totals == null
              ? null
              : {
                  input: record.totals.inputTokens,
                  output: record.totals.outputTokens,
                  cacheRead: record.totals.cacheReadTokens,
                  cacheWrite: record.totals.cacheWriteTokens,
                };
        } else if (joined?.cost.kind === "unavailable" && harness?.metered === false) {
          cost = { kind: "unavailable", reason: "not-metered" };
        }
        observedModel ??= record?.usage?.model?.observed?.[0] ?? null;
        const outcome =
          row.runId == null && row.status === "error" && row.error?.includes("setup")
            ? "setup-error"
            : toCellOutcome(row.status, row.exitStatus ?? null, row.verify ?? null);
        cells.push({
          cellId,
          setupKey: setupKey(setup),
          taskId: row.task,
          trial: row.trial,
          outcome,
          agentMs:
            record == null
              ? null
              : Math.max(0, (record.updatedAt ?? record.startedAt) - record.startedAt),
          verifyMs: record?.verify?.durationMs ?? null,
          endToEndMs: Math.max(0, row.endedAt - row.startedAt),
          tokens,
          cost,
          observedModel,
          session,
          raw: {
            status: row.status,
            exitStatus: row.exitStatus ?? null,
            verify: row.verify ?? null,
            error: row.error ?? null,
            runId: row.runId,
          },
        });
      }
    }
  }
  const ledgerRunIds = new Set(
    [...byCell.values()].map((row) => row.runId).filter((id): id is string => id != null),
  );
  const interrupted = registry
    .filter((run) => run.cellId != null && !ledgerRunIds.has(run.runId))
    .map((run) => ({
      runId: run.runId,
      cellId: run.cellId ?? null,
      startedAt: new Date(run.startedAt).toISOString(),
      cost: costForInterrupted(run),
    }));
  return { cells, interrupted };
}

export function repairTornLedger(runDir: string): boolean {
  let repaired = false;
  for (const name of Object.values(ledgerFile)) {
    const path = join(runDir, name);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    if (bytes.length === 0 || bytes.at(-1) === 10) continue;
    const newline = bytes.lastIndexOf(10);
    const fragment = bytes.subarray(newline + 1);
    const tornPath = join(runDir, `ledger.torn-${Date.now()}-${name}`);
    writeFileSync(tornPath, fragment, { mode: 0o600 });
    truncateSync(path, newline < 0 ? 0 : newline + 1);
    console.error(`[eval/ledger] repaired torn tail in ${path}: saved ${tornPath}`);
    repaired = true;
  }
  return repaired;
}

function readLedger(path: string): EvalLedgerRow[] {
  if (!existsSync(path)) return [];
  const last = new Map<string, EvalLedgerRow>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line) as EvalLedgerRow;
      last.set(row.cellId, row);
    } catch (error) {
      console.error(`[eval/ledger] ignoring malformed complete row in ${path}`, error);
    }
  }
  return [...last.values()];
}

function readRegistry(runDir: string): RunRecord[] {
  const root = join(runDir, "ach-state", "runs");
  if (!existsSync(root)) return [];
  const records: RunRecord[] = [];
  for (const name of readdirSync(root).filter((entry) => entry.endsWith(".json"))) {
    try {
      records.push(JSON.parse(readFileSync(join(root, name), "utf8")) as RunRecord);
    } catch (error) {
      console.error(`[eval/ledger] ignoring corrupt registry file ${name}`, error);
    }
  }
  return records;
}

function costForInterrupted(run: RunRecord): EvalCell["cost"] {
  return run.usage?.usd?.available === true && run.usage.usd.value != null
    ? { kind: "priced", usd: run.usage.usd.value, basis: "harness-reported" }
    : { kind: "unavailable", reason: "not-run" };
}

function pendingCell(cellId: string, setupKey: string, taskId: string, trial: number): EvalCell {
  return {
    cellId,
    setupKey,
    taskId,
    trial,
    outcome: "pending",
    agentMs: null,
    verifyMs: null,
    endToEndMs: null,
    tokens: null,
    cost: { kind: "unavailable", reason: "not-run" },
    observedModel: null,
    session: null,
    raw: { status: "pending", exitStatus: null, verify: null, error: null, runId: null },
  };
}
