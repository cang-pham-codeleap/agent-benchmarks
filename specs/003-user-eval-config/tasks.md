# Tasks: User-Defined Eval Augments and Combos

Each phase ends with its named check passing before the next starts. Commit per phase (Conventional Commits).

## Phase 1: Blocking — parity guard (US1 prerequisite)

- [x] T001 Write `test/eval-augment-parity.test.ts`: capture, from the current TS `EVAL_AUGMENTS`, the `resolveRecipe` output (args, env, files, prepare) for every augment × each harness it supports × `clean`/`default`, hard-coded as expected literals (with `{dir}` and home paths normalised). Check: passes on the unchanged code.

## Phase 2: Loader replaces the TS registry (US1, FR-001..FR-007, FR-012)

- [ ] T002 Add `evals/augments/{rtk,codegraph,caveman,ponytail,ptc,bash-cap}.json` with the exact current definitions.
- [ ] T003 Add `src/eval/augments.ts`: `evalConfigDir`, `loadAugments(evalDir)`, validator (id pattern, kind, harness keys from `EVAL_HARNESSES`, field types, `from` resolution and escape rejection), canonical-JSON sha256 `hash`.
- [ ] T004 `src/eval/types.ts`: `AugmentId = string`, `AugmentSource`, `EvalAugmentInfo.source`, delete `EVAL_AUGMENT_IDS`.
- [ ] T005 `src/eval/registry.ts`: delete `EVAL_AUGMENTS`, prompt helpers, relative `sourceFor`; `augmentProblem`, `augmentInfos`, `validateSetupConfig`, `resolveRecipe`, `writeRecipeFiles` take registry/definitions per plan.
- [ ] T006 Migrate callers: `catalog.ts` (`readCatalog` gets `dbPath`, returns `evalDir`), `runner.ts` `validateInput`, `real.ts`, `routes.ts`, UI type imports. Check: `bunx tsc --noEmit`.
- [ ] T007 Rewrite `test/eval-augments.test.ts` mutations of `EVAL_AUGMENTS["bash-cap"]` to a user augment file in a temp `AGENT_BENCHMARKS_EVAL_DIR`. Update `test/ui-evaluating.test.ts` fixtures for `source`.
- [ ] T008 Tests in `test/eval-user-config.test.ts`: user overrides bundled id wholesale; malformed JSON and bad field produce `problem` naming the field and other augments still load; `from` with `..` escape is a problem; missing dirs are empty; env override changes the dir. Check: parity test (T001) and these pass.

## Phase 3: Snapshot and drift (US1 scenario 5, US4, FR-009..FR-011)

- [ ] T009 `EvalProvenance.augments` snapshot written at benchmark and real run start; `runGroup` / `writeHarnessShims` / resume resolve from it; legacy manifests fall back to bundled.
- [ ] T010 `poolAugmentVerdicts` takes per-run augment hashes and sets `recipeDrift`; `evalAugmentsRoute` supplies them.
- [ ] T011 Tests: editing the user augment file after start leaves the run's resolved recipe unchanged; legacy manifest resolves to bundled; two runs with different hashes in one pool set `recipeDrift` and leave verdict numbers equal to the no-drift case.

## Phase 4: Combos backend (US2, US3, FR-013..FR-016, FR-018)

- [ ] T012 `src/eval/combos.ts`: `readCombos`, `saveCombo` (id/label validation, `validateInput` reuse, atomic write, 409 `combo_exists`, creates dir).
- [ ] T013 Catalog `combos`; route `POST /api/evals/combos` in `src/route-paths.ts`, `src/server/routes.ts`; `docs/api/openapi.yaml`, `docs/api/routes.md`; `test/api-contract.test.ts`. Follow `.claude/skills/api-route-change/SKILL.md`.
- [ ] T014 Tests: combo with unknown augment / missing task / uninstalled harness / over limit reports problem; save 400 bad id, 409 existing, 200 with overwrite; no `.tmp` left behind; env override is where files land.

## Phase 5: UI (US2, US1 badge, US4 warning, FR-017)

- [ ] T015 `applyCombo(combo, catalog)` in `src/ui/views/evaluating-form.ts` with unit tests (drops unknown augments/tasks/uninstalled-harness setups, lists dropped, preset `custom`).
- [ ] T016 `form.tsx`: combos card row (hidden when empty), warning + problem, click → `applyCombo` + dropped `Alert`; "Save as combo…" `Dialog` with 409 overwrite confirm and catalog refresh; `ui/api.ts` client call.
- [ ] T017 `form.tsx` `user` badge on augment checkbox; `augments.tsx` drift warning on pool rows.

## Phase 6: Docs and end-to-end

- [ ] T018 `docs/evals-custom.md` (format, `from` rules, override, combos, context-mode example, `ptc` for claude example); `docs/data-lifecycle.md` (`AGENT_BENCHMARKS_EVAL_DIR`, manifest snapshot); `docs/analytics-methodology.md` (augment pool `recipeDrift` warning, verdict math unchanged); README pointer.
- [ ] T019 Full gates: `bun test`, `bunx tsc --noEmit`, `bunx biome check .`, `bun run scripts/pr-policy.ts`.
- [ ] T020 Browser end-to-end per `quickstart.md`.
