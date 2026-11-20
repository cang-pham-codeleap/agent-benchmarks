# API contracts (local serve)

All routes are loopback, same security policy as existing `/api/evals*` routes.

## `POST /api/evals` (extended)

Body is `EvalRunInput`. A body without `kind` is a benchmark run (backward compatible). For `kind: "real"`:

| Failure | Status | Code |
|---|---|---|
| `repoPath` not absolute or not a git work tree | 400 | `repo_invalid` |
| replay `sha` unknown or has no parent | 400 | `commit_invalid` |
| hidden path not changed in `sha` | 400 | `hidden_invalid` |
| hidden paths present and `hiddenTestCommand` lacks `{file}` | 400 | `hidden_command_invalid` |
| `default` config on a harness without support | 400 | `config_unsupported` |
| prompt empty or > 20000 chars, setup/check commands > 2000 chars, > 10 checks | 400 | none |
| another run active | 409 | `eval_active` |

Nothing is written under `evals/` before validation passes.

## `GET /api/evals/repo?path=<abs>[&sha=<rev>]`

```json
{
  "path": "/abs/repo", "head": "<sha>", "branch": "main",
  "profile": { "setupCommand": "bun install --frozen-lockfile", "checks": ["bun test"], "hiddenTestCommand": "bun test {file}" },
  "profileSource": "remembered" | "detected",
  "dirty": false,
  "recentCommits": [{ "sha": "…", "subject": "…", "date": "ISO" }],
  "commit": { "sha": "…", "subject": "…", "body": "…", "files": ["…"], "suggestedHidden": ["…"], "isMerge": false } | null
}
```

400 `repo_invalid` / `commit_invalid` as above. `recentCommits` holds the last 30 non-merge commits.

## `GET /api/evals/{id}` (extended)

`EvalResults` gains `real: RealResults | null` (see data-model.md). Benchmark runs return `real: null`.

## `GET /api/evals/{id}/cells/{cellId}`

```json
{ "patch": "<unified diff text>", "checks": [{ "command": "…", "logTail": "…" }], "hidden": [{ "path": "…", "logTail": "…" }] }
```

`cellId` is URL-encoded `EvalCell.cellId`, or `reference` for the human diff (checks empty). Log tails are the last 64 KiB. 404 when unknown.

## `GET /api/evals/{id}/report.html`

`text/html; charset=utf-8`, `Content-Disposition: attachment; filename="report-<id>.html"`. Self-contained: inline `<style>` only, no `<script>`, no `http(s)://` references, transcript summary (turns, tool calls, errors) only. 404 for unknown run, 409 while running.
