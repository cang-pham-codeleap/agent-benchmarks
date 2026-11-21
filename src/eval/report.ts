import { REPORT_CSS } from "../report/styles.ts";
import { AGENT_BENCHMARKS_VERSION } from "../version.ts";
import type {
  AugmentVerdict,
  CellArtifacts,
  CheckResult,
  DiffStat,
  EvalCell,
  EvalResults,
  EvalSetup,
  RealCellSummary,
} from "./types.ts";

const REAL_REPORT_CSS = `
.run-facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0; font-size: 0.82rem; }
.run-facts dt { color: var(--muted); }
.run-facts dd { margin: 0; overflow-wrap: anywhere; }
pre { margin: 8px 0 0; padding: 12px; overflow-x: auto; background: var(--faint); font: 0.72rem / 1.45 var(--mono); white-space: pre; }
pre.prompt { white-space: pre-wrap; overflow-wrap: anywhere; }
.combo { margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--rule); }
details { margin-top: 10px; }
summary { cursor: pointer; font-size: 0.8rem; font-weight: 600; }
.pass { color: var(--sage); font-weight: 600; }
.fail { color: #a2453a; font-weight: 600; }
`;

const NONE = "unavailable";

export function renderReport(
  results: EvalResults,
  artifacts: (apiCellId: string) => CellArtifacts | null,
): string {
  const { manifest, cells, real } = results;
  const setups = new Map(results.setups.map((summary) => [summary.setupKey, summary.setup]));
  const label = (cell: EvalCell) => {
    const setup = setups.get(cell.setupKey);
    return setup == null ? cell.setupKey : setupLabel(setup);
  };
  const task = real?.task;
  const reference = real?.reference ?? null;
  const facts: [string, string][] = [
    ["Run", manifest.id],
    ["Status", manifest.status],
    ["Started", manifest.startedAt],
    ["Ended", manifest.endedAt ?? NONE],
    ...(real == null
      ? []
      : ([
          ["Repository", real.repoPath],
          ["Base commit", real.baseSha],
          [
            "Task",
            task?.type === "replay"
              ? `replay of ${task.sha}`
              : `prompt from ${task?.baseRef ?? ""}`,
          ],
          [
            "Hidden tests",
            task?.type === "replay" && task.hiddenPaths.length > 0
              ? task.hiddenPaths.join(", ")
              : "none",
          ],
          ["Setup command", real.profile.setupCommand ?? "none"],
          ["Checks", real.profile.checks.length > 0 ? real.profile.checks.join(" ; ") : "none"],
          ["Hidden-test command", real.profile.hiddenTestCommand ?? "none"],
        ] as [string, string][])),
    ["Trials", String(manifest.input.trials)],
    ["Wall limit", duration(manifest.input.wallMs)],
    [
      "ach commit",
      `${manifest.provenance.achCommit}${manifest.provenance.achDirty ? " (dirty)" : ""}`,
    ],
  ];

  const summaryRows = [
    reference == null
      ? ""
      : row([
          "Human reference",
          "",
          "reference",
          "",
          "",
          String(reference.diffStat.files.length),
          lines(reference.diffStat),
          "",
          "",
          "",
          "",
          "",
        ]),
    ...cells.map((cell) => {
      const summary = real?.cells[cell.cellId];
      return row([
        label(cell),
        String(cell.trial),
        cell.outcome,
        summary == null
          ? NONE
          : summary.hidden == null
            ? "none"
            : `${summary.hidden.passed}/${summary.hidden.total} passed`,
        summary == null ? NONE : checksLabel(summary.checks),
        summary == null ? NONE : String(summary.diffStat.files.length),
        summary == null ? NONE : lines(summary.diffStat),
        percent(summary?.fileOverlap),
        summary?.sizeRatio == null ? NONE : `${summary.sizeRatio.toFixed(2)}x`,
        cell.agentMs == null ? NONE : duration(cell.agentMs),
        cell.tokens == null
          ? NONE
          : (
              cell.tokens.input +
              cell.tokens.output +
              cell.tokens.cacheRead +
              cell.tokens.cacheWrite
            ).toLocaleString("en-US"),
        cell.cost.kind === "priced"
          ? `$${cell.cost.usd.toFixed(2)}`
          : `${NONE} (${cell.cost.reason})`,
      ]);
    }),
  ];

  const passRates =
    manifest.input.trials > 1
      ? section(
          "Pass rate",
          table(
            ["Combo", "Passed", "Graded", "Pass rate", "Agent p50", "Agent p95", "Spend"],
            results.setups.map((summary) =>
              row([
                setupLabel(summary.setup),
                String(summary.passed),
                String(summary.graded),
                percent(summary.passRate),
                summary.agentP50Ms == null ? NONE : duration(summary.agentP50Ms),
                summary.agentP95Ms == null ? NONE : duration(summary.agentP95Ms),
                summary.spendUsd == null ? NONE : `$${summary.spendUsd.toFixed(2)}`,
              ]),
            ),
          ),
        )
      : "";

  const referencePatch = reference == null ? null : artifacts("reference");
  const combos = [
    reference == null
      ? ""
      : `<article class="combo"><h3>Human reference</h3><p>${esc(`${reference.baseSha}..${reference.sha}`)}, ${esc(diffLabel(reference.diffStat))}</p>${patchDetails(referencePatch, true)}</article>`,
    ...cells.map((cell) =>
      comboArticle(cell, label(cell), real?.cells[cell.cellId] ?? null, artifacts(cell.cellId)),
    ),
  ];

  const transcripts = cells.map((cell) => {
    const summary = real?.cells[cell.cellId];
    return row([
      label(cell),
      String(cell.trial),
      summary?.turns == null ? NONE : String(summary.turns),
      summary?.toolCalls == null ? NONE : String(summary.toolCalls),
      cell.raw.error ?? "none",
    ]);
  });

  const body = [
    `<header class="report-header"><p class="eyebrow">Agent Benchmarks ${real == null ? "benchmark" : "real-task"} report</p><h1>${esc(manifest.input.name)}</h1></header>`,
    section(
      "Run",
      `<dl class="run-facts">${facts.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>`,
    ),
    task == null ? "" : section("Prompt", `<pre class="prompt">${esc(task.prompt)}</pre>`),
    section(
      "Combos",
      table(
        ["Harness", "Model", "Configuration", "Augments", "Harness version"],
        manifest.input.setups.map((setup) =>
          row([
            setup.harness,
            setup.model,
            configLabel(setup),
            setup.augments.join(", ") || "none",
            manifest.provenance.harnessVersions[setup.harness] ?? NONE,
          ]),
        ),
      ),
    ),
    section(
      "Summary",
      table(
        [
          "Entry",
          "Trial",
          "Outcome",
          "Hidden tests",
          "Checks",
          "Files",
          "Lines",
          "Overlap",
          "Size vs human",
          "Agent time",
          "Tokens",
          "Cost",
        ],
        summaryRows,
      ),
    ),
    passRates,
    augmentVerdicts(results.augmentVerdicts),
    section("Changes, checks, and hidden tests", combos.join("")),
    section(
      "Transcript summary",
      table(["Entry", "Trial", "Turns", "Tool calls", "Error"], transcripts),
    ),
    results.warnings.length === 0
      ? ""
      : section(
          "Warnings",
          `<ul>${results.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>`,
        ),
    `<footer class="report-footer">Generated by Agent Benchmarks ${esc(AGENT_BENCHMARKS_VERSION)}. Full transcripts are not included.</footer>`,
  ].join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(manifest.input.name)}</title><style>${REPORT_CSS}${REAL_REPORT_CSS}</style></head><body><main class="report">${body}</main></body></html>`;
}

function comboArticle(
  cell: EvalCell,
  label: string,
  summary: RealCellSummary | null,
  files: CellArtifacts | null,
): string {
  const heading = `<h3>${esc(label)}, trial ${cell.trial}: ${esc(cell.outcome)}</h3>`;
  if (summary == null)
    return `<article class="combo">${heading}<p class="empty">No change or check results recorded.</p></article>`;
  const checks =
    summary.checks.length === 0
      ? `<p class="empty">No checks configured.</p>`
      : table(
          ["Check", "Result", "Duration"],
          summary.checks.map((check) =>
            row([check.command, checkResult(check), duration(check.durationMs)]),
          ),
        );
  const hidden =
    summary.hidden == null
      ? ""
      : summary.hidden.files.length === 0
        ? `<p class="empty">No hidden tests.</p>`
        : `<ul>${summary.hidden.files.map((file) => `<li><span class="${file.passed ? "pass" : "fail"}">${file.passed ? "passed" : "failed"}</span> <code>${esc(file.path)}</code></li>`).join("")}</ul>`;
  const logs = [
    ...(files?.checks ?? []).map((log) => [`Check log: ${log.command}`, log.logTail]),
    ...(files?.hidden ?? []).map((log) => [`Hidden test log: ${log.path}`, log.logTail]),
  ]
    .map(
      ([title, text]) =>
        `<details><summary>${esc(title ?? "")}</summary><pre>${esc(text ?? "")}</pre></details>`,
    )
    .join("");
  return `<article class="combo">${heading}<p>${esc(diffLabel(summary.diffStat))}</p>${checks}${hidden}${patchDetails(files, false)}${logs}</article>`;
}

function patchDetails(files: CellArtifacts | null, open: boolean): string {
  if (files == null) return `<p class="empty">Change ${NONE}.</p>`;
  return `<details${open ? " open" : ""}><summary>Diff</summary><pre>${esc(files.patch === "" ? "(no changes)" : files.patch)}</pre></details>`;
}

function setupLabel(setup: EvalSetup): string {
  const { augments } = setup;
  return [
    setup.harness,
    setup.model,
    configLabel(setup),
    ...(augments.length ? [`+${augments.join(" +")}`] : []),
  ].join(" · ");
}

function configLabel(setup: EvalSetup): string {
  if (setup.config === "clean") return "clean (login only)";
  return setup.config === "current" ? "current configuration" : "default";
}

function signed(value: number, unit: string): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}${unit}`;
}

