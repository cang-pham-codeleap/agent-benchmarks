# Your own augments and combos

An augment is a tool or mode added to a harness for an evaluation: a hook, an
MCP server, a system-prompt file, a flag, or an environment variable. A combo
is a saved benchmark form: setups, tasks, trials, and timeout. Both are JSON
files in a directory you own, so you can benchmark your own agent setup without
changing this repository.

## Where the files live

The eval directory is `AGENT_BENCHMARKS_EVAL_DIR` when it is set, otherwise
`evals/` next to the archive (`~/.agent-benchmarks/evals/` with the default
archive), the same directory that holds the run directories.
`GET /api/evals/catalog` reports it as `evalDir`.

```text
<evalDir>/
  augments/<id>.json   one augment per file
  combos/<id>.json     one combo per file, written by "Save as combo…"
```

An id is the file name without `.json`: 1 to 64 lowercase letters, digits, or
hyphens, starting with a letter or digit. Files are read on every catalog
request; reload the Evaluating page after editing one. `serve` does not need a
restart.

## Augment files

```json
{
  "label": "Context mode",
  "kind": "mcp",
  "description": "Keeps large tool output out of the context window.",
  "sourceUrl": "https://github.com/mksglu/context-mode",
  "binary": "context-mode",
  "recipes": {
    "claude": {
      "mcpServers": {
        "context-mode": { "type": "stdio", "command": "context-mode", "args": [] }
      }
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `label`, `description`, `sourceUrl` | What the form and results show |
| `kind` | `shell-proxy`, `mcp`, `prompt-mode`, or `harness-flag` |
| `binary` | A command that must be on `PATH`, or `null`. When it is missing the augment shows as unavailable |
| `recipes` | One recipe per harness: `claude`, `codex`, `copilot`, `opencode`, `omp`, `droid`. The augment is offered only for these harnesses |

A recipe can hold:

| Field | Effect |
| --- | --- |
| `args` | Appended to the harness command line. `{dir}` becomes the run's `augments/` directory |
| `env` | Environment variables for the agent, string values only |
| `files` | Files written to the run's `augments/` directory, by plain file name. Each is `{ "json": {...} }` or `{ "from": "path" }` |
| `mcpServers` | MCP servers, merged into the group's `--mcp-config` file. Only Claude Code takes them; for other harnesses pass the harness's own flag in `args` |
| `addTools` | OMP tools added to the clean tool list |
| `prepare` | `{ "command": "...", "exclude": [...] }`, run once in each cell workspace before the agent starts; `exclude` paths go in `.git/info/exclude` |

A relative `from` is read from the `augments/` directory the file sits in. A
`from` starting with `~/` is read from your home directory. A `from` that
resolves outside those directories is rejected. A missing `from` file makes the
augment unavailable, with the path as the reason.

Unknown fields, unknown harnesses, and wrong types are errors. A file with an
error still appears in the form, disabled, with the file path and the problem.
Augments apply only to `clean` and `default` setups.

### Replacing a bundled augment

The bundled augments are in this repository's `evals/augments/` (`rtk`,
`codegraph`, `caveman`, `ponytail`, `ptc`, `bash-cap`). A user file with the
same id replaces the bundled one, and the form marks it with a `user` badge.
This `ptc.json` keeps OMP's recipe and adds one for Claude Code that serves a
tool-calling MCP server you run yourself (`ptc-mcp` stands in for its command):

```json
{
  "label": "Programmatic tool calling",
  "kind": "harness-flag",
  "description": "OMP's eval tool, or a scripting MCP server for Claude Code.",
  "sourceUrl": "https://github.com/can1357/oh-my-pi",
  "binary": null,
  "recipes": {
    "omp": { "addTools": ["eval"] },
    "claude": {
      "mcpServers": { "ptc": { "type": "stdio", "command": "ptc-mcp", "args": [] } }
    }
  }
}
```

## Runs remember their augments

When a run starts, the definition of each augment it uses, with `from` files
resolved, is written to `manifest.json` under `provenance.augments` with a
sha256 of the canonical definition. The hash counts a `from` file by its
content, not its path, so the same augment hashes the same on every machine
and checkout, and editing the file changes the hash. Resuming the run uses that copy,
so editing or deleting an augment file later does not change a run in flight.
Runs recorded before this existed use the bundled definitions.

The augment recommendations pool runs by harness, version, model, config, and
augment ids. When the pooled runs recorded different definition hashes for the
same augments, the row shows a `recipe drift` warning; see
[the augment verdict](analytics-methodology.md#augment-verdict).

## Combos

Fill the benchmark form, click "Save as combo…", and give an id and a label.
The file holds the label, setups, tasks, trials, and timeout:

```json
{
  "label": "Claude: rtk vs codegraph",
  "setups": [
    { "harness": "claude", "model": "sonnet", "config": "clean", "augments": [] },
    { "harness": "claude", "model": "sonnet", "config": "clean", "augments": ["rtk"] },
    { "harness": "claude", "model": "sonnet", "config": "clean", "augments": ["codegraph"] }
  ],
  "taskIds": ["arch-break-cycle"],
  "trials": 3,
  "wallMs": 900000
}
```

Saving an id that exists asks before it overwrites. Combos appear as cards
above the setups; clicking one fills the form as a custom preset. A combo that
cannot start as saved, such as one naming an augment you deleted or a harness
you do not have, still shows, with the reason. Loading it leaves out the
missing augments, tasks, and setups of uninstalled harnesses and lists what it
left out. Combo files can be written by hand or shared with a teammate.

The API is `POST /api/evals/combos`; see [the routes](api/routes.md).
