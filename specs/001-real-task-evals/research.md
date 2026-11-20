# Research: Real-Task Evaluations

All findings are from the `ach` checkout at `~/Documents/sources/_oss-study/agentic-coding-harness` (commit `ac3cc0c`, v0.31.0) and this repository.

## R1. Isolation per cell

- **Decision**: `ach trial --matrix plan.json --isolate --cleanup` on a `git clone --local` of the user's repo.
- **Rationale**: `--isolate` gives each `workspace: "shared"` cell a worktree `<stateDir>/worktrees/<runId>` on branch `ach/<runId>` from `HEAD`; task `setup` and `verify` run inside it (`docs/TRIALS.md`, README "Isolated runs"). It refuses a dirty tree and creates branches, so running it on the user's checkout would violate FR-008. The clone is clean by construction.
- **Alternatives**: `--hermetic` (refused together with `--isolate`; syncs edits back into one shared cwd, so cells would collide).

## R2. Config modes

- **Decision**: one `ach` invocation per config group; `current` sets `AGENTIC_CODING_HARNESS_DEFAULT_CLAUDE_CONFIG=1`; `default` leaves Claude on the per-run config dir and sets `CODEX_HOME` to a clean dir holding only `auth.json`.
- **Rationale**: `src/adapters/claude.ts` gives every run a fresh `CLAUDE_CONFIG_DIR` unless `useDefaultClaudeConfig` (env var above) is set, and `claudeAuthHint` states a per-run dir "cannot see a keychain /login session". This machine has no `~/.claude/.credentials.json` and no token env, so today's benchmark Claude runs would fail to log in; `current` fixes that. `CODEX_HOME` relocates Codex config and sessions (`src/core/codex-native.ts`); `~/.codex/auth.json` exists. Cell env in a plan is not user-settable (only `claude.disableBackgroundTasks`), so the switch must be process-level.
- **Unsupported for default**: Copilot, OpenCode, OMP, Droid. No verified config-relocation and auth mechanism; the UI disables the option with a reason.

## R3. Cost, tokens, sessions

- **Decision**: keep `readEvalCells` cost logic. For metered harnesses `ach`'s RunRecord carries harness-reported USD and totals. Session join (`joinSessionCost`) supplies turns (`session.turn_count`), tool calls, and the transcript link. Default-group sessions are ingested by a targeted sync of `<run>/ach-state/claude-runs` and `<run>/home/codex`.

## R4. Hidden tests

- **Decision**: replay base is `sha^`; hidden files are applied at verify with `git checkout <sha> -- <paths>` and run one by one with the hidden-test command (`{file}` placeholder).
- **Rationale**: new test files do not exist at `sha^`, so nothing needs hiding; files that existed are shown in their pre-commit state, as a developer would see them.
- **Suggested hidden paths**: changed files in `sha` matching `(^|/)(test|tests|__tests__|spec)/`, `\.(test|spec)\.[cm]?[jt]sx?$`, `_test\.(go|py)$`, `(^|/)test_[^/]+\.py$`.
- **Prefill**: `bun.lock`/`bun.lockb` → setup `bun install --frozen-lockfile`, hidden `bun test {file}`; `package-lock.json` → `npm ci`, `npx vitest run {file}` if vitest in package.json else `npx jest {file}`; `pyproject.toml`/`pytest.ini` → `pytest {file}`; `go.mod` → `go test ./...`.

## R5. Outcome classification

- **Decision**: `passed` requires `verify === "pass"` and `exitStatus === "success"` (absent counts as success for legacy rows).
- **Rationale**: prompt-task verify exits 0 by design; without this rule an agent crash followed by verify would count as a pass.
