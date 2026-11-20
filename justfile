# agent-benchmarks developer tasks. `just` lists recipes; `just check` is the local definition of done.

default:
    @just --list --unsorted

# Quality gates
[group('gates')]
check: ts-check

[group('gates')]
ts-check:
    bun test
    bunx tsc --noEmit
    bunx biome check .
    bun run scripts/pr-policy.ts


# TypeScript
[group('ts')]
test *ARGS:
    bun test {{ARGS}}

[group('ts')]
typecheck:
    bunx tsc --noEmit

[group('ts')]
lint:
    bunx biome check .

[group('ts')]
fmt:
    bunx biome check --write .

# Compile Bun standalone binaries (`ARGS`: --target native|all|darwin-arm64|...)
[group('dist')]
build-binary *ARGS:
    bun run scripts/build-binaries.ts {{ARGS}}


# Build a local Docker image
[group('dist')]
docker-build *ARGS:
    docker build --platform linux/amd64 -t agent-benchmarks:local {{ARGS}} .


# CLI
[group('cli')]
sync *ARGS:
    bun run src/cli.ts sync {{ARGS}}

[group('cli')]
watch *ARGS:
    bun run src/cli.ts watch {{ARGS}}

[group('cli')]
serve *ARGS:
    bun run src/cli.ts serve {{ARGS}}

[group('cli')]
ls *ARGS:
    bun run src/cli.ts ls {{ARGS}}

[group('cli')]
search QUERY *ARGS:
    bun run src/cli.ts search "{{QUERY}}" {{ARGS}}

[group('cli')]
stats *ARGS:
    bun run src/cli.ts stats {{ARGS}}

[group('cli')]
db-info *ARGS:
    bun run src/cli.ts db info {{ARGS}}

# Data / maintenance
[group('data')]
[confirm("Delete ~/.agent-benchmarks/agent-benchmarks.db and re-ingest every source directory?")]
db-rebuild:
    rm -f ~/.agent-benchmarks/agent-benchmarks.db ~/.agent-benchmarks/agent-benchmarks.db-wal ~/.agent-benchmarks/agent-benchmarks.db-shm
    bun run src/cli.ts sync

[group('data')]
hooks:
    pre-commit install

# Print a redacted environment report for bug reports
[group('cli')]
doctor *ARGS:
    bun run src/cli.ts doctor {{ARGS}}

# The CI policy checks against origin/main (or BASE)
[group('gates')]
policy BASE="origin/main":
    bun run scripts/pr-policy.ts --base {{BASE}}
