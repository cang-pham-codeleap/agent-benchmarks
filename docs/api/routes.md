# Local Serve API

`agent-benchmarks serve` runs the archive owner, source watcher, local HTTP API,
Server-Sent Events stream, and React UI in one Bun process. It listens on
`http://127.0.0.1:3000` by default.

The reference contract is [openapi.yaml](openapi.yaml). It describes every
`/api/*` operation, parameter, request body, response schema, and stable error
code. A running server exposes the same OpenAPI 3.1 document as JSON at
`GET /api/openapi.json`; its `info.version` is the running Agent Benchmarks version.

This page records the operational semantics around that contract.

## UI routes

- `GET /` (Analytics; grouped under Overview in the sidebar)
- `GET /projects`
- `GET /sessions`
- `GET /sessions/:id`
- `GET /search`
- `GET /analytics`
- `GET /compare`
- `GET /insights`
- `GET /tools`
- `GET /files`
- `GET /settings`
- `GET /reports/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&source=SOURCE`
- `GET /reports/session/:id`

Any other non-API path returns `404` with the standard `not_found` error body.

The report UI routes render a light, print-ready preview with Back, Download
HTML, and Save as PDF controls. They read the local-only report operations;
the session preview intentionally omits transcript content.

Analytics statistics and reports accept a combined `source` filter. The
current values are `claude_code`, `codex_app`, `codex_cli`, `codex_other`,
`gemini_cli`, `opencode`, `cursor_cli`, `copilot_cli`, `vscode_copilot`, `atif`,
`hermes`, and `pi`.
An unknown value
returns `400` with the accepted values in `allowed`, before the archive is read. The Codex split reads
the source session's recorded `originator`/`source` metadata. The filter does
not infer an account identity. `GET /api/metadata/session-sources` returns only
source values represented by visible sessions in the local archive, and the
Analytics picker uses that list.

`GET /api/sessions`, `GET /api/stats/summary`, and
`GET /api/stats/by-dimension` also accept `repo`, a repository root path. It
matches sessions whose project is that root or one of its worktrees, where
`project` matches one exact path. `dim=repo` groups rows the same way, and
`dim=outcome` groups every run under the outcome label of its top-level
session: `completed`, `abandoned`, `failed`, or `(unclassified)`.

`GET /api/analytics/compare` groups visible root tasks by their tool, provider,
and primary model, with date, project, repo, source, tool, work type, and
outcome filters applied to the root. Descendants are included regardless of
their own date or project. Each cell has a nullable `provider`, and its
`modelUsage` entries are grouped by nullable `provider` and `model`. Model
names remain unprefixed. The response includes session counts, token totals,
per-model usage, and priced-task cost and distribution metrics. A task is
unpriced if any of its sessions lacks usage or has an unpriced model; that whole task is omitted
from cost metrics and counted in `unpricedTasks`. Outcome is a transcript-ending
heuristic, not a measure of task success. See [Compare](../compare.md).


The API's `repo` takes one stored root and compares it as written. The CLI's
`--repo` on `agent-benchmarks ls` and `agent-benchmarks search` first resolves a directory, a
remote, or a repository name to stored roots, and includes every checkout that
shares the `origin` remote. `agent-benchmarks project ls --fields path,root_path` prints
each project beside its root.

## Access control

The API has no authentication. Any request that reaches the listener and passes
the local guard can read or mutate the whole archive.

- The default loopback bind admits local processes only.
- On a non-loopback bind, loopback source addresses and the trusted peers
  resolved at startup are admitted; every other source receives
  `403 forbidden_remote`.
- Trusted-peer sources use replacement precedence, not a union. The first
  present source wins: `--trusted-peer`, then `AGENT_BENCHMARKS_TRUSTED_PEERS` whenever
  the variable is set, then `AGENT_BENCHMARKS_TRUST_DEFAULT_GATEWAY=1`.
  `AGENT_BENCHMARKS_TRUSTED_PEERS=` therefore means “trust nobody,” not “fall through.”
- Every trusted peer must be an IP address or an IPv4 CIDR. `agent-benchmarks serve`
  exits with an error at startup on an entry that could never match, such as
  `10.0.0.0/33` or a hostname, instead of silently trusting nobody.
