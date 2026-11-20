# Tasks: Real-Task Evaluations

**Input**: `plan.md`, `data-model.md`, `contracts/api.md`, `research.md`, `quickstart.md`

Format: `[ID] [P?] [Story] Description`. `[P]` = parallel-safe (disjoint files).

## Phase 1: Foundational (blocking)

- [x] T001 Update `src/eval/types.ts` to the data model: `EvalConfigMode`, `EvalSetup.config`, `RepoProfile`, `RealTask`, `BenchmarkRunInput | RealRunInput`, `DiffStat`, `CheckResult`, `RealCellSummary`, `RealReference`, `RealResults`, `EvalResults.real`, `hermeticRoot: string | null`, `EvalHarnessInfo.defaultConfig`, catalog limits for real tasks.
- [x] T002 Parse legacy manifests at the read boundary (`readManifest`): missing `kind` → `benchmark`, missing `config` → `current`. Update every caller of `EvalRunInput` / `setupKey` (`ledger.ts`, `stats.ts`, `runner.ts`, `evaluating-form.ts`, UI) to compile.

## Phase 2: Backend (US1, US2, US3) — owner: backend worker

- [x] T010 [US3] `registry.ts`: `defaultConfig` table (claude: requires `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`; codex: `CODEX_HOME` + `auth.json`; others null); catalog exposes it with the reason; `EVAL_LIMITS.realDefaultWallMs = 30 min`.
- [x] T011 [US1][US2] `src/eval/real.ts`: `validateRealInput`, `inspectRepo(path, sha?)` (profile detect/remember, recent commits, commit info, suggested hidden), `prepareRealRun` (clone, base branch, reference diff, `real-spec.json`, plan per group), `readRealResults` (cell summaries, overlap, size ratio, turns, tool calls), `readCellArtifacts`.
- [x] T012 [US1][US2] `src/eval/real-verify.ts`: subprocess entry per plan step 6; exit-code rule; artifacts layout.
- [x] T013 [US3] `runner.ts`: config groups as sequential `ach` invocations (`--isolate --cleanup` for real, `--hermetic` for benchmark), per-group env, unavailable rows for unauthenticated default Claude, cancel stops the chain, resume reruns all groups, progress across groups, targeted post-run sync of default-group session dirs.
- [x] T014 `ledger.ts`: per-group ledgers, `cellId = <config>/<achCellId>`, setupKey with config, outcome rule (`passed` needs `exitStatus` success); `stats.ts` follows.
- [x] T015 [US5] `src/eval/report.ts`: pure HTML renderer.
- [x] T016 Routes: `GET /api/evals/repo`, `GET /api/evals/{id}/cells/{cellId}`, `GET /api/evals/{id}/report.html`, extended `POST /api/evals` and `GET /api/evals/{id}`; `src/route-paths.ts`, `docs/api/openapi.yaml`, `docs/api/routes.md`, contract tests.
- [x] T017 Tests: `test/eval-real-core.test.ts` and `test/eval-real-run.test.ts` (synthetic repo + null harness end to end, source repo unchanged, hidden tests hidden then applied, validation 400s write nothing), `test/eval-report.test.ts`, outcome-rule test, legacy-manifest parse test.
- [x] T018 Docs: `docs/data-lifecycle.md` (eval run files, clone, cleanup).

## Phase 3: UI (US1–US5) — owner: UI worker, parallel with Phase 2 after Phase 1

- [x] T020 [P] `evaluating.tsx`: Tabs `Benchmark | Real tasks`, separate history lists filtered by `kind`.
- [x] T021 [P] [US1][US2][US3] `evaluating/real-form.tsx`: repo input with `GET /api/evals/repo` prefill, task type toggle, commit picker from `recentCommits`, editable prompt, hidden-path checklist, setup/check/hidden-test commands, combo table with `current configuration` / `default` checkboxes (default disabled with reason), trials, wall, start.
- [x] T022 [P] [US4] `evaluating/real-results.tsx`: summary table with human reference row and explicit unavailable values; tick-to-compare side-by-side diffs (human ticked by default), tabs Diff / Transcript (link to session) / Check logs; multi-trial pass rate and spread.
- [x] T023 [P] [US5] Export button linking `report.html`.
- [x] T024 [P] `test/ui-evaluating.test.ts` updates for behavior.

## Phase 4: Verify (owner: lead)

- [x] T030 `bun test`, `bunx tsc --noEmit`, `bunx biome check .`.
- [x] T031 E2E with real harnesses through the browser UI on a real repository commit; source repo unchanged; report offline check.

## Dependencies

Phase 1 → Phases 2 and 3 in parallel (disjoint files: Phase 2 owns `src/eval/**` except types, `src/server/**`, `src/route-paths.ts`, `docs/**`, `test/eval-*`, contract tests; Phase 3 owns `src/ui/**`, `test/ui-*`) → Phase 4.
