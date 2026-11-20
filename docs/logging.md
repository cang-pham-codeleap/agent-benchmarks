# Operational logging

`agent-benchmarks watch` and `agent-benchmarks serve` emit newline-delimited JSON (JSON Lines) to
stderr. Command results and `--json` data remain on stdout, so scripts can
consume them without parsing operational logs.

Each record has the same base fields:

- `@timestamp`: ISO 8601 event time.
- `level`: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, or `FATAL`.
- `message`: short human-readable description.
- `logger`: hierarchical component name such as `agent-benchmarks.server`.
- `service.name`: always `agent-benchmarks`.
- `event.name`: stable, fully qualified event type.

The current event names are:

| Event | Purpose |
| --- | --- |
| `agent-benchmarks.logging.configuration.invalid` | Invalid log level fell back to `info`. |
| `agent-benchmarks.watch.ready` | Source watcher initialized. |
| `agent-benchmarks.watch.stopped` | Source watcher stopped. |
| `agent-benchmarks.sync.completed` | One startup, watch, sweep, or manual sync completed. |
| `agent-benchmarks.sync.exception` | A sync failed. |
| `agent-benchmarks.server.started` | Local HTTP server started. |
| `agent-benchmarks.server.stopped` | Local HTTP server stopped. |
| `http.server.request` | HTTP request completed with method, route, status, and duration. |
| `http.server.request.exception` | Request handling raised an exception. |
| `http.server.request.rejected` | Request handling mapped a rejected operation to a non-5xx API response. |

Set `AGENT_BENCHMARKS_LOG_LEVEL` to `trace`, `debug`, `info`, `warn` (or `warning`),
`error`, `fatal`, or `off` (or `silent`). The default is `info`. HTTP 4xx
outcomes use `WARN`; 5xx outcomes and exceptions use `ERROR`.

Logging is local and has no network transport. Completed `http.server.request`
records use route templates. Rejection and exception diagnostics use the URL
path, but no request record includes query strings, headers, bodies,
source-directory paths, or transcript content. Exception records include the
runtime error message and stack trace, which can contain local code or database
paths. Redirect or pipe stderr to an external processor if retention, rotation,
or shipping is needed; those policies stay outside the application process.
