import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastAgentError, toCellOutcome } from "../src/eval/ledger.ts";
import { pairedComparisons, setupKey, summarizeSetups } from "../src/eval/stats.ts";
import type { EvalCell, EvalSetup } from "../src/eval/types.ts";

function cell(
  setupKey: string,
  taskId: string,
  trial: number,
  outcome: EvalCell["outcome"],
  overrides: Partial<EvalCell> = {},
): EvalCell {
  return {
    cellId: `${setupKey}:${taskId}:${trial}`,
    setupKey,
    taskId,
    trial,
    outcome,
    agentMs: 100,
    verifyMs: 10,
    endToEndMs: 120,
    tokens: null,
    cost: { kind: "priced", usd: 0.2, basis: "list-price-estimate" },
    observedModel: null,
    session: null,
    raw: { status: outcome, exitStatus: null, verify: null, error: null, runId: null },
    ...overrides,
  };
}

const setups: EvalSetup[] = [
  { harness: "claude", model: "a", config: "current" },
  { harness: "codex", model: "b", config: "current" },
];

describe("evaluation statistics", () => {
  test("uses only tasks graded for every setup", () => {
    const cells = [
      cell(setupKey(setups[0]!), "common", 1, "passed"),
      cell(setupKey(setups[1]!), "common", 1, "verify-failed"),
      cell(setupKey(setups[0]!), "limited", 1, "passed"),
      cell(setupKey(setups[1]!), "limited", 1, "provider-limit"),
    ];
    const [a, b] = summarizeSetups(cells, setups, ["common", "limited"], 1);
    expect(a?.eligibleTasks).toBe(1);
    expect(a?.passRate).toBe(1);
    expect(b?.eligibleTasks).toBe(1);
    expect(b?.passRate).toBe(0);
  });

  test("returns null pass@k metrics when a task has fewer than k graded trials", () => {
    const cells = [
      cell(setupKey(setups[0]!), "t1", 1, "passed"),
      cell(setupKey(setups[0]!), "t1", 2, "provider-limit"),
      cell(setupKey(setups[1]!), "t1", 1, "passed"),
      cell(setupKey(setups[1]!), "t1", 2, "passed"),
    ];
    const summaries = summarizeSetups(cells, setups, ["t1"], 2);
    expect(summaries[0]?.passAtK).toBeNull();
    expect(summaries[0]?.passHatK).toBeNull();
    expect(summaries[0]?.kUnavailableReason).not.toBeNull();
    expect(summaries[1]?.passAtK).not.toBeNull();
    expect(summaries[1]?.passHatK).not.toBeNull();
  });

  test("withholds cost ratios under partial pricing coverage", () => {
    const key = setupKey(setups[0]!);
    const cells = [
      cell(key, "t1", 1, "passed"),
      cell(key, "t2", 1, "verify-failed", {
        cost: { kind: "unavailable", reason: "not-metered" },
      }),
    ];
    const [summary] = summarizeSetups(cells, [setups[0]!], ["t1", "t2"], 1);
    expect(summary?.spendUsd).toBeNull();
    expect(summary?.costPerSolvedUsd).toBeNull();
    expect(summary?.pricedSubtotalUsd).toBe(0.2);
    expect(summary?.priced).toEqual({ priced: 1, total: 2 });
  });

  test("requires six same-direction discordant tasks for a verdict", () => {
    const a = setupKey(setups[0]!);
    const b = setupKey(setups[1]!);
    const cells = Array.from({ length: 6 }, (_, i) => [
      cell(a, `t${i}`, 1, "passed"),
      cell(b, `t${i}`, 1, "verify-failed"),
    ]).flat();
    expect(
      pairedComparisons(cells, setups).find((pair) => pair.baseline === a && pair.other === b)
        ?.verdict,
    ).toBe("consistently-worse");
    const inconclusive = pairedComparisons(cells.slice(0, 10), setups);
    expect(inconclusive.find((pair) => pair.baseline === a && pair.other === b)?.verdict).toBe(
      "inconclusive",
    );
  });

  test("keeps a setup that never ran out of everyone else's pass rate", () => {
    const current: EvalSetup = { harness: "claude", model: "a", config: "current" };
    const defaults: EvalSetup = { ...current, config: "default" };
    const cells = [
      cell(setupKey(current), "t1", 1, "passed"),
      cell(setupKey(defaults), "t1", 1, "unavailable"),
    ];
    const [ran, skipped] = summarizeSetups(cells, [current, defaults], ["t1"], 1);
    expect(ran?.setupKey).not.toBe(skipped?.setupKey);
    expect(ran?.passRate).toBe(1);
    expect(ran?.eligibleTasks).toBe(1);
    expect(skipped?.passRate).toBeNull();
    expect(skipped?.graded).toBe(0);
    expect(skipped?.outcomes.unavailable).toBe(1);
  });
});

describe("ledger outcome mapping", () => {
  test("maps status, exit status, and verifier deliberately", () => {
    expect(toCellOutcome("passed", "success", "pass")).toBe("passed");
    expect(toCellOutcome("verify-failed", "success", "fail")).toBe("verify-failed");
    expect(toCellOutcome("error", "timeout", null)).toBe("timeout");
    expect(toCellOutcome("error", "budget_exceeded", null)).toBe("budget-stop");
    expect(toCellOutcome("error", null, "error")).toBe("verifier-error");
    expect(toCellOutcome("skipped-provider-limit", "error", null)).toBe("provider-limit");
    expect(toCellOutcome("skipped-unavailable", null, null)).toBe("unavailable");
  });

  test("passes only when the agent also finished successfully", () => {
    expect(toCellOutcome("passed", null, "pass")).toBe("passed");
    expect(toCellOutcome("error", "error", "pass")).toBe("agent-error");
    expect(toCellOutcome("error", "timeout", "pass")).toBe("timeout");
    expect(toCellOutcome("verify-failed", "budget_exceeded", "pass")).toBe("budget-stop");
  });

  test("an unavailable cell explains itself with the error that ended the agent", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ab-raw-")), "codex.jsonl");
    writeFileSync(
      path,
      [
        { type: "error", message: "Reconnecting... 1/5 (401 Unauthorized)" },
        { type: "error", message: "unexpected status 401 Unauthorized: Incorrect API key" },
        { type: "model_call_end" },
        { type: "error", message: "codex exited with code 1: ERROR websocket" },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );
    expect(lastAgentError({ rawTranscript: path })).toBe(
      "unexpected status 401 Unauthorized: Incorrect API key",
    );
    expect(lastAgentError({ rawTranscript: null })).toBeNull();
  });
});
