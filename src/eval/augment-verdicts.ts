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
  /** Task identity: the task id within a run, or id plus content hash across runs. */
  taskKey: string;
  base: EvalCell;
  aug: EvalCell;
  /** False when the augmented cell errored instead of being graded; it counts as a failure. */
  graded: boolean;
}

/** Outcomes the augment itself can cause; a graded baseline makes them a failed pair, not a dropped one. */
const AUGMENT_FAILURE: Partial<Record<EvalCell["outcome"], true>> = {
  "agent-error": true,
  "setup-error": true,
};

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

function buildPairs(
  cells: readonly EvalCell[],
  baseKey: string,
  augKey: string,
  taskKey: (taskId: string) => string = (taskId) => taskId,
): Pair[] {
  const baseByCell = new Map<string, EvalCell>();
  for (const cell of cells) {
    if (cell.setupKey === baseKey && GRADED_OUTCOME[cell.outcome]) {
      baseByCell.set(`${cell.taskId}\0${cell.trial}`, cell);
    }
  }
  const pairs: Pair[] = [];
  for (const aug of cells) {
    if (aug.setupKey !== augKey) continue;
    const graded = GRADED_OUTCOME[aug.outcome];
    if (!graded && !AUGMENT_FAILURE[aug.outcome]) continue;
    const base = baseByCell.get(`${aug.taskId}\0${aug.trial}`);
    if (base) pairs.push({ taskKey: taskKey(aug.taskId), base, aug, graded });
  }
  return pairs;
}

/** Relative change over pairs graded in both arms; null unless every such pair carries the value. */
function relativeDelta(
  pairs: readonly Pair[],
  read: (cell: EvalCell) => number | null,
): number | null {
  const graded = pairs.filter((pair) => pair.graded);
  const both = graded
    .map((pair) => [read(pair.base), read(pair.aug)] as const)
    .filter((v): v is readonly [number, number] => v[0] != null && v[1] != null);
  if (both.length === 0 || both.length !== graded.length) return null;
  const base = mean(both.map((v) => v[0]));
  return base === 0 ? null : mean(both.map((v) => v[1])) / base - 1;
}

function pct(value: number): string {
  return `${(Math.abs(value) * 100).toFixed(0)}%`;
}

function verdictFor(all: readonly Pair[]): VerdictFields {
  const rules = AUGMENT_VERDICT_RULES;
  const perTask = new Map<string, number>();
  for (const pair of all) perTask.set(pair.taskKey, (perTask.get(pair.taskKey) ?? 0) + 1);
  // Tasks under the trial floor are left out whole, so a one-off run cannot veto a pooled sample.
  const pairs = all.filter((pair) => (perTask.get(pair.taskKey) ?? 0) >= rules.minTrials);
  const counts = [...perTask.values()];
  const keptTrials = counts.filter((n) => n >= rules.minTrials);
  const minTrials = Math.min(...(keptTrials.length ? keptTrials : counts.length ? counts : [0]));
  const thin = all.length - pairs.length;
  const passed = (cell: EvalCell) => cell.outcome === "passed";
  const better = pairs.filter((p) => passed(p.aug) && !passed(p.base)).length;
  const worse = pairs.filter((p) => !passed(p.aug) && passed(p.base)).length;
  const passDelta = pairs.length
    ? (pairs.filter((p) => passed(p.aug)).length - pairs.filter((p) => passed(p.base)).length) /
      pairs.length
    : null;
  const tokenDelta = relativeDelta(pairs, totalTokens);
  const costDelta = relativeDelta(pairs, costUsd);
  const savingBasis = costDelta != null ? "cost" : tokenDelta != null ? "tokens" : null;
  const delta = costDelta ?? tokenDelta;
  const prep = pairs.map((p) => p.aug.prepMs).filter((v): v is number => v != null);

  let verdict: AugmentVerdictKind;
  let reason: string;
  if (pairs.length < rules.minPairs) {
    verdict = "inconclusive";
    reason = `${pairs.length} graded pairs on tasks with at least ${rules.minTrials} trials${thin ? ` (${thin} more on thinner tasks left out)` : ""}; needs ${rules.minPairs}.`;
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
    /** Task id to content hash; a task without one only pools with itself in the same run. */
    taskHashes: Record<string, string>;
    /** Augment id to the hash of the definition the run executed. */
    augmentHashes: Record<AugmentId, string>;
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
      recipes: Set<string>;
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
        pool = {
          id: { harness, model, config, augments },
          harnessVersion,
          runIds: [],
          pairs: [],
          recipes: new Set(),
        };
        pools.set(key, pool);
      }
      const pairs = buildPairs(run.cells, setupKey(baseline), setupKey(setup), (taskId) => {
        const hash = run.taskHashes[taskId];
        return hash == null ? `${run.runId}:${taskId}` : `${taskId}@${hash}`;
      });
      if (pairs.length === 0) continue;
      pool.runIds.push(run.runId);
      pool.pairs.push(...pairs);
      pool.recipes.add(JSON.stringify(augments.map((id) => run.augmentHashes[id] ?? null)));
    }
  }
  return [...pools.values()].map((pool) => ({
    ...pool.id,
    harnessVersion: pool.harnessVersion,
    runIds: [...new Set(pool.runIds)],
    recipeDrift: pool.recipes.size > 1,
    ...verdictFor(pool.pairs),
  }));
}
