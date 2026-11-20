# Data Model: Real-Task Evaluations

```ts
type EvalConfigMode = "current" | "default";

interface EvalSetup { harness: EvalHarness; model: string; config: EvalConfigMode }

interface RepoProfile {
  setupCommand: string | null;       // run in each cell worktree before the agent
  checks: string[];                  // each run per cell, recorded, never decides outcome
  hiddenTestCommand: string | null;  // must contain "{file}" when hidden paths exist
}

type RealTask =
  | { type: "prompt"; prompt: string; baseRef: string }
  | { type: "replay"; sha: string; prompt: string; hiddenPaths: string[] };

interface BenchmarkRunInput {
  kind: "benchmark"; name: string; setups: EvalSetup[];
  taskIds: string[]; trials: number; wallMs: number; preset: EvalPresetId;
}

interface RealRunInput {
  kind: "real"; name: string; setups: EvalSetup[]; trials: number; wallMs: number;
  repoPath: string; task: RealTask; profile: RepoProfile;
}

type EvalRunInput = BenchmarkRunInput | RealRunInput;

interface DiffStat { files: string[]; added: number; removed: number }

interface CheckResult {
  command: string; exitCode: number | null; timedOut: boolean; durationMs: number; log: string; // log = relative path
}

interface RealCellSummary {
  diffStat: DiffStat;
  checks: CheckResult[];
  hidden: { passed: number; total: number; files: { path: string; passed: boolean }[] } | null;
  fileOverlap: number | null;   // replay: |agent ∩ (human − hidden)| / |human − hidden|
  sizeRatio: number | null;     // replay: (added+removed) / human non-hidden (added+removed)
  turns: number | null;
  toolCalls: number | null;
}

interface RealReference { baseSha: string; sha: string | null; diffStat: DiffStat; nonHidden: DiffStat }

interface RealResults {
  task: RealTask; repoPath: string; baseSha: string; profile: RepoProfile;
  reference: RealReference | null;          // null for prompt tasks
  cells: Record<string, RealCellSummary>;   // keyed by EvalCell.cellId
}

// EvalResults gains: real: RealResults | null
// EvalRunManifest.provenance.hermeticRoot becomes string | null (real runs are not hermetic)
```

## Files per run (`evals/<runId>/`)

| Path | Content |
|---|---|
| `manifest.json` | `EvalRunManifest` |
| `plan.json`, `plan.default.json` | `ach` matrix plan per config group (absent when the group is empty) |
| `ledger.jsonl`, `ledger.default.jsonl` | `ach` ledger per group |
| `real-spec.json` | what `real-verify.ts` needs: baseSha, sha, hiddenPaths, profile, run dir |
| `repo/` | private clone; branch `agent-benchmarks-base` at the base |
| `reference/diff.patch`, `reference/stat.json` | human change (replay) |
| `home/codex/` | clean Codex home for the default group |
| `cells/<group>/<safeCellId>/` | `diff.patch`, `result.json`, `checks/<i>.log`, `hidden/<i>.log` |
| `repo-profiles.json` (in `evals/`) | `Record<realpath, RepoProfile>` |

## Cell id

`ach` cell id stays `agent:task:model:trialN`. Uniqueness across config groups comes from the separate ledger and artifact directories; `EvalCell.cellId` exposed by the API is `<config>/<achCellId>` so it is unique within a run.

## State

Run status keeps the existing machine (`running → completed | failed | cancelled | cancel-incomplete | interrupted`). A run is `running` from the first group's spawn until the last group exits; a non-zero exit of any group marks the run `failed` after the remaining groups are skipped.
