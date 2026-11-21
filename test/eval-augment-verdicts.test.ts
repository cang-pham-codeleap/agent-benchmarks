import { describe, expect, test } from "bun:test";
import { augmentVerdicts, poolAugmentVerdicts } from "../src/eval/augment-verdicts.ts";
import type { CellOutcome, EvalCell, EvalSetup } from "../src/eval/types.ts";

const base: EvalSetup = { harness: "claude", model: "haiku", config: "clean", augments: [] };
const aug: EvalSetup = { ...base, augments: ["rtk"] };
const setups = [base, aug];
const BASE_KEY = "claude:haiku:clean";
const AUG_KEY = "claude:haiku:clean+rtk";

function cell(
  setupKey: string,
  taskId: string,
  trial: number,
  tokens: number | null,
  usd: number | null,
  outcome: CellOutcome = "passed",
): EvalCell {
  return {
    cellId: `${setupKey}/${taskId}/${trial}`,
    setupKey,
    taskId,
    trial,
    outcome,
    agentMs: 1,
    verifyMs: 1,
    prepMs: setupKey === AUG_KEY ? 100 : null,
    endToEndMs: 2,
    tokens: tokens == null ? null : { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost:
      usd == null
        ? { kind: "unpriced", reason: "test" }
        : { kind: "priced", usd, basis: "harness-reported" },
    observedModel: null,
    session: null,
    raw: { status: "done", exitStatus: null, verify: null, error: null, runId: null },
  } as EvalCell;
}

function arms(
  tasks: number,
  trials: number,
  saving: number,
  opts: { priced?: boolean; augOutcome?: (i: number) => CellOutcome; taskPrefix?: string } = {},
): EvalCell[] {
  const out: EvalCell[] = [];
  let i = 0;
  for (let t = 0; t < tasks; t++) {
    for (let n = 1; n <= trials; n++, i++) {
      const id = `${opts.taskPrefix ?? "t"}${t}`;
      const priced = opts.priced ?? true;
      out.push(cell(BASE_KEY, id, n, 1000, priced ? 1 : null));
      out.push(
        cell(AUG_KEY, id, n, 1000 * (1 - saving), priced ? 1 - saving : null, opts.augOutcome?.(i)),
      );
    }
  }
  return out;
}

const only = (cells: EvalCell[]) => {
  const [verdict] = augmentVerdicts(cells, setups);
  if (!verdict) throw new Error("no verdict");
  return verdict;
};

describe("augment verdicts", () => {
  test("below the sample floor is inconclusive despite a big saving", () => {
    const v = only(arms(5, 3, 0.5));
    expect(v.pairs).toBe(15);
    expect(v.verdict).toBe("inconclusive");
  });

  test("20% cheaper with equal passes at 21 pairs x 3 trials is adopt", () => {
    const v = only(arms(7, 3, 0.2));
    expect(v.pairs).toBe(21);
    expect(v.minTrials).toBe(3);
    expect(v.savingBasis).toBe("cost");
    expect(v.costDelta).toBeCloseTo(-0.2);
    expect(v.verdict).toBe("adopt");
    expect(v.prepMs).toBe(100);
  });

  test("losing two passes is quality-risk", () => {
    const v = only(arms(7, 3, 0.2, { augOutcome: (i) => (i < 2 ? "verify-failed" : "passed") }));
    expect(v.worse).toBe(2);
    expect(v.verdict).toBe("quality-risk");
  });

  test("a 5% saving is no-saving", () => {
    expect(only(arms(7, 3, 0.05)).verdict).toBe("no-saving");
  });

  test("unpriced cells fall back to the token basis", () => {
    const v = only(arms(7, 3, 0.2, { priced: false }));
    expect(v.costDelta).toBeNull();
    expect(v.savingBasis).toBe("tokens");
    expect(v.verdict).toBe("adopt");
  });

  test("an augment that errors the agent counts as a failed pair", () => {
    const v = only(arms(7, 3, 0.2, { augOutcome: (i) => (i < 3 ? "agent-error" : "passed") }));
    expect(v.pairs).toBe(21);
    expect(v.worse).toBe(3);
    expect(v.verdict).toBe("quality-risk");
  });

  test("infrastructure outcomes are left out of the pairs", () => {
    const v = only(arms(7, 3, 0.2, { augOutcome: (i) => (i < 3 ? "provider-limit" : "passed") }));
    expect(v.pairs).toBe(18);
    expect(v.verdict).toBe("inconclusive");
  });

  test("a saving measured on only some pairs is not claimed", () => {
    const cells = arms(7, 3, 0.2, { priced: false });
    const first = cells.find((c) => c.setupKey === AUG_KEY);
    if (first) first.tokens = null;
    const v = only(cells);
    expect(v.tokenDelta).toBeNull();
    expect(v.verdict).toBe("inconclusive");
  });

  test("setups without a baseline produce no verdict", () => {
    expect(augmentVerdicts(arms(7, 3, 0.2), [aug])).toEqual([]);
  });

  const run = (runId: string, harness = "1.0", taskHashes: Record<string, string> = {}) => ({
    runId,
    harnessVersions: { claude: harness },
    taskHashes,
    cells: arms(4, 3, 0.2),
    setups,
  });
  const sameTasks = { t0: "h0", t1: "h1", t2: "h2", t3: "h3" };

  test("pooling two small runs of the same tasks reaches adopt", () => {
    const [a] = poolAugmentVerdicts([run("a", "1.0", sameTasks)]);
    expect(a?.verdict).toBe("inconclusive");
    const pooled = poolAugmentVerdicts([run("a", "1.0", sameTasks), run("b", "1.0", sameTasks)]);
    expect(pooled).toHaveLength(1);
    expect(pooled[0]?.pairs).toBe(24);
    expect(pooled[0]?.minTrials).toBe(6);
    expect(pooled[0]?.runIds).toEqual(["a", "b"]);
    expect(pooled[0]?.verdict).toBe("adopt");
  });

  test("tasks without a content hash do not merge trials across runs", () => {
    const [pooled] = poolAugmentVerdicts([run("a"), run("b")]);
    expect(pooled?.minTrials).toBe(3);
  });

  test("changed task content does not merge trials across runs", () => {
    const changed = { t0: "x0", t1: "x1", t2: "x2", t3: "x3" };
    const [pooled] = poolAugmentVerdicts([run("a", "1.0", sameTasks), run("b", "1.0", changed)]);
    expect(pooled?.minTrials).toBe(3);
  });

  test("different harness versions are pooled separately", () => {
    expect(poolAugmentVerdicts([run("a", "1"), run("b", "2")])).toHaveLength(2);
  });

  test("a one-trial run pooled with a full run leaves its thin tasks out", () => {
    const oneOff = { ...run("b"), cells: arms(1, 1, 0.5, { taskPrefix: "solo" }) };
    const full = { ...run("a", "1.0"), cells: arms(7, 3, 0.2) };
    const [pooled] = poolAugmentVerdicts([full, oneOff]);
    expect(pooled?.pairs).toBe(21);
    expect(pooled?.minTrials).toBe(3);
    expect(pooled?.verdict).toBe("adopt");
  });
});
