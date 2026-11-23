import { achModel } from "./efforts.ts";
import {
  type EvalCell,
  type EvalSetup,
  GRADED_OUTCOME,
  type Interval,
  type PairedComparison,
  type SetupSummary,
} from "./types.ts";

export function setupKey(setup: EvalSetup): string {
  const key = `${setup.harness}:${achModel(setup)}:${setup.config}`;
  return setup.augments.length === 0 ? key : `${key}+${setup.augments.join("+")}`;
}

export function summarizeSetups(
  cells: readonly EvalCell[],
  setups: readonly EvalSetup[],
  taskIds: readonly string[],
  trials: number,
): SetupSummary[] {
  const bySetup = new Map(setups.map((setup) => [setupKey(setup), setup]));
  const ran = setups.filter((setup) =>
    cells.some((cell) => cell.setupKey === setupKey(setup) && cell.outcome !== "unavailable"),
  );
  const common = taskIds.filter((taskId) =>
    ran.every((setup) =>
      cells.some(
        (cell) =>
          cell.taskId === taskId &&
          cell.setupKey === setupKey(setup) &&
          GRADED_OUTCOME[cell.outcome],
      ),
    ),
  );
  return setups.map((setup) => {
    const key = setupKey(setup);
    const eligible = ran.includes(setup) ? common : [];
    const own = cells.filter((cell) => cell.setupKey === key);
    const graded = own.filter((cell) => GRADED_OUTCOME[cell.outcome]);
    const passed = graded.filter((cell) => cell.outcome === "passed").length;
    const rates = eligible.map((taskId) => taskRate(graded, taskId));
    const passRate = rates.length ? mean(rates) : null;
    const priced = own.filter((cell) => cell.cost.kind === "priced");
    const subtotal = priced.reduce(
      (sum, cell) => sum + (cell.cost.kind === "priced" ? cell.cost.usd : 0),
      0,
    );
    const expected = taskIds.length * trials;
    const allPriced =
      own.length >= expected && priced.length === expected && own.length === expected;
    const eligibleTaskTrials = eligible.map((taskId) =>
      graded.filter((cell) => cell.taskId === taskId),
    );
    const kReady =
      eligibleTaskTrials.length > 0 && eligibleTaskTrials.every((rows) => rows.length >= trials);
    const kUnavailableReason = kReady
      ? null
      : eligible.length === 0
        ? "no task is graded for every setup"
        : `at least one common task has fewer than ${trials} graded trials`;
    const passAtK = kReady
      ? mean(
          eligibleTaskTrials.map((rows) =>
            anyPassAtK(
              rows.filter((cell) => cell.outcome === "passed").length,
              rows.length,
              trials,
            ),
          ),
        )
      : null;
    const passHatK = kReady
      ? mean(
          eligibleTaskTrials.map((rows) =>
            allPassAtK(
              rows.filter((cell) => cell.outcome === "passed").length,
              rows.length,
              trials,
            ),
          ),
        )
      : null;
    const agentTimes = graded
      .map((cell) => cell.agentMs)
      .filter((value): value is number => value != null);
    const outcomes = emptyOutcomes();
    for (const cell of own) outcomes[cell.outcome]++;
    return {
      setupKey: key,
      setup: bySetup.get(key)!,
      planned: expected,
      attempted: own.filter((cell) => cell.outcome !== "pending").length,
      graded: graded.length,
      passed,
      passRate,
      passRateCi:
        trials === 1 && eligible.length > 0 && passRate != null
          ? wilson(passedInEligible(graded, eligible), eligible.length)
          : null,
      eligibleTasks: eligible.length,
      k: trials,
      passAtK,
      passHatK,
      kUnavailableReason,
      spendUsd: allPriced ? subtotal : null,
      pricedSubtotalUsd: subtotal,
      priced: { priced: priced.length, total: own.length },
      costPerSolvedUsd: allPriced && passed > 0 ? subtotal / passed : null,
      timePerSolvedMs:
        passed > 0 ? agentTimes.reduce((sum, value) => sum + value, 0) / passed : null,
      agentP50Ms: percentile(agentTimes, 0.5),
      agentP95Ms: percentile(agentTimes, 0.95),
      outcomes,
    };
  });
}

export function pairedComparisons(
  cells: readonly EvalCell[],
  setups: readonly EvalSetup[],
): PairedComparison[] {
  const pairs: PairedComparison[] = [];
  const taskIds = [...new Set(cells.map((cell) => cell.taskId))].sort();
  for (const baselineSetup of setups) {
    for (const otherSetup of setups) {
      const baseline = setupKey(baselineSetup);
      const other = setupKey(otherSetup);
      if (baseline === other) continue;
      let better = 0;
      let worse = 0;
      let tied = 0;
      let tasks = 0;
      for (const taskId of taskIds) {
        const a = taskCells(cells, baseline, taskId);
        const b = taskCells(cells, other, taskId);
        if (a == null || b == null) continue;
        tasks++;
        const delta = rate(a) - rate(b);
        if (delta > 0) worse++;
        else if (delta < 0) better++;
        else tied++;
      }
      const discordant = better + worse;
      pairs.push({
        baseline,
        other,
        tasks,
        better,
        worse,
        tied,
        verdict:
          discordant >= 6 && better === discordant
            ? "consistently-better"
            : discordant >= 6 && worse === discordant
              ? "consistently-worse"
              : "inconclusive",
      });
    }
  }
  return pairs;
}

function taskCells(cells: readonly EvalCell[], key: string, taskId: string): EvalCell[] | null {
  const rows = cells.filter(
    (cell) => cell.setupKey === key && cell.taskId === taskId && GRADED_OUTCOME[cell.outcome],
  );
  return rows.length ? rows : null;
}

function taskRate(cells: readonly EvalCell[], taskId: string): number {
  const rows = cells.filter((cell) => cell.taskId === taskId);
  return rows.length ? rate(rows) : 0;
}

function rate(rows: readonly EvalCell[]): number {
  return rows.filter((cell) => cell.outcome === "passed").length / rows.length;
}

function passedInEligible(cells: readonly EvalCell[], tasks: readonly string[]): number {
  return tasks.filter((taskId) =>
    cells.some((cell) => cell.taskId === taskId && cell.outcome === "passed"),
  ).length;
}

function allPassAtK(passed: number, n: number, k: number): number {
  return choose(passed, k) / choose(n, k);
}

function anyPassAtK(passed: number, n: number, k: number): number {
  return 1 - choose(n - passed, k) / choose(n, k);
}

function choose(n: number, k: number): number {
  if (k < 0 || n < k) return 0;
  if (k === 0) return 1;
  let value = 1;
  for (let i = 1; i <= k; i++) value = (value * (n - k + i)) / i;
  return value;
}

function wilson(passed: number, total: number): Interval {
  const p = passed / total;
  const z = 1.959963984540054;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
  return { p, lo: Math.max(0, center - margin), hi: Math.min(1, center + margin) };
}

function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emptyOutcomes(): SetupSummary["outcomes"] {
  return {
    passed: 0,
    "verify-failed": 0,
    timeout: 0,
    "budget-stop": 0,
    "agent-error": 0,
    "setup-error": 0,
    "verifier-error": 0,
    "provider-limit": 0,
    unavailable: 0,
    pending: 0,
  };
}
