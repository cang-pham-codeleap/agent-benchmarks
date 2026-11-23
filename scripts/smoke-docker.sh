#!/usr/bin/env bash
# Builds the image and checks it the way a user runs it. Needs Docker.
set -euo pipefail
cd "$(dirname "$0")/.."

image=agent-benchmarks:smoke
container=agent-benchmarks-smoke
volume=agent-benchmarks-smoke-data
# A user bridge inside 172.16.0.0/12, the range AGENT_BENCHMARKS_TRUST_DEFAULT_GATEWAY trusts;
# some Docker hosts (OrbStack) put the default bridge elsewhere.
network=agent-benchmarks-smoke-net
work="$(mktemp -d)"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

bun_version="$(cat .bun-version)"
if ! grep -Eq "^FROM oven/bun:${bun_version//./\\.}-slim(@sha256:[0-9a-f]{64})? AS build$" Dockerfile; then
  echo "smoke-docker: Dockerfile builder must be oven/bun:${bun_version}-slim to match .bun-version" >&2
  exit 1
fi

docker build --platform linux/amd64 -t "$image" .
docker run --rm --platform linux/amd64 "$image" --help >/dev/null
test "$(docker image inspect "$image" --format '{{.Config.User}}')" = '999:999'

id="$(docker create --platform linux/amd64 "$image")"
docker cp "$id:/etc/passwd" "$work/passwd"
docker cp "$id:/etc/group" "$work/group"
docker export "$id" -o "$work/rootfs.tar"
docker rm -v "$id" >/dev/null
python3 - "$work/rootfs.tar" <<'PYTHON'
import sys, tarfile
with tarfile.open(sys.argv[1]) as archive:
    entries = {entry.name.removeprefix('./'): entry for entry in archive}
    for source in ('claude', 'codex', 'gemini', 'cursor', 'copilot', 'vscode', 'atif'):
        directory = entries[f'sources/{source}']
        assert directory.isdir() and (directory.uid, directory.gid) == (999, 999), source
    assert 'bin/sh' not in entries and 'usr/bin/apt' not in entries
PYTHON
grep -Fxq 'agent-benchmarks:x:999:999::/var/lib/agent-benchmarks:/sbin/nologin' "$work/passwd"
grep -Fxq 'agent-benchmarks:x:999:' "$work/group"

docker network create --subnet 172.30.0.0/16 "$network" >/dev/null
docker volume create "$volume" >/dev/null
docker run -d --platform linux/amd64 --name "$container" --network "$network" \
  -v "$volume:/var/lib/agent-benchmarks" -p 127.0.0.1:3997:3000 "$image" >/dev/null
status=""
for _ in $(seq 1 30); do
  status="$(curl -sS -o "$work/health.json" -w '%{http_code}' http://127.0.0.1:3997/api/health || true)"
  [ "$status" = "200" ] && break
  sleep 1
done
if [ "$status" != "200" ]; then
  echo "smoke-docker: /api/health answered '$status' through the published port" >&2
  docker logs "$container" >&2 || true
  exit 1
fi
docker cp "$container:/var/lib/agent-benchmarks/agent-benchmarks.db" "$work/smoke.db"
test "$(head -c 15 "$work/smoke.db")" = 'SQLite format 3'
echo "smoke-docker: ok"
