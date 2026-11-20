# Implementation Plan: Real-Task Evaluations

**Branch**: `001-real-task-evals` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-real-task-evals/spec.md`, decisions from `handoff-brief.md`, findings in `research.md`.

## Summary

Add a "Real tasks" section to `/evaluating` that runs one free-prompt or replayed-commit task on a private clone of the user's git repository across harness × model × config combos, through the existing `ach trial --matrix` pipeline with `--isolate --cleanup` (one git worktree per cell). A Bun verify script captures each cell's diff, runs the repository's checks and the replay's hidden tests, and writes artifacts next to the run. Results reuse the ledger, session join, and stats, plus a reference diff, a tick-to-compare diff view, and a self-contained HTML report.

## Technical Context

**Language/Version**: TypeScript on Bun 1.3+

**Primary Dependencies**: existing only. React + shadcn UI (`src/ui`), `bun:sqlite`, the external `ach` checkout (`getAchDir()`), `git` on PATH.

**Storage**: files under `<archive dir>/evals/<runId>/` (manifest, plans, ledgers, `repo/` clone, `cells/` artifacts); per-repo profiles in `<archive dir>/evals/repo-profiles.json`. No SQLite schema change.

**Testing**: `bun test` (unit + integration with the `null` harness and synthetic git repos in a temp dir), `bunx tsc --noEmit`, `bunx biome check .`, browser check of the UI.

**Target Platform**: macOS and Linux, loopback `agent-benchmarks serve`.

**Project Type**: single project (CLI + local server + React UI).

**Performance Goals**: run setup (validate + clone + reference diff) under 5 s for a typical repo. Results route stays a file read.

**Constraints**: no outbound network or LLM calls by the app; core modules print-free; user repository never modified; one SQLite owner.

**Scale/Scope**: up to `EVAL_LIMITS.maxSetups` (8) combos × `maxTrials` (10) trials of one task per run.

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template, so the gates are the `AGENTS.md` project invariants.

| Invariant | Status |
|---|---|
| Core modules print-free | Pass. `real-verify.ts` is a subprocess entry like `cli.ts`; library code returns data. |
| One process owns SQLite | Pass. Only the serve process ingests; `ach` and the verify script never open the archive. |
| Local-first, no LLM/network calls | Pass. Harnesses are launched by `ach` as today; the report has no external resources. |
| Costs reflect current pricing | Pass. Costs come from the existing `joinSessionCost` / harness-reported path. |
| Schema constants | Pass. No schema change. |
| Serve routes documented | Action. New routes update `src/route-paths.ts`, `docs/api/openapi.yaml`, `docs/api/routes.md`, contract tests. |

## Design

### Data shape (organizing structure)

- `EvalRunInput` becomes a discriminated union on `kind` (`"benchmark" | "real"`). Legacy manifests without `kind` are parsed as `benchmark` at the read boundary (`readManifest`).
- `EvalSetup.config: "current" | "default"`, required internally; legacy setups parse to `"current"`. `setupKey = harness:model:config`.
- `RealTask` is a union on `type` (`"prompt" | "replay"`).
- Config modes are a **registry table** in `registry.ts`: each harness definition gets `defaultConfig: DefaultConfigSupport | null`, so the UI, validation, and runner read one source instead of branching per harness.
- Run execution is a list of **config groups**. Each group is one `ach` invocation with its own plan file, ledger file, and environment. `ledgerFile(config)` maps `current → ledger.jsonl` (legacy name) and `default → ledger.default.jsonl`.

### Execution

1. `validateRealInput` (boundary): absolute path, `git rev-parse --show-toplevel`, replay `sha^{commit}` exists and has a parent, every hidden path is in `git diff-tree -r --name-only sha`, `baseRef` resolves for prompts, `{file}` present in the hidden-test command when hidden paths exist, per-harness `defaultConfig` support.
2. `git clone --quiet --local <repo> <run>/repo`, then `git -C repo checkout -q -B agent-benchmarks-base <base>` where base is `sha^` (replay) or the resolved `baseRef` (prompt). The agent never sees the commit's new tests because they do not exist at `sha^`; at verify time `git checkout <sha> -- <hiddenPaths>` applies them.
3. Reference (replay): `git diff --numstat sha^ sha` and `git diff --binary sha^ sha` saved to `<run>/reference/`.
4. One inline task per run: `{id: "prompt" | "replay-<sha7>", prompt, cwd: <run>/repo, setup?: repo setup command, verify: "bun <agent-benchmarks>/src/eval/real-verify.ts", verifyTimeoutMs}`. Workspace is `shared`, so `--isolate` gives each cell a worktree off `HEAD` (= base) and runs setup and verify inside it.
5. Groups run sequentially in one runner lifecycle. `current` env sets `AGENTIC_CODING_HARNESS_DEFAULT_CLAUDE_CONFIG=1` (Claude uses `~/.claude`, keychain login works, sessions land in `~/.claude/projects`). `default` env leaves Claude on `ach`'s per-run `CLAUDE_CONFIG_DIR` and sets `CODEX_HOME=<run>/home/codex` with only `~/.codex/auth.json` copied (mode 0600). A default Claude setup without `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` is not scheduled; the runner appends a `skipped-unavailable` ledger row with the reason.
6. `real-verify.ts` (env from `ach`: `ACH_CELL_ID`, `ACH_WORKSPACE`; from the runner: `AGENT_BENCHMARKS_REAL_SPEC=<run>/real-spec.json`, `AGENT_BENCHMARKS_REAL_GROUP`): `git add -A` then `git diff --cached --binary <baseSha>` to `diff.patch` and `--numstat` to the diff stat; runs each check with `Bun.spawn` and a per-check timeout, logs to `checks/<i>.log`; for replays checks out hidden paths from `sha` and runs the hidden-test command once per file; writes `result.json`; exits 0 for prompts, and for replays 0 only when every hidden file passed (no hidden files: 0).
7. After the last group: the normal sync, plus a targeted sync of `<run>/ach-state/claude-runs` and `<run>/home/codex` so default-config sessions join.

### Outcome rule

`toCellOutcome` counts `passed` only when verify passed **and** `exitStatus` is `success` (or absent for legacy rows). Checks never change the outcome. Fixes the latent case where an agent error followed by a passing verify reads as `passed`.

### Results and report

- `GET /api/evals/{id}` keeps `EvalResults`; for real runs it adds `real: {task, repo, reference, cells: Record<cellId, RealCellSummary>}` (diff stat, overlap, size ratio, checks without log text, hidden counts, turns, tool calls).
- `GET /api/evals/{id}/cells/{cellId}` returns the patch text and check log tails for the compare view.
- `GET /api/evals/{id}/report.html` renders the self-contained report (inline CSS, no scripts, transcript summary only).
- `GET /api/evals/repo?path=&sha=` returns the remembered or detected repo profile, recent commits, and (with `sha`) the commit subject/body, changed files, and suggested hidden paths.

### UI

`/evaluating` gets Tabs `Benchmark | Real tasks`. Real tasks has `RealTaskForm` (repo, task type, commit picker, prompt, hidden tests, setup/check/hidden-test commands, combo table with `current configuration` / `default` checkboxes, `default` disabled with reason when unsupported, trials, wall) and `RealResults` (summary table with human reference row, tick-to-compare side-by-side diffs with the human diff ticked by default, tabs Diff / Transcript / Check logs, Export button).

## Project Structure

### Documentation (this feature)

```text
specs/001-real-task-evals/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/eval/types.ts          # union input, config mode, real artifacts types
src/eval/registry.ts       # defaultConfig support table, real-task limits
src/eval/real.ts           # validate, clone, reference, plan groups, repo profile, artifacts read
src/eval/real-verify.ts    # subprocess entry run by ach as the cell verify
src/eval/report.ts         # HTML report renderer (pure)
src/eval/runner.ts         # config groups, real-run start, resume, cancel
src/eval/ledger.ts         # per-group ledgers, config-aware cell ids, outcome rule
src/eval/stats.ts          # setupKey with config
src/server/routes.ts       # new routes
src/route-paths.ts
src/ui/views/evaluating.tsx
src/ui/views/evaluating/real-form.tsx
src/ui/views/evaluating/real-results.tsx
docs/api/openapi.yaml, docs/api/routes.md, docs/data-lifecycle.md
test/eval-real*.test.ts, test/eval-report.test.ts, contract tests, test/ui-evaluating.test.ts
```

**Structure Decision**: single project; real-task logic gathers in `src/eval/real.ts` (one body of domain knowledge) instead of spreading across runner phases.

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| Sequential `ach` invocations per config group | `ach` reads the Claude default-config switch and `CODEX_HOME` from its process env, not per cell | Custom per-config agent descriptors lose the built-in Claude/Codex adapters (metering, session ids) |
| Separate verify script instead of a shell string | Per-check timeouts, JSON artifacts, portable on macOS (no `timeout(1)`) | A shell verify needs GNU coreutils and string-escaping of user commands |
