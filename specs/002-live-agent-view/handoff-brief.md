## Goal
While an evaluation runs, let the user watch what the running coding agent is doing in real time, and compare it side by side with how the other setups handled the same task and trial.

## Scope — in
- A "Live" tab next to "Results" on the Evaluating page, with a Watch | Compare toggle.
- Watch: one full-width event stream of a cell. By default it follows the running cell and moves to the next cell when one starts. Clicking a Results row opens that cell (live or recorded).
- Compare: one column per setup of the run (at most `maxSetups` = 8) for one task + trial, defaulting to the live cell's task + trial. Column states: live (streams), done (recorded run with outcome and time), queued (not started yet).
- Event rows: one line each (agent message, tool call with name and short argument, tool result with error flag, usage/cost), click to expand full arguments or content.
- Per-column header: setup, state, elapsed time, tool-call count, cost when reported.
- Works for benchmark and real-task runs, and for any harness `ach` drives.

## Scope — out
- Running several agents at the same time: `ach` runs cells sequentially and parallel runs change benchmark fairness (provider load, cache).
- Token-level streaming: `ach` records whole agent events, not tokens.
- Choosing a subset of setups to compare (YAGNI; 8 columns max fits).
- Controlling the agent (pause, inject input).

## Chosen approach
Approach 1, a notify-then-fetch pattern matching `eval_progress`. The server watches `ach-state/raw/` (extending `installLedgerWatch`) and publishes a small SSE event `eval_cell_activity {runId, cellId, seq}`. The client fetches the delta from `GET /api/evals/{id}/cells/{cellId}/events?after=<seq>`. The same endpoint serves recorded transcripts of finished cells, so replay and live share one path. Rejected: pushing full events over SSE (broadcasts transcript content to every tab and eats the 1 MB SSE backlog), and plain polling (requests with nothing new).

Source data: `ach` writes each run's events to `ach-state/raw/<agent>-<…>.jsonl` in one harness-neutral schema (`message`, `tool_call` with `functionName` + `arguments`, `tool_result` with `isError`, `model_call_start/end`, `usage`, `ach.seal`), appended while the agent runs. `ach-state/runs/<runId>.json` points to it through `rawTranscript`.

Cell mapping:
1. The live record is the one with `status === "running"` and a live `pid`. Stale records from killed processes are excluded.
2. Its cell is the planned cell whose `safeCellDir(achCellId)` equals the record's `cwd` basename (hermetic benchmark runs; verified on a live run, same algorithm as ach's `workspaceName`). Otherwise the in-memory `currentCells` entry (real-task runs, whose cwd is `worktrees/<runId>`).
3. Finished records carry `cellId`.

## Visual decisions
- Live view layout → option B: "Live" tab with Watch | Compare toggle, columns per setup with live / done / queued states (`.superpowers/brainstorm/49025-1795248953/content/live-layout.html`).

## Constraints found in the codebase
- `src/eval/runner.ts`: `spawnRun` runs `ach trial` groups sequentially; `currentCells` is parsed from ach stdout and in-memory; `installLedgerWatch` polls every 2 s plus `fs.watch(runDir)`; `publishProgress` emits `eval_progress`.
- `src/eval/ledger.ts`: `readRegistry` reads `ach-state/runs/*.json`; `RunRecord.rawTranscript`; running records lack `cellId`.
- `src/eval/paths.ts`: `safeCellDir`, `apiCellId`, `parseApiCellId`.
- `src/server/sse.ts`: `ServerEvent` union, `MAX_EVENT_BACKLOG_BYTES` = 1 MB, broadcast to all clients.
- Existing route `/api/evals/{id}/cells/{cellId}` returns cell artifacts; the new route sits beside it.
- UI subscribes to `/api/events` in `src/ui/main.tsx`; Evaluating view in `src/ui/views/evaluating.tsx`.
- Invariants: local-first (no network), core modules print-free, route changes update `docs/api/openapi.yaml`, `docs/api/routes.md`, and contract tests; fixtures synthetic only.

## Acceptance criteria
- With a run active, the Live tab shows the running cell's new events within ~3 s of `ach` writing them, without reloading.
- When the run moves to the next cell, Watch switches to it automatically.
- Compare shows one column per setup for the chosen task + trial with correct live / done / queued state; done columns show the recorded events and outcome.
- A stale `running` record whose process is dead never shows as live.
- A real-task run after a server restart shows "cell unknown" for the live record instead of guessing.
- Malformed lines in a raw transcript are skipped, not crashing the view or leaking unrelated content.
