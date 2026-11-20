# Compare harnesses and models

The Compare view groups tasks by the root session's harness, provider, and
primary model. A task consists of one root session and all its descendant
subagents. Date, project, work type, and transcript-ending filters apply to the
root, so a child remains part of its task even if its own date or project
differs. Models are displayed as `provider/model` when the provider is known,
or as the bare model otherwise. The model filter distinguishes providers; older
saved model-only selections are discarded. Expand a row to inspect recorded
usage by provider and model. The sessions link matches the harness and model
across all providers.

Each cell displays the number of tasks. Sort by any metric; a star marks the
best value among cells meeting the minimum task count, which defaults to five.
Comparisons remain observational: tasks can differ in difficulty and the
transcript-ending classification is a heuristic, not a success measure.
Unclassified outcomes remain in the rate denominator.

Cost uses stored estimated cost on a common list-price basis. A task is
unpriced if any session has unavailable usage or an unpriced model, including
secondary models. Entire unpriced tasks are excluded from cost sums,
percentiles, subagent cost share, and output tokens per dollar; the table shows
their count. A cell with no priced task shows unavailable cost, not zero.
Percentiles use the nearest rank among priced tasks. The subagent share uses
priced tasks only; cache read share is cache reads divided by input, cache reads,
and cache writes. Active time sums session active seconds per task before the
median. Token totals include unpriced tasks. Per-provider/model usage comes
from recorded session model usage and may be absent when a source did not
provide it. Providers are null when unknown; model names remain unprefixed for
pricing.

The local API is `GET /api/analytics/compare`; see the
[route guide](api/routes.md) and [OpenAPI contract](api/openapi.yaml).
