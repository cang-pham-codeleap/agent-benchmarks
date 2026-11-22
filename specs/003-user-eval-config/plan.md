# Implementation Plan: User-Defined Eval Augments and Combos

**Branch**: `003-user-eval-config` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

## Summary

Replace the hard-coded augment registry (`EVAL_AUGMENT_IDS` in `src/eval/types.ts`, `EVAL_AUGMENTS` in `src/eval/registry.ts`) with one JSON loader over two directories: bundled `evals/augments/` and the user eval dir. Snapshot the augment definitions a run uses into its manifest and resolve recipes from that snapshot. Add saved combos (JSON files) with a catalog field, a save route, and a card row plus "Save as combo…" in the Evaluating form. Flag recipe drift on pooled augment verdicts.

## Technical Context

**Language/Version**: TypeScript on Bun (repo pins `bun@1.4.4`; `engines` allows `>=1.3.0`)
**Primary Dependencies**: existing only. React 19 + Radix (`dialog.tsx`, `badge.tsx`, `alert.tsx`) for UI. No schema library; validation is hand-written like `validateInput` in `runner.ts`.
**Storage**: JSON files. Run manifests are `manifest.json` files under `evalDataDir(dbPath)`, not SQLite. No archive migration and no `INGEST_PIPELINE_REVISION` bump.
**Testing**: `bun test`, `bunx tsc --noEmit`, `bunx biome check .`
**Target Platform**: local `agent-benchmarks serve` (loopback)
**Constraints**: no outbound network (AGENTS.md invariant 3); route changes keep `docs/api/openapi.yaml`, `docs/api/routes.md`, `src/route-paths.ts`, `src/server/routes.ts`, and `test/api-contract.test.ts` in sync (invariant 7); core modules stay print-free (invariant 1).
**Scale**: tens of augment and combo files; reading them on each catalog request is negligible.

## Constitution Check

`.specify/memory/constitution.md` is an unfilled template. AGENTS.md acts as the constitution.

| Gate | Status |
|------|--------|
| Core modules print-free | Pass. Loader returns data and problems. |
| One process owns SQLite | Pass. No new DB access. |
| Local-first, no outbound calls | Pass. |
| Schema constants source of truth | Pass. No schema change. |
| Serve routes documented | Planned. New route lands with OpenAPI, routes.md, contract test. |
| Docs updated for user-visible change | Planned. `docs/evals-custom.md`, `docs/data-lifecycle.md`, README, API docs. |

## Design

### Data shape (organizing structure: a registry keyed by id, built from files)

```ts
// src/eval/types.ts
export type AugmentId = string;                 // validated at load: /^[a-z0-9][a-z0-9-]{0,63}$/
export type AugmentSource = "bundled" | "user";

// src/eval/augments.ts (new)
export interface LoadedAugment {
  id: AugmentId;
  source: AugmentSource;
  /** null when the file failed validation; `problem` then says why. */
  definition: AugmentDefinition | null;
  /** sha256 of the canonical JSON of `definition` with `from` paths resolved; null when invalid. */
  hash: string | null;
  problem: string | null;
}
export type AugmentRegistry = ReadonlyMap<AugmentId, LoadedAugment>;
export function loadAugments(evalDir: string): AugmentRegistry; // bundled first, user overrides by id
export function evalConfigDir(dbPath: string, env = process.env): string;
//   env.AGENT_BENCHMARKS_EVAL_DIR || join(dirname(dbPath), "evals")
```

- `AugmentDefinition` / `AugmentRecipe` / `AugmentFile` keep their current shape. At load, every `{ from }` is resolved to an absolute path: `~/` → home; otherwise relative to the directory holding the augment JSON. A resolved path outside that directory (or outside home for `~/`) is a validation problem.
- Bundled definitions move to `evals/augments/<id>.json` (`rtk`, `codegraph`, `caveman`, `ponytail`, `ptc`, `bash-cap`). `claudePrompt` / `ompPrompt` helpers become literal JSON.
- Registry functions take the definitions they need instead of reading a module constant:
  - `augmentProblem(augment: LoadedAugment, harness, env)`; invalid definition returns its `problem`.
  - `augmentInfos(registry, env)` adds `source`.
  - `validateSetupConfig(harness, config, rawAugments, registry, env)`; unknown id → `augment_unknown`.
  - `resolveRecipe(harness, config, augments, definitions: Record<AugmentId, AugmentDefinition>, groupKey, dir)`.
  - `writeRecipeFiles` copies absolute `from` paths.
- `EVAL_AUGMENT_IDS`, `EVAL_AUGMENTS`, `AUGMENTS_SOURCE_DIR`-relative resolution, and the prompt helpers are deleted.

### Snapshot and drift

