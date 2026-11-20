# Quickstart validation

1. `bun test test/eval-real.test.ts test/eval-report.test.ts` passes. It builds a synthetic repo in a temp dir with a commit "fix + test", runs a replay with `AGENT_BENCHMARKS_EVAL_ALLOW_NULL=1` and the `null` harness, and asserts: worktree started at `sha^` without the new test; hidden test applied and counted at verify; `diff.patch`, `result.json`, check logs exist; the source repo has the same refs and `git status` as before.
2. `bun run src/cli.ts serve --no-sync` with a scratch `--db`; open `/evaluating` → Real tasks.
3. Pick a small repo, Replay, choose a commit; confirm prompt, hidden tests, and commands prefill.
4. Combos: Claude Code + Codex, tick `current configuration` and `default`. Start.
5. When done: summary table shows a human reference row and one row per combo; a default Claude row without a token env shows `unavailable` with the reason.
6. Tick two combos: diffs render side by side with the human diff.
7. Export: open the downloaded `report-<id>.html` offline; no `<script>`, no `http`.
8. `git -C <repo> for-each-ref` and `git status` are unchanged.
