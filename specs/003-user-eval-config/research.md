# Research: User-Defined Eval Augments and Combos

## Where run state lives
- Decision: snapshot augment definitions into `manifest.json` provenance.
- Rationale: manifests are JSON files under `evalDataDir(dbPath)` (`runner.ts` `readManifest`/`writeManifest`); resume (`runner.ts` ~595) re-reads them, so a snapshot there also pins resumed groups. No SQLite change.
- Alternatives: hash in setup key (rejected by user, fragments history); DB column (needs migration, no benefit).

## Validation approach
- Decision: hand-written validators, matching `validateInput` in `runner.ts`.
- Rationale: no schema library in dependencies; adding one for ~6 fields violates "no new dependency for a few lines".

## Combo semantic validation
- Decision: reuse `validateInput` and surface its `EvalRequestError.message` as the combo problem.
- Rationale: one rule set for "can this run start" (FR-014); no second validator to drift.

## Eval config dir vs run data dir
- Decision: `evalConfigDir = AGENT_BENCHMARKS_EVAL_DIR || dirname(db)/evals`; run dirs stay in `evalDataDir`.
- Rationale: by default both share `dirname(db)/evals`; `augments/` and `combos/` have no `manifest.json`, so `listRunManifests` skips them already (`readManifest` returns null without a manifest).

## Companion file resolution
- Decision: resolve `from` to absolute paths at load; reject escapes.
- Rationale: the snapshot must stay meaningful after the loader is gone; content is still hashed at copy time into `augments/sha256.json`.
