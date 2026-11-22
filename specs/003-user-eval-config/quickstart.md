# Quickstart: verify user augments and combos

```bash
export AGENT_BENCHMARKS_EVAL_DIR=$(mktemp -d)
export AGENT_BENCHMARKS_EVAL_ALLOW_NULL=1
mkdir -p "$AGENT_BENCHMARKS_EVAL_DIR/augments"
cat > "$AGENT_BENCHMARKS_EVAL_DIR/augments/demo.json" <<'EOF'
{ "label": "Demo", "kind": "harness-flag", "description": "Sets AB_DEMO=1.",
  "sourceUrl": "https://example.invalid/demo", "binary": null,
  "recipes": { "null": { "env": { "AB_DEMO": "1" } } } }
EOF
bun run src/cli.ts serve --db "$(mktemp -d)/scratch.db" --no-sync
```

1. Open the Evaluating view. `Demo` appears with a `user` badge on a `null` clean setup.
2. Configure a null clean setup and a null clean + Demo setup, pick the smoke tasks, click "Save as combo…", id `demo`.
3. Reload. The `demo` card appears; clicking it restores the form.
4. Start the run. `manifest.json` in the run dir contains `provenance.augments.demo`.