function augmentVerdicts(verdicts: AugmentVerdict[]): string {
  if (verdicts.length === 0) return "";
  return section(
    "Augments",
    table(
      [
        "Augment set",
        "Verdict",
        "Pairs",
        "Pass delta",
        "Cost or token delta",
        "Better / worse",
        "Prep time",
        "Reason",
      ],
      verdicts.map((v) => {
        const saving = v.savingBasis === "cost" ? v.costDelta : v.tokenDelta;
        return row([
          `${v.harness} · ${v.model} · ${v.config} +${v.augments.join(" +")}`,
          v.verdict,
          String(v.pairs),
          v.passDelta == null ? NONE : signed(v.passDelta, " pts"),
          saving == null || v.savingBasis == null
            ? NONE
            : `${signed(saving, "%")} (${v.savingBasis})`,
          `${v.better} / ${v.worse}`,
          v.prepMs == null ? NONE : duration(v.prepMs),
          v.reason,
        ]);
      }),
    ),
  );
}

function checksLabel(checks: CheckResult[]): string {
  if (checks.length === 0) return "none";
  return `${checks.filter((check) => check.exitCode === 0 && !check.timedOut).length}/${checks.length} passed`;
}

function checkResult(check: CheckResult): string {
  if (check.timedOut) return "timed out";
  return check.exitCode === 0 ? "passed" : `failed (exit ${check.exitCode ?? "none"})`;
}

function diffLabel(stat: DiffStat): string {
  return `${stat.files.length} file${stat.files.length === 1 ? "" : "s"}, ${lines(stat)}`;
}

function lines(stat: DiffStat): string {
  return `+${stat.added} −${stat.removed}`;
}

function percent(value: number | null | undefined): string {
  return value == null ? NONE : `${Math.round(value * 100)}%`;
}

function duration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function section(title: string, content: string): string {
  return `<section class="section"><h2>${esc(title)}</h2>${content}</section>`;
}

function table(headers: string[], rows: string[]): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function row(cells: string[]): string {
  return `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
