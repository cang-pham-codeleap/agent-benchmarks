import { describe, expect, test } from "bun:test";
import { renderReport } from "../src/eval/report.ts";
import type {
  CellArtifacts,
  EvalCell,
  EvalResults,
  EvalSetup,
  SetupSummary,
} from "../src/eval/types.ts";

const SETUPS: EvalSetup[] = [
  { harness: "claude", model: "sonnet", config: "current", augments: [] },
  { harness: "claude", model: "sonnet", config: "default", augments: [] },
  { harness: "codex", model: "gpt-5", config: "current", augments: [] },
];

function cell(setup: EvalSetup, outcome: EvalCell["outcome"]): EvalCell {
  const achCellId = `${setup.harness}:replay-abc1234:${setup.model}:trial1`;
  return {
    cellId: `${setup.config}/${achCellId}`,
    setupKey: `${setup.harness}:${setup.model}:${setup.config}`,
    taskId: "replay-abc1234",
    trial: 1,
    outcome,
    agentMs: 83_000,
    verifyMs: 4_000,
    endToEndMs: 90_000,
    tokens:
      outcome === "unavailable"
        ? null
        : { input: 1200, output: 300, cacheRead: 5000, cacheWrite: 0 },
    cost:
      outcome === "unavailable"
        ? { kind: "unavailable", reason: "not-run" }
        : { kind: "priced", usd: 0.42, basis: "harness-reported" },
    observedModel: setup.model,
    prepMs: null,
    session: null,
    raw: {
      status: "done",
      exitStatus: "success",
      verify: "pass",
      error: outcome === "unavailable" ? "default config needs <token>" : null,
      runId: "r1",
    },
  };
}

function summary(setup: EvalSetup): SetupSummary {
  return {
    setupKey: `${setup.harness}:${setup.model}:${setup.config}`,
    setup,
    planned: 1,
    attempted: 1,
    graded: 1,
    passed: 1,
    passRate: 1,
    passRateCi: null,
    eligibleTasks: 1,
    k: 1,
    passAtK: null,
    passHatK: null,
    kUnavailableReason: null,
    spendUsd: 0.42,
    pricedSubtotalUsd: 0.42,
    priced: { priced: 1, total: 1 },
    costPerSolvedUsd: 0.42,
    timePerSolvedMs: 83_000,
    agentP50Ms: 83_000,
    agentP95Ms: 83_000,
    outcomes: {} as SetupSummary["outcomes"],
  };
}

const cells = [
  cell(SETUPS[0] as EvalSetup, "passed"),
  cell(SETUPS[1] as EvalSetup, "unavailable"),
  cell(SETUPS[2] as EvalSetup, "verify-failed"),
];
const passedCell = cells[0] as EvalCell;
const failedCell = cells[2] as EvalCell;

const results: EvalResults = {
  manifest: {
    id: "run-0001",
    createdAt: "2026-11-20T10:00:00.000Z",
    input: {
      kind: "real",
      name: "Replay <add> fix",
      setups: SETUPS,
      trials: 1,
      wallMs: 1_800_000,
      repoPath: "/tmp/repo",
      task: {
        type: "replay",
        sha: "abc1234",
        prompt: "Fix add() when a < b & return <result>",
        hiddenPaths: ["add.test.ts"],
      },
      profile: {
        setupCommand: "bun install",
        checks: ["bun test"],
        hiddenTestCommand: "bun test {file}",
      },
    },
    status: "completed",
    pid: null,
    startedAt: "2026-11-20T10:00:00.000Z",
    endedAt: "2026-11-20T10:05:00.000Z",
    exitCode: 0,
    error: null,
    survivors: [],
    provenance: {
      achDir: "/tmp/ach",
      achCommit: "deadbeef",
      achDirty: false,
      harnessVersions: { claude: "2.1.0", codex: "0.50.0" },
      taskHashes: {},
      executionOrder: [],
      hermeticRoot: null,
      globalConfigNote: "",
    },
  },
  cells,
  interrupted: [],
  setups: SETUPS.map(summary),
  paired: [],
  warnings: ["Descriptive only: one task."],
  progress: { done: 3, total: 3, currentCell: null, liveCellId: null },
  real: {
    task: {
      type: "replay",
      sha: "abc1234",
      prompt: "Fix add() when a < b & return <result>",
      hiddenPaths: ["add.test.ts"],
    },
    repoPath: "/tmp/repo",
    baseSha: "0001111",
    profile: {
      setupCommand: "bun install",
      checks: ["bun test"],
      hiddenTestCommand: "bun test {file}",
    },
    reference: {
      baseSha: "0001111",
      sha: "abc1234",
      diffStat: { files: ["add.ts", "add.test.ts"], added: 5, removed: 1 },
      nonHidden: { files: ["add.ts"], added: 2, removed: 1 },
    },
    cells: {
      [passedCell.cellId]: {
        diffStat: { files: ["add.ts"], added: 2, removed: 1 },
        checks: [
          {
            command: "bun test",
            exitCode: 0,
            timedOut: false,
            durationMs: 1200,
            log: "cells/current/x/checks/0.log",
          },
        ],
        hidden: { passed: 1, total: 1, files: [{ path: "add.test.ts", passed: true }] },
        fileOverlap: 1,
        sizeRatio: 1,
        turns: 7,
        toolCalls: 12,
      },
      [failedCell.cellId]: {
        diffStat: { files: ["add.ts", "util.ts"], added: 9, removed: 0 },
        checks: [
          {
            command: "bun test",
            exitCode: 1,
            timedOut: false,
            durationMs: 900,
            log: "cells/current/y/checks/0.log",
          },
        ],
        hidden: { passed: 0, total: 1, files: [{ path: "add.test.ts", passed: false }] },
        fileOverlap: 1,
        sizeRatio: 3,
        turns: 4,
        toolCalls: 6,
      },
    },
  },
  augmentVerdicts: [
    {
      baseline: "claude:sonnet:default",
      augmented: "claude:sonnet:default+rtk",
      harness: "claude",
      model: "sonnet",
      config: "default",
      augments: ["rtk"],
      pairs: 24,
      minTrials: 3,
      passDelta: 0.0417,
      better: 2,
      worse: 1,
      tokenDelta: -0.2,
      costDelta: null,
      savingBasis: "tokens",
      prepMs: 2_500,
      verdict: "adopt",
      reason: "Saved 20% <tokens> with no quality loss.",
    },
  ],
};

