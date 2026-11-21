import { setupKey } from "./stats.ts";
import {
  type AugmentId,
  type AugmentPoolEntry,
  type AugmentVerdict,
  type AugmentVerdictKind,
  type EvalCell,
  type EvalConfigMode,
  type EvalHarness,
  type EvalSetup,
  GRADED_OUTCOME,
} from "./types.ts";

export const AUGMENT_VERDICT_RULES = {
  minPairs: 20,
  minTrials: 3,
  minSaving: 0.1,
  qualityDrop: 0.05,
  worseMargin: 2,
} as const;

interface Pair {
  taskId: string;
  base: EvalCell;
  aug: EvalCell;
}

type VerdictFields = Omit<
  AugmentVerdict,
  "baseline" | "augmented" | "harness" | "model" | "config" | "augments"
>;

function totalTokens(cell: EvalCell): number | null {
  const t = cell.tokens;
  return t ? t.input + t.output + t.cacheRead + t.cacheWrite : null;
}

function costUsd(cell: EvalCell): number | null {
  return cell.cost.kind === "priced" ? cell.cost.usd : null;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildPairs(cells: readonly EvalCell[], baseKey: string, augKey: string): Pair[] {
  const baseByCell = new Map<string, EvalCell>();
  for (const cell of cells) {
    if (cell.setupKey === baseKey && GRADED_OUTCOME[cell.outcome]) {
      baseByCell.set(`${cell.taskId}\0${cell.trial}`, cell);
    }
  }
  const pairs: Pair[] = [];
  for (const aug of cells) {
    if (aug.setupKey !== augKey || !GRADED_OUTCOME[aug.outcome]) continue;
    const base = baseByCell.get(`${aug.taskId}\0${aug.trial}`);
    if (base) pairs.push({ taskId: aug.taskId, base, aug });
  }
  return pairs;
}

function relativeDelta(
  pairs: readonly Pair[],
  read: (cell: EvalCell) => number | null,
  requireAll: boolean,
): number | null {
  const both = pairs
    .map((pair) => [read(pair.base), read(pair.aug)] as const)
    .filter((v): v is readonly [number, number] => v[0] != null && v[1] != null);
  if (both.length === 0 || (requireAll && both.length !== pairs.length)) return null;
  const base = mean(both.map((v) => v[0]));
  return base === 0 ? null : mean(both.map((v) => v[1])) / base - 1;
}

function pct(value: number): string {
  return `${(Math.abs(value) * 100).toFixed(0)}%`;
}

function verdictFor(pairs: readonly Pair[]): VerdictFields {
  const rules = AUGMENT_VERDICT_RULES;
  const perTask = new Map<string, number>();
  for (const pair of pairs) perTask.set(pair.taskId, (perTask.get(pair.taskId) ?? 0) + 1);
  const minTrials = perTask.size ? Math.min(...perTask.values()) : 0;
  const passed = (cell: EvalCell) => cell.outcome === "passed";
  const better = pairs.filter((p) => passed(p.aug) && !passed(p.base)).length;
  const worse = pairs.filter((p) => !passed(p.aug) && passed(p.base)).length;
  const passDelta = pairs.length
    ? (pairs.filter((p) => passed(p.aug)).length - pairs.filter((p) => passed(p.base)).length) /
      pairs.length
    : null;
  const tokenDelta = relativeDelta(pairs, totalTokens, false);
  const costDelta = relativeDelta(pairs, costUsd, true);
  const savingBasis = costDelta != null ? "cost" : tokenDelta != null ? "tokens" : null;
  const delta = costDelta ?? tokenDelta;
  const prep = pairs.map((p) => p.aug.prepMs).filter((v): v is number => v != null);

  let verdict: AugmentVerdictKind;
  let reason: string;
  if (pairs.length < rules.minPairs || minTrials < rules.minTrials) {
    verdict = "inconclusive";
    reason = `${pairs.length} graded pairs with at least ${minTrials} trials per task; needs ${rules.minPairs} pairs and ${rules.minTrials} trials per task.`;
  } else if ((passDelta ?? 0) <= -rules.qualityDrop || worse - better >= rules.worseMargin) {
    verdict = "quality-risk";
    reason = `The augmented arm passed ${better} pairs the baseline failed and failed ${worse} the baseline passed (pass rate change ${((passDelta ?? 0) * 100).toFixed(1)} points).`;
  } else if (delta == null) {
    verdict = "inconclusive";
    reason = "No paired cells carry token or cost data, so the saving cannot be measured.";
  } else if (delta <= -rules.minSaving && (passDelta ?? 0) >= 0 && worse <= better) {
    verdict = "adopt";
    reason = `${pct(delta)} lower ${savingBasis} over ${pairs.length} pairs with no loss in passes.`;
  } else {
    verdict = "no-saving";
    reason =
      delta <= -rules.minSaving
        ? `${pct(delta)} lower ${savingBasis}, but the augmented arm lost passes (${better} better, ${worse} worse).`
        : delta < 0
          ? `Only ${pct(delta)} lower ${savingBasis}; at least ${pct(rules.minSaving)} is needed.`
          : `${delta === 0 ? "No change in" : `${pct(delta)} higher`} ${savingBasis} over ${pairs.length} pairs.`;
  }
  return {
    pairs: pairs.length,
    minTrials,
    passDelta,
    better,
    worse,
    tokenDelta,
    costDelta,
    savingBasis,
    prepMs: prep.length ? mean(prep) : null,
    verdict,
    reason,
  };
}

function baselineOf(setup: EvalSetup, setups: readonly EvalSetup[]): EvalSetup | undefined {
  return setups.find(
    (other) =>
      other.augments.length === 0 &&
      other.harness === setup.harness &&
      other.model === setup.model &&
      other.config === setup.config,
  );
}

export function augmentVerdicts(
  cells: readonly EvalCell[],
  setups: readonly EvalSetup[],
): AugmentVerdict[] {
  const out: AugmentVerdict[] = [];
  for (const setup of setups) {
    if (setup.augments.length === 0) continue;
    const baseline = baselineOf(setup, setups);
    if (!baseline) continue;
    const { harness, model, config, augments } = setup;
    const baseKey = setupKey(baseline);
    const augKey = setupKey(setup);
    out.push({
      baseline: baseKey,
      augmented: augKey,
      harness,
      model,
      config,
      augments,
      ...verdictFor(buildPairs(cells, baseKey, augKey)),
    });
  }
  return out;
}

export function poolAugmentVerdicts(
  runs: readonly {
    runId: string;
    harnessVersions: Partial<Record<EvalHarness, string>>;
    cells: readonly EvalCell[];
    setups: readonly EvalSetup[];
  }[],
): AugmentPoolEntry[] {
  const pools = new Map<
    string,
    {
      id: { harness: EvalHarness; model: string; config: EvalConfigMode; augments: AugmentId[] };
      harnessVersion: string | null;
      runIds: string[];
      pairs: Pair[];
    }
  >();
  for (const run of runs) {
    for (const setup of run.setups) {
      if (setup.augments.length === 0) continue;
      const baseline = baselineOf(setup, run.setups);
      if (!baseline) continue;
      const { harness, model, config, augments } = setup;
      const harnessVersion = run.harnessVersions[harness] ?? null;
      const key = JSON.stringify([harness, harnessVersion, model, config, augments]);
      let pool = pools.get(key);
      if (!pool) {
        pool = { id: { harness, model, config, augments }, harnessVersion, runIds: [], pairs: [] };
        pools.set(key, pool);
      }
      const pairs = buildPairs(run.cells, setupKey(baseline), setupKey(setup));
      if (pairs.length === 0) continue;
      pool.runIds.push(run.runId);
      pool.pairs.push(...pairs);
    }
  }
  return [...pools.values()].map((pool) => ({
    ...pool.id,
    harnessVersion: pool.harnessVersion,
    runIds: [...new Set(pool.runIds)],
    ...verdictFor(pool.pairs),
  }));
}
