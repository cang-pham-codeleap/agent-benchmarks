# API contract changes

## GET /api/evals/catalog
Adds:
- `evalDir: string`: resolved user eval config dir.
- `augments[].source: "bundled" | "user"`.
- `combos: EvalComboInfo[]` where `EvalComboInfo = { id, label, setups: EvalSetup[], taskIds: string[], trials: number, wallMs: number, problem: string | null }`.

`augments[].id` is now any validated id string, not a fixed enum.

## GET /api/evals/augments
Each pool entry adds `recipeDrift: boolean`.

## POST /api/evals/combos
Request:
```json
{ "id": "ptc-context-mode", "label": "PTC + context-mode", "setups": [...], "taskIds": [...], "trials": 3, "wallMs": 900000, "overwrite": false }
```
Responses:
- `200` → `EvalComboInfo` (problem `null`).
- `400` → invalid id (`/^[a-z0-9][a-z0-9-]{0,63}$/`), invalid label, or any `validateInput` failure (existing error codes such as `augment_unknown`, `augments_unsupported`, `config_unsupported`).
- `409 combo_exists` → file exists and `overwrite` is not `true`.
- `503` → harness missing or augment unavailable (existing codes `harness_missing`, `augment_unavailable`).