```ts
// EvalProvenance (types.ts) gains:
augments?: Record<AugmentId, { source: AugmentSource; hash: string; definition: AugmentDefinition }>;
```
- Benchmark and real-run start write the snapshot for every augment any setup uses. `runGroup` and `writeHarnessShims` (including resume) resolve from `manifest.provenance.augments`; a manifest without it falls back to the bundled registry (`loadAugments` bundled-only).
- `poolAugmentVerdicts` input runs gain `augmentHashes: Record<AugmentId, string>`; each pool tracks the set of `augments.map(id => hash)` tuples it saw. `AugmentPoolEntry.recipeDrift = tuples.size > 1`. Verdict math unchanged. `evalAugmentsRoute` passes hashes from snapshot or bundled fallback.

### Combos

```ts
// types.ts
export interface EvalCombo { id: string; label: string; setups: EvalSetup[]; taskIds: string[]; trials: number; wallMs: number; }
export interface EvalComboInfo extends EvalCombo { problem: string | null; }
// EvalCatalog gains: combos: EvalComboInfo[]; evalDir: string; augments[].source
```
- `src/eval/combos.ts` (new): `readCombos(evalDir, check)`: parse each `combos/*.json`; shape errors become `problem` with empty lists. Semantic problems come from running the same `validateInput` used by `POST /api/evals` (with `kind: "benchmark"`, `name: label`, `preset: "custom"`) and catching `EvalRequestError.message`.
- `saveCombo(evalDir, body, check)`: id `/^[a-z0-9][a-z0-9-]{0,63}$/`, label 1..120 chars, rest through `validateInput`; atomic write (`<id>.json.tmp` then `renameSync`); existing file without `overwrite: true` → `EvalRequestError(409, "combo_exists")`. Creates `combos/` if missing.
- Route `POST /api/evals/combos` → `saveCombo`; returns the saved `EvalComboInfo`.
- UI pure helper `applyCombo(combo, catalog): { input: BenchmarkRunInput; dropped: string[] }` in `src/ui/views/evaluating-form.ts` drops unknown augments, unknown tasks, setups whose harness is not installed, sets `preset: "custom"`.

### UI (`src/ui/views/evaluating/form.tsx`, `augments.tsx`)
- Combos card row above Setups, hidden when `catalog.combos` is empty. Card shows label, `N setups · T tasks × R`, setup summary, warning + `problem` when present; click → `applyCombo`, show dropped list in an `Alert` when non-empty.
- "Save as combo…" button next to Start opens `Dialog` with id + label inputs; 409 → confirm overwrite → resend with `overwrite: true`; success refreshes the catalog.
- Augment checkbox shows `Badge` "user" when `source === "user"`.
- Augment pool table shows a warning badge when `recipeDrift`.

## Project Structure

```text
evals/augments/{rtk,codegraph,caveman,ponytail,ptc,bash-cap}.json   new (bundled definitions)
src/eval/augments.ts        new: loader, validator, evalConfigDir, hashing
src/eval/combos.ts          new: readCombos, saveCombo
src/eval/registry.ts        drop EVAL_AUGMENTS; functions take registry/definitions
src/eval/types.ts           AugmentId string, AugmentSource, EvalCombo(Info), catalog + provenance fields, pool recipeDrift
src/eval/catalog.ts         readCatalog(db, dbPath, activeRunId) loads registry + combos
src/eval/runner.ts          validateInput takes registry; snapshot into provenance; resolve from snapshot
src/eval/real.ts            same snapshot path for real runs
src/eval/augment-verdicts.ts recipeDrift
src/route-paths.ts, src/server/routes.ts   POST /api/evals/combos; pass dbPath to catalog; hashes to pool
src/ui/views/evaluating-form.ts  applyCombo
src/ui/views/evaluating/form.tsx, augments.tsx, ui/api.ts
docs/evals-custom.md (new), docs/api/openapi.yaml, docs/api/routes.md, docs/data-lifecycle.md, README.md
test/eval-user-config.test.ts (new), test/eval-augments.test.ts, test/api-contract.test.ts, test/ui-evaluating.test.ts
```

## Verification

1. Parity test written first against the old TS definitions: for every bundled augment × harness × config, `resolveRecipe` output (args, env, files with resolved paths, prepare) equals the pre-change output captured in the test.
2. Unit: loader override, invalid file problem, path escape, env override, snapshot used after file edit, legacy manifest fallback, recipeDrift, combo read problems, saveCombo 400/409/overwrite/atomic, `applyCombo` drops.
3. Contract: `test/api-contract.test.ts` covers the new route.
4. End to end: `serve` on a scratch archive with `--no-sync`, `AGENT_BENCHMARKS_EVAL_DIR` pointing at a scratch dir holding a user augment and a combo, `AGENT_BENCHMARKS_EVAL_ALLOW_NULL=1`; in the browser load the combo, save a combo, run a smoke benchmark on the `null` harness with the user augment, confirm the run's shim carries the user recipe and the manifest holds the snapshot.

## Complexity Tracking

None. One new loader module and one combos module replace a TS constant; no new abstraction layers.
