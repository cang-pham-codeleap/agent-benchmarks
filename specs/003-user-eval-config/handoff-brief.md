## Goal
Each user defines their own eval augments (tools, MCP servers, hooks, prompt modes) and saved comparison combos in a directory they own, so they can benchmark any agent setup without changing this repository.

## Scope — in
- User-defined augments as declarative JSON files, same shape as today's `AugmentDefinition` / `AugmentRecipe` (`label`, `kind`, `description`, `sourceUrl`, `binary`, `recipes.<harness>.{args, env, files, mcpServers, addTools, prepare}`).
- User-defined combos: saved benchmark inputs (`label`, `setups`, `taskIds`, `trials`, `wallMs`), loadable into the Evaluating form and savable from it.
- One loader for bundled and user augments: the six built-ins (`rtk`, `codegraph`, `caveman`, `ponytail`, `ptc`, `bash-cap`) move from `EVAL_AUGMENTS` in `src/eval/registry.ts` to `evals/augments/<id>.json`; `AugmentId` becomes a validated string.
- User config root: `AGENT_BENCHMARKS_EVAL_DIR` when set, else `dirname(db)/evals` (default `~/.agent-benchmarks/evals/`). Layout: `augments/<id>.json`, `augments/<id>/…` companion files, `combos/<id>.json`.
- Run manifest snapshots the full definitions of every augment a run uses; the runner resolves recipes from that snapshot.
- Augment verdict pools flag `recipeDrift` when pooled runs used different recipe snapshots.
- `POST /api/evals/combos` writes a combo file; catalog exposes `combos`, `augments[].source`, `evalDir`.

## Scope — out
- New harnesses (e.g. `aider`): needs a session parser under `src/sources/`; separate feature.
- Multiple config directories with precedence: nobody asked; one override env var covers team sharing.
- Combos for real-task runs (`real-form.tsx`): benchmark only for now.
- Editing or deleting augments through the UI/API: augments are hand-written JSON.
- TS/JS plugin augments: runs arbitrary code in the server process, breaks the standalone binary, no current recipe needs computed values.
- Moving user tasks: tasks keep loading from `<achDir>/tasks`.
- Per-harness merge of overriding augments: a same-id user file replaces the bundled one wholesale.

## Chosen approach
Single declarative loader (approach 1). Built-ins become JSON files read through the same loader and validator as user files, so there is one code path and the built-ins double as copyable examples. Beat "keep built-ins in TS + user loader" (two sources of truth that drift) and "TS plugin modules" (arbitrary code execution, binary breakage, no need).

Decisions made during brainstorming:
- Scope B: augments + combos (not harnesses).
- Location B: default `dirname(db)/evals`, overridable with `AGENT_BENCHMARKS_EVAL_DIR`.
- Collision A: a user augment with a bundled id overrides it entirely; UI marks it `user`.
- Reproducibility A: snapshot resolved definitions into each run manifest; verdicts still pool by id; UI warns on drift inside a pool. Setup key unchanged.
- Combo UI C: Combos card row above Setups plus a "Save as combo…" button.

## Visual decisions
- Where combos appear in the Evaluating form → option C: card row above Setups + "Save as combo…" next to Start (`.superpowers/brainstorm/15739-1795357975/content/combo-placement.html`)

## Constraints found in the codebase
- `EVAL_AUGMENT_IDS` union in `src/eval/types.ts` and `EVAL_AUGMENTS` in `src/eval/registry.ts` are the current hard-coded registry; `augmentProblem`, `augmentInfos`, `validateSetupConfig`, `resolveRecipe`, `writeRecipeFiles` consume it.
- `from` file sources resolve against `evals/augments` or `~/`; user augments resolve relative to their own directory.
- `kind` stays one of `shell-proxy | mcp | prompt-mode | harness-flag`; "at most one prompt-mode augment per setup" depends on it.
- `augmentProblem` already surfaces `available: false` + `problem` in the catalog and UI; malformed files reuse it.
- Runner already writes `augment-hashes.json` for companion files and tolerates old manifests (`runner.ts` manifest normalisation); old manifests without a snapshot fall back to bundled definitions.
- `setupKey` in `src/eval/stats.ts` stays unchanged.
- Evals run only through the local UI/API; there is no eval CLI command.
- Route changes must update `docs/api/openapi.yaml`, `docs/api/routes.md`, and contract tests (AGENTS.md invariant 7).
- No outbound network or LLM calls (invariant 3).

## Acceptance criteria
- Dropping `context-mode.json` into `<eval-dir>/augments/` makes it selectable in the Evaluating form after a reload, without restarting `serve` or editing the repo.
- A user `ptc.json` with a `claude` recipe replaces the bundled `ptc`, and the form shows it with a `user` badge.
- A malformed augment file shows as unavailable with a problem naming the bad field; other augments still load.
- The six bundled JSON augments resolve to the same argv, env, and files as the current TS definitions.
- Editing an augment file after a run starts does not change what that run executes.
- Pooled verdicts containing runs with different recipe snapshots show a drift warning; the verdict values are unchanged.
- Clicking a combo card fills setups, tasks, trials, and wall time; preset becomes `custom`.
- "Save as combo…" writes `<eval-dir>/combos/<id>.json`; an existing id needs explicit overwrite; invalid ids are rejected.
- A combo referencing a missing augment, uninstalled harness, or unknown task shows as unavailable with the reason.
- With `AGENT_BENCHMARKS_EVAL_DIR` set, augments and combos load from and save to that directory.
