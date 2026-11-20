## Goal
Let a user run real coding tasks (a free prompt or a replayed merged commit) on their own git repository across chosen harness × model × config combos, and get objective, side-by-side results (metrics, diffs, check output) that a reviewer can compare with their own daily work and export as a shareable report.

## Scope — in
- New "Real tasks" sub-section of `/evaluating`, with its own form and run history, next to the existing "Benchmark" sub-section.
- Task source B — free prompt: repo path + base ref + prompt.
- Task source C — replay a merged commit: repo path + commit SHA; prompt prefilled from the commit message (editable); test files of that commit (auto-detected by glob, user can remove entries) are hidden from the agent and applied only at verify time.
- Per-repo remembered check commands (e.g. `bun test`, `bunx tsc --noEmit`, `bunx biome check .`); each runs with its own timeout and is recorded, not used as the outcome.
- Combo = harness × model × config; each harness × model row has two checkboxes, `current configuration` and `default`; checking both yields two combos in the same run.
- Objective metrics per cell: outcome, hidden-test pass count (replay), check results, diff stat (files, +/−), file overlap and size ratio vs the human diff (replay), tokens, USD cost, wall/agent time, turns and tool calls (from synced sessions), multi-trial pass rate and spread.
- Results page: summary table on top (human reference row for replay); below, tick 2–3 combos (human diff ticked by default) to view diffs side by side; tabs Diff / Transcript / Check logs.
- Export: one self-contained static HTML report per run (inline CSS, no external JS, no network), with transcript summary only.
- Data kept with full diffs and metadata so an automated judge step can be added later without a schema change.

## Scope — out
- Ticket source (Jira / GitHub issue) — deferred; later just a way to prefill the prompt for source B.
- In-app human scoring/rating — reviewers evaluate in other software after reading the metrics and actual results.
- LLM-as-judge — deferred (runtime must not call LLMs; a future judge would run as a harness via `ach`).
- Full transcript text in the exported report — privacy risk (paths, secrets); full text stays in the app.
- Serving the app beyond loopback for remote reviewers — export replaces it.

## Chosen approach
Extend the existing eval pipeline (approach 1). Agent Benchmarks clones the user's repo with `git clone --local` into `~/.agent-benchmarks/evals/<run>/repo`, generates `ach` inline tasks `{prompt, cwd: clone, setup, verify}`, and runs `ach trial --matrix --isolate` so each cell gets its own git worktree. Replay `setup` checks out `<sha>^` with hidden paths removed; `verify` saves `git diff` to `diff.patch`, applies the hidden paths from `<sha>`, runs hidden tests and checks, and writes logs. Reuses ledger, resume/cancel, session sync, `stats.ts`, and `PairedComparison`. Rejected: driving harnesses directly (duplicates `ach`'s driver: launch templates, availability, provider-limit detection, budgets) and adding replay tasks upstream in `ach` (cross-repo change for logic that fits in setup/verify shell).

`default` config: each default combo gets a clean per-run config dir (`evals/<run>/home/<harness>`) passed through the harness's config env (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, …) and a distinct `ach` agent descriptor (e.g. `claude-default`) so cell IDs do not collide; only the harness's auth file is copied; sessions written there are ingested with `sync --path`. A harness that cannot authenticate in default mode yields `unavailable` with a reason — never a silent fallback to the current config.

## Visual decisions
- Real-task results layout → option C: summary table on top, tick-to-compare side-by-side diffs below, human diff ticked by default (`.superpowers/brainstorm/16201-1795179578/content/results-layout.html`).
- Where the real-task form lives → option B: separate "Real tasks" sub-section in `/evaluating` with its own form and history (`.superpowers/brainstorm/16201-1795179578/content/real-task-form.html`).
- Form contents: repo, task type (Prompt | Replay commit), commit/PR, editable prompt, hidden tests, check commands, combo table with `current configuration` / `default` checkboxes, trials, wall per cell (default 30 min) (`real-task-form.html`).

## Constraints found in the codebase
- `src/eval/runner.ts` builds `plan.json` and spawns `ach trial --matrix … --hermetic`; `ach --isolate` cannot be combined with `--hermetic`, so real tasks run without `--hermetic`.
- `ach --isolate` creates `ach/<runId>` branches and needs a clean tree — hence the local clone; the user's repo must never be modified.
- `EvalSetup` is `{harness, model}`; `setupKey` must become `harness:model:config`; existing benchmark runs read as `current` (they already load user-global config, per `globalConfigNote`).
- `EvalRunInput` becomes a union on `kind` (`benchmark` | `real`).
- Eval data lives in files under `evals/<run>/` — no SQLite schema change.
- Outcomes reuse `CellOutcome` and `GRADED_OUTCOME` (`setup-error`, `unavailable` are ungraded).
- `ledger.ts` joins cells to sessions for tokens/cost; sessions from default-config dirs need `sync --path` ingest.
- Invariants: runtime makes no LLM calls and no outbound network; core modules print-free; new route `GET /api/evals/:id/report.html` must update `docs/api/openapi.yaml`, `docs/api/routes.md`, and contract tests.
- `EVAL_LIMITS.maxSetups = 8`; current default wall 15 min, max 60 min.
- Null harness (`AGENT_BENCHMARKS_EVAL_ALLOW_NULL=1`) is the zero-cost test double.
- Unverified: Claude Code on macOS stores credentials in Keychain; whether it authenticates under a different `CLAUDE_CONFIG_DIR` must be checked per harness during planning.

## Acceptance criteria
- Starting a replay run on a repo with commit X: each cell's worktree starts at `X^` without the hidden test files; after the agent finishes, the hidden tests from X are applied and their pass count is recorded.
- After any real run, the user's source repo is unchanged: no new branches, no `ach/*` refs, identical `git status`.
- Checking both `current configuration` and `default` for one harness × model produces two combos with distinct setup keys and separate results rows in one run.
- A default-config combo whose harness cannot authenticate is recorded as `unavailable` with a reason and is excluded from pass rate; it never runs with the current config.
- Each finished cell exposes `diff.patch`, diff stat, per-check exit code/duration/log, tokens and cost when a session is found (otherwise cost `unavailable: not-found`).
- Replay results show a human reference row and per-combo file overlap and size ratio vs the human diff.
- The results page shows the summary table and side-by-side diffs for ticked combos, with the human diff ticked by default.
- Invalid input (non-git repo, unknown SHA, hidden path not in the commit) is rejected with `400` before any run directory is created.
- Exported `report-<run>.html` opens offline, contains no `<script src`, no `http(s)://` resource references, and no raw transcript text.
- Cancel and resume work for real runs as for benchmark runs; cancelled cells leave no worktree behind.