- The gateway option contributes one address only when Agent Benchmarks proves the
  default route is a container veth to an on-link gateway inside
  `172.16.0.0/12`. It fails closed for host networking, macvlan/ipvlan,
  multi-homed hosts, and other unproven shapes. See
  [distribution.md](../distribution.md#docker).
- A write that sends `Origin` must name a loopback origin whose host and port
  equal the request's `Host` header, so a page on another localhost port gets
  `403 cross_origin_write`. `localhost`, `127.0.0.1`, and `[::1]` are distinct
  hosts here, and a missing port means the scheme's default. The bound port is
  not consulted, so a published port such as `-p 8080:3000` works when the
  browser's `Host` and `Origin` agree.
- `GET /api/events` is refused with `403 cross_origin_read` when the browser
  marks the request as coming from another page (`Sec-Fetch-Site` other than
  `same-origin` or `none`, or an `Origin` that fails the check above). Pages on
  other sites cannot read the stream anyway, but each open stream counts toward
  the client cap, so this keeps them from holding slots. `curl` and other
  clients that send neither header are admitted.
- Every UI page response sends `Content-Security-Policy: frame-ancestors
  'none'` and `X-Frame-Options: DENY`, so browsers refuse to show the UI inside
  another site's frame. A click inside such a frame would reach the API as a
  same-origin request that the `Origin` check cannot reject. UI pages also send
  `Referrer-Policy: no-referrer`, and UI pages, bundled assets, and JSON
  responses send `X-Content-Type-Options: nosniff`.
- The `Host` check is not authentication: a non-browser client can send
  `Host: localhost`. The `Origin` and `Sec-Fetch-Site` checks on writes are
  browser-drive protections, not credentials.

On a loopback bind, a command-line write may omit `Origin`. On a non-loopback
bind, a write that supplies neither `Origin` nor `Sec-Fetch-Site` is rejected
even when the source is trusted. For an explicit command-line write, supply an
`Origin` whose host and port match the `Host` header you send; for example:

```bash
curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Origin: http://127.0.0.1:3000' \
  --data '{}' \
  http://127.0.0.1:3000/api/sync
```

If the client connects to a non-loopback address directly, it must also send a
loopback `Host` header. Admission still depends on the actual source address;
changing `Host` or `Origin` never makes an untrusted peer trusted.

The sync report counts oversized source files in `failed`. These files leave
archived rows and source metadata unchanged and are retried on every sync.

## Response and archive semantics

JSON errors use the stable envelope `{ "error": string, "code": string, ... }`.
Expected recovery cases retain specific codes, including `archive_locked`,
`server_busy`, `schema_drift`, `schema_too_new`, `schema_too_old`,
`session_not_found`, and validation failures. `server_busy` is a retryable
`503`: `agent-benchmarks serve` runs heavy reads on two workers and queues at most 256
more, and refuses a read beyond that rather than letting the backlog grow.
`GET /api/events` answers the same way when 32 event streams are already
open. Unexpected failures return generic `internal_error` prose;
the structured stderr log retains the diagnostic.

`AGENT_BENCHMARKS_NO_SYNC` and `--no-sync` suppress Agent Benchmarks-initiated startup, watch, and
sweep syncs. They do not disable `POST /api/sync`.

Sync responses include `repriced` when stored session or activity costs changed.
A repricing-only sync also invalidates server economics caches and emits
`archive_updated`, even when `ingested` is zero.

`GET /api/sync-status` describes the server's current sync. `in_progress` turns
true when a sync starts. `reason` and `progress` stay null until the sync has
discovered its sources and reported its first counts, and they are null again
once it ends. `archive_synced` is false only while a new archive waits for its
first completed sync: the server opened it with no sessions or ingested
sources, and no sync has finished since. A failed or cancelled sync leaves it
false. Server-Sent Events are not replayed, so a client that connects or
reconnects during a sync reads this route to restore its state.

`GET /api/date-bounds` covers visible sessions only, with no
`include_archived` opt-in. `min` and `max` are the UTC calendar days of the
earliest and latest session start. `latest_started_at` is the latest start
time itself, so a client can name that day in its own time zone. Near midnight
UTC the local day can differ from `max`.

Session archive/delete state is local metadata. Archiving hides a session from
default lists, searches, and aggregate statistics. The `include_archived`
parameter on session-list and statistics operations opts it back into those
operations; full-text and command-palette search remain limited to visible
sessions. Deletion creates a tombstone keyed to source identity, so a later sync
does not restore the session. Neither operation modifies the source JSONL file.
Deletion removes the live rows. SQLite may leave deleted text recoverable in
freed pages until `agent-benchmarks db vacuum` rewrites the archive. See
[What the archive stores](../data-lifecycle.md#what-the-archive-stores).

Session visibility also excludes sessions that hold no conversation. Claude Code
transcripts containing only local slash-command output, and Codex threads that
were created but never sent a prompt, are hidden from default lists, the
search index, and aggregate statistics in the same way as archived sessions.
Their rows stay in the archive and remain readable by id through
`GET /api/sessions/:id`. Each becomes visible once its source gains a real
prompt or reply.


`GET /api/recommendations` rows carry `project_path`, `project_root`,
`project_label`, and `project_remote`. They are set on rows about one project
(re-read files, reworked files, and searches per session) and null on rows
about the whole setup (tool and MCP error rates, usage, model spend, the
abandoned rate, ingest health) and on catalog rows. `project_root` is the
value the `repo` filter takes. The archive stores no project on a
recommendation: the key of a project row ends in a digest of its repository
root, and the fields are resolved from the `project` table on each read.

`POST /api/launch/agent` accepts a `key` only when it uses the characters
recommendation keys are built from (`A-Z a-z 0-9 . _ : / -`, at most 256).
When the key belongs to a project row, the agent starts in that row's
`project_path` if it exists and is a directory. That is one filesystem check,
made at launch and never while listing. Otherwise the agent starts in the home
directory and the prompt says the project directory was not found.
`AGENT_BENCHMARKS_SKILLS_DIR` overrides both. The response reports the directory as
`dir`. The request has no field that sets it.
`POST /api/launch/ide` requires an absolute `dir` that matches a project path or
root path in the archive. Both answer `400 invalid_request` otherwise.

`POST /api/background` accepts exactly `{ "enabled": boolean }` and only from
a loopback peer, because registering a login item persists on the machine. The
service it registers always serves the answering server's archive and port on
loopback. When `handoff` is true, the answering server stops about a quarter
second after responding so the service can bind its port. Poll
`GET /api/background` until `current` is true to know the service has taken
over. When `stopping` is true, the answering server is the service and stops
after responding. `409 background_unsupported` means this machine cannot run
the service, or the archive or executable path contains a control character
the unit file cannot hold. `500 background_failed` carries the launchd or
systemd error. Any other failure returns the generic `500 internal_error`,
and the server logs its details instead of sending them.

Report operations return self-contained, zero-JavaScript HTML. Session reports
omit transcript content by design.

Session summaries carry `cost_source`. `agent-benchmarks` means `estimated_cost_usd`
was priced from token usage at Agent Benchmarks's rates. `reported` means the source
recorded a per-request cost and Agent Benchmarks has no rate for the model, so the
recorded figure is shown (OpenCode records one; a recorded zero is never
used). `mixed` means some of the session's model rows were priced each way.
The label is decided when the session is read: a recorded figure counts only
while Agent Benchmarks still has no rate for its model, so a model that gains a rate
later reads as `agent-benchmarks` even if a figure was stored earlier.
Token-economics totals expose the reported share as `reported_cost_usd`.
`model_provider` is the provider route the model ran through when the source
records one. `GET /api/config` includes `opencodeDir`, the OpenCode data
directory being read, `cursorDir`, the Cursor CLI chats directory,
`copilotDir`, the GitHub Copilot CLI session-state directory,
`vscodeCopilotDir`, the VS Code `User` directory read for Copilot Chat,
`atifDir`, the directory read for ATIF trajectory files (null when none is
configured), `hermesDir`, the Hermes Agent home directory (null when none
is configured), and `piDir`, the Pi sessions directory (null when none is
configured). When no override is set, Agent Benchmarks also reads VS Code Insiders'
`User` directory, which `vscodeCopilotDir` does not list.

Session summaries also carry `usage_available`. It is false for a session from
a source that may record no token usage, when none of the session's messages
carries any. Those sources are Cursor CLI, which stores none, Copilot Chat in
VS Code, whose builds from before April 2026 wrote none, ATIF trajectories,
where every metric is optional, and Hermes Agent, which records usage only per
session. A session with
`usage_available: false` reports `estimated_cost_usd` and token totals of 0.
Show them as unavailable, not free. An ATIF session without per-step token
counts still has usage when its `final_metrics` record token totals, zero
included, or when its estimated cost is above zero. A Hermes session has usage
when its token totals are above zero, or when Hermes recorded an API call or a
per-model usage row for it. Stats totals,
`/api/stats/by-dimension` rows, and `/api/projects` rows carry
`usage_sessions`, the number of top-level sessions in that scope or row with
usage available. A row whose `usage_sessions` is 0 has unavailable cost. One
where it is below `sessions` reports the cost of the sessions with usage
only.

### Session listing and command-palette index

`GET /api/sessions` returns a bare newest-first array, not an envelope with a
total or continuation token. Its `limit` defaults to 50 and has an effective
maximum of 100. Increment `offset` by the number of rows received; a final short
or empty page marks the end. When the result count is an exact multiple of the
page size, one empty request is required to confirm the end.

`GET /api/sessions/{id}` returns one page of the transcript. `message_limit`
defaults to 200 when omitted or zero and has an effective maximum of 2000;
`message_offset` starts at 0. Every response carries `message_offset`,
`message_limit`, and `has_more_messages`, so a client reads a long transcript
by advancing `message_offset` until `has_more_messages` is false. The summary,
subagents, and totals describe the whole session on every page.

`GET /api/sessions/{id}/issues` lists the problems ingest recorded for the
session's source file, oldest first. Each issue's `id` is its stable row
identity, so a client can key or deduplicate issues by it.

`GET /api/files`, `GET /api/tools/usage`, and `GET /api/tools/mcp-usage` return
aggregate rows. Their `limit` has an effective maximum of 1000.

`GET /api/tools/calls` filters its rows by each call's own timestamp, so a call
lands on the day it ran. Its first-page `summary` follows the aggregate rule
instead: calls from sessions whose `started_at` falls in the window, matching
`GET /api/tools/usage` and `GET /api/tools/mcp-usage`. The summary honors
`tool`, `server`, `session`, and `project`, and ignores `errors_only` and
`min_ms`, so `summary.calls` can differ from `total`.

Request bodies larger than 1 MiB get a `413` with an empty body before they
reach a route handler.
No documented request comes close to that size.

`GET /api/sessions/search-index` returns lightweight metadata for visible,
non-archived top-level sessions, newest first, as a bare array. Its `limit`
defaults to 5000, which is also its effective maximum. Page it like
`GET /api/sessions`: increment `offset` by the rows received, and a final short
or empty page marks the end. A session is visible when it is not user-archived,
not deleted, and not an empty conversation (Claude Code sessions that contain only
local slash-command output or Codex threads that were created but never received
a prompt). The search index is the command palette's local fuzzy-search haystack
and intentionally omits transcript content.

### Evaluations

`/api/evals*` routes start, follow, and read evaluation runs. One run
is active at a time; a second `POST /api/evals` gets `409 eval_active`.

`POST /api/evals` takes a benchmark body (no `kind`, or `kind: "benchmark"`)
or a real-task body (`kind: "real"`) that runs one free prompt or one
replayed commit on a private clone of a local repository. Each setup carries
`config`: `current` uses the harness as you run it daily, `default` runs it
without your global instructions, skills, tool servers, and settings. A
real-task body is fully validated before anything is written: `repo_invalid`,
`commit_invalid`, `hidden_invalid`, `hidden_command_invalid`, and
`config_unsupported` are `400`s.

`GET /api/evals/repo?path=<abs>[&sha=<rev>]` reads a repository with git and
never changes it. It returns the remembered profile (setup command, checks,
hidden-test command) or one detected from the repository, the last 30
non-merge commits, whether the work tree is dirty (uncommitted work never
enters a run), and, with `sha`, the commit's message, changed files, and
suggested hidden test files. It also lists the local and remote-tracking
branches, newest first, for choosing a base ref.

`POST /api/evals/repo/pick` (`{ startPath? }`) opens the macOS folder chooser
on the server's screen and returns `{ path }`, null when cancelled. Other
platforms get `501`; `GET /api/evals/catalog` reports `canPickFolder`.

A real-task setup may carry `branchPrefix`. When the agent finishes, each cell's
changes are committed on the base and pushed to the repository as
`<branchPrefix>/<config>[+<augment>…]-t<trial>`. The run is rejected when one
of those branches, or a branch at one of their parent paths, already exists.

At verify, every hidden path is restored from the commit, and the hidden-test
command runs once per test-named file (`*.test.*`, `*.spec.*`, `*_test.*`,
`test_*.py`). Helpers, fixtures, and goldens are restored but not run. When no
hidden path is test-named, the command runs on each one.

Each setup may also carry `config: "clean"` (keeps the login, drops hooks,
plugins, MCP servers, settings, and instruction files) and `augments`, a list
of augment ids. Augments are rejected with `current` config and for harnesses
without a recipe. `GET /api/evals/{id}` returns `augmentVerdicts`, one row per
augmented setup with a baseline (same harness, model, config, no augments) in
that run.

Augment ids come from JSON files: the bundled `evals/augments/<id>.json`
(`rtk`, `codegraph`, `caveman`, `ponytail`, `ptc`, `bash-cap`) and the user's
`<evalDir>/augments/<id>.json`, where `evalDir` is `AGENT_BENCHMARKS_EVAL_DIR`
or `evals` next to the archive. A user file with a bundled id replaces it.
`GET /api/evals/catalog` reads both directories on every request and reports
`evalDir`, each augment's `source` (`bundled` or `user`), and an invalid file
as unavailable with a `problem` naming the field. Starting a run captures the
full definition of every augment it uses into `manifest.provenance.augments`;
the run, including a resume, executes that capture even if the file changes.

`GET /api/evals/augments` pools paired cells across every completed run that
has an augmented setup, keyed by harness, harness version, model, config, and
augments, and recomputes the verdict over the pooled pairs. Cancelled and
failed runs are left out. `recipeDrift` is true when the pooled runs captured
different augment definitions; runs without a capture count as bundled.

`GET /api/evals/catalog` also lists `combos`, saved benchmark inputs read from
`<evalDir>/combos/<id>.json`, each with the `problem` that starting it as saved
would hit (unknown augment, missing harness or task, over a limit).
`POST /api/evals/combos` saves one after the same checks as `POST /api/evals`;
the id is 1–64 lowercase letters, digits, or hyphens. An existing id returns
`409 combo_exists` unless the body has `overwrite: true`. The file is written
to a temporary name and renamed, so it is never partial.

`GET /api/evals/{id}` adds `real` for real-task runs: the task, the human
reference diff stat for replays, and per-cell diff stat, checks, hidden-test
results, overlap with the human change, turns, and tool calls. Benchmark runs
return `real: null`.

`GET /api/evals/{id}/cells/{cellId}` returns one cell's patch and the last
64 KiB of each check and hidden-test log. `cellId` is the URL-encoded
`EvalCell.cellId` (`<config>/<ach cell id>`), or `reference` for the human
change of a replay.

`GET /api/evals/{id}/cells/{cellId}/events?after=<seq>` returns the agent's
recorded steps for one cell (messages, tool calls, tool results, spend, errors)
projected from the harness's raw transcript, plus `state` (`live`, `done`,
`queued`, or `unknown`), `startedAt`, `nextSeq`, and whole-transcript `totals`.
`seq` is the transcript line index, so `after=<nextSeq>` fetches only newer
steps; malformed lines and a half-written last line are skipped. A cell is
`live` only while its agent process is alive; `GET /api/evals/{id}` reports it
as `progress.liveCellId`, which is `null` when it cannot be determined (for
example a real-task run after a server restart). Summaries are cut at 160
characters and details at 16 KiB. `after` must be a non-negative integer
(`400 invalid_request`); an unknown run or cell is `404 not_found`.

`GET /api/evals/{id}/report.html` downloads a zero-JavaScript report with
inline styles: run metadata, the summary table with the human reference,
each combo's diff, check and hidden-test results, and a transcript summary
(turns, tool calls, errors) without transcript text. It answers
`409 eval_active` while the run is still running.

## Server-Sent Events

`GET /api/events` returns `text/event-stream`. The current event names are:

- `hello` — connection acknowledgement
- `ping` — heartbeat, normally every five seconds
- `ready` — source watcher initialized
- `sync_progress` — bounded progress snapshot for a running sync
- `sync` — terminal successful sync report
- `archive_updated` — archive-derived UI data changed; `reason` distinguishes
  the startup sync and background watcher activity from manual syncs,
  statistics rebuilds, and session-state changes
- `eval_progress` — an evaluation's progress, status, and live cell changed
- `eval_cell_activity` — the live cell recorded new steps. It carries only
  `runId`, `cellId`, and `seq`; step content is fetched per cell from
  `GET /api/evals/{id}/cells/{cellId}/events`
- `error` — watcher or sync failure
- `stopped` — source watcher stopped

Each `data` field is JSON and includes a matching `type`. The OpenAPI operation's
`x-sse-events` extension defines the payload schema for each name.

The server holds at most 32 event streams. Another request gets
`503 server_busy` with `retryable: true`. Events wait for a client that is
reading slowly and arrive in order. When more than 1 MiB is waiting, the server
discards it and ends the stream rather than dropping single events, because
`sync` and `error` are terminal. `EventSource` reconnects after the stream
ends, and the UI then reloads or offers the update it may have missed.