const artifacts: Record<string, CellArtifacts> = {
  reference: { patch: "-  return a<b;\n+  return a + b; // human\n", checks: [], hidden: [] },
  [passedCell.cellId]: {
    patch: "+const html = '<script>alert(1)</script>';\n",
    checks: [{ command: "bun test", logTail: "1 pass <ok>" }],
    hidden: [{ path: "add.test.ts", logTail: "1 pass" }],
  },
  [failedCell.cellId]: {
    patch: "+export const util = 1;\n",
    checks: [{ command: "bun test", logTail: "1 fail" }],
    hidden: [],
  },
};

describe("renderReport", () => {
  const html = renderReport(results, (id) => artifacts[id] ?? null);

  test("is self-contained: inline style only, no scripts or remote references", () => {
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  test("escapes prompt, diff, and log text", () => {
    expect(html).toContain("Fix add() when a &lt; b &amp; return &lt;result&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("return a&lt;b;");
    expect(html).toContain("1 pass &lt;ok&gt;");
    expect(html).toContain("Replay &lt;add&gt; fix");
  });

  test("lists run metadata, every combo, and the human reference", () => {
    for (const text of ["/tmp/repo", "0001111", "abc1234", "2.1.0", "0.50.0", "bun test {file}"])
      expect(html).toContain(text);
    expect(html).toContain("<td>Human reference</td>");
    expect(html).toContain("<td>claude · sonnet · current configuration</td>");
    expect(html).toContain("<td>claude · sonnet · default</td>");
    expect(html).toContain("<td>codex · gpt-5 · current configuration</td>");
    expect(html).toContain("<td>unavailable (not-run)</td>");
  });

  test("shows diffs in details, check and hidden results, and transcript summaries only", () => {
    expect(html.match(/<details/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("1/1 passed");
    expect(html).toContain("0/1 passed");
    expect(html).toContain("failed (exit 1)");
    expect(html).toContain("<td>7</td><td>12</td><td>none</td>");
    expect(html).toContain("default config needs &lt;token&gt;");
  });

  test("lists augment verdicts and omits the section without them", () => {
    expect(html).toContain("<h2>Augments</h2>");
    expect(html).toContain("<td>claude · sonnet · default +rtk</td>");
    expect(html).toContain("<td>adopt</td><td>24</td><td>+4.2 pts</td>");
    expect(html).toContain("<td>-20.0% (tokens)</td><td>2 / 1</td><td>");
    expect(html).toContain("Saved 20% &lt;tokens&gt; with no quality loss.");
    const without = renderReport({ ...results, augmentVerdicts: [] }, () => null);
    expect(without).not.toContain("<h2>Augments</h2>");
  });

  test("setup labels include augments", () => {
    const augmented: EvalSetup = { ...SETUPS[1]!, augments: ["rtk", "ptc"] };
    const labelled = renderReport(
      { ...results, setups: [{ ...results.setups[1]!, setup: augmented }] },
      () => null,
    );
    expect(labelled).toContain("claude · sonnet · default · +rtk +ptc");
  });
});
