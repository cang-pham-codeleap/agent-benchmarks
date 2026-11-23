---
name: verify-sync-protocol
description: Model-check the sync, Update button and archive_updated protocol with TLC. Use when changing reduceSync or its events in src/ui/sync-events.ts, the sync wiring in src/ui/main.tsx, what src/server/sync.ts, src/server/routes.ts or the EconomicsCache onRebuilt callback in src/server.ts publish, or when a bug report says Update keeps coming back, the Sync button spins, or the page shows stale data.
---

# Verify the sync protocol

`models/sync-protocol/SyncProtocol.tla` is a TLA+ model of the server's sync
pipeline, the event stream and the page's `reduceSync`. TLC checks every order
of events within a bound. Four past bugs needed eleven fixes here
(854ab2b #191, 920482f #272, ce8a8a3 #292), each found by a user, so check
the model on every change to the covered code.

## Rules it checks

Each rule is an INVARIANT in the model. The harm is what a user sees when it
breaks.

| Invariant | Rule | Harm when broken |
|---|---|---|
| `CompleteOnlyWhenIdle` | "Sync complete" never shows while a sync runs. | A full bar reads complete while the next sync runs, and the old timer clears its counts (920482f). |
| `UpdateMeansNewActivity` | Update is offered only for activity announced since the page last reloaded. | Update comes back right after a click (ce8a8a3). |
| `NoStuckSync` | Once the server is idle and every message has landed, the Sync button is not spinning. | The button stays disabled until a reload (854ab2b). |
| `NoSilentStaleness` | Once everything has landed, the page shows the server's data, offers Update, or shows an error. | The dashboard keeps partial data with nothing telling the user (920482f). |

## Does my change touch it?

Coverage record. Each row maps code to the model operator that stands for it.

| Code | Model |
|---|---|
| `reduceSync` in `src/ui/sync-events.ts`, one case per `SyncEvent` | `Client*` operators, one per event (`ClientSyncClicked` is `sync_clicked`, and so on) |
| `planArchiveUpdate`, `restoreSync`, `supersededStatus`, `showsSync`, `INITIAL_SYNC_STATE` | `PlanArchiveUpdate`, `ClientStatusAnswered`, `ShowsSync`, `InitialSyncState` |
| `dispatchSync` effects in `src/ui/main.tsx` (`refresh`, `read_status`, `post_sync`) | `Apply` (refresh loads `serverData`, reads join `reads`, a post becomes `post = "sent"`) |
| SSE handlers in `main.tsx` (`handleProgress`, `handleSync`, `handleError`, `handleArchiveUpdated`, `handleOpen`, `markConnected`) | `ClientReceivesEvent`, `StreamOpens`, `StreamDrops` |
| `syncNow` and `runWithOwnership` in `src/server/sync.ts` | `ServerOwnsPost`, `ServerJoinsPost`, `ServerProgress`, `ServerEndSync`, `ServerFailSync`, `ClientReceivesPostReply` |
| `applyWatchEvent` and `syncStatusBody` in `src/server/sync.ts` | `ServerStartSync`, `ServerEndSync`, `ServerAnswersStatus` |
| `EconomicsCache` `invalidate` and its build queue in `src/economics-cache.ts`; `onRebuilt` publishing `stats` in `src/server.ts` | `Invalidate`, `EconRebuildOnRead`, `EconBuildEnds` |
| Session archive and delete publishing `session_state` in `src/server/routes.ts` | `ServerSessionStateChange` |
| `publishServerEvent` and `eventStream` in `src/server/sse.ts` | `Publish` (events published while the stream is down are lost) |

Sync commit: `9c6213c09d5b5e3070794c980af4f83b2ee75fb6`. At that commit the
model describes the code above. Run `git diff 9c6213c -- src/ui/sync-events.ts
src/ui/main.tsx src/server/sync.ts src/server/sse.ts src/server/routes.ts
src/server.ts src/economics-cache.ts` to see what changed since. Move the
sync commit forward only after you confirm the model still describes the code
at the new commit.

## Run

```sh
bun run scripts/check-sync-model.ts
```

It needs Java 11 or later as `java` on PATH, or set `JAVA` to a java binary.
It downloads `tla2tools.jar` 1.7.4 once into `~/.cache/agent-benchmarks/` and
checks its sha256. CI runs the same command in the `sync-model` job of
`.github/workflows/ci.yml`. It takes about 15 seconds. Pass config file names
to run only those, as in `bun run scripts/check-sync-model.ts SyncProtocol.cfg`.

Each `.cfg` in `models/sync-protocol/` names its expected outcome on its first
line (`\* expect: pass` or `\* expect: <Invariant>`). The script fails when TLC
reports anything else. Expected output:

```
ok   SyncProtocol.cfg: pass (916889 distinct states)
ok   SyncProtocol.connecting.cfg: NoStuckSync (...)
ok   SyncProtocol.fix3.cfg: UpdateMeansNewActivity (...)
ok   SyncProtocol.pre292.cfg: UpdateMeansNewActivity (...)
ok   SyncProtocol.window.cfg: CompleteOnlyWhenIdle (...)
```

- `SyncProtocol.cfg` is the code today. It must pass.
- `pre292`, `fix3` and `window` set `Variant` to page logic from before a
  past fix. They must keep failing; that proves each rule can fail.
- `connecting` is an open finding (below). It fails until someone fixes it.

## Read a result

Read every TLC result with the pstack `/statechart` skill on
`models/sync-protocol/SyncProtocol.tla` and the config in question. For a
violation it gives the shortest path to the broken rule in plain words. For a
pass it draws how the page moves between states. Tell the path to the user in
the code's words: name the `SyncEvent`s and the server step (`syncNow`,
`applyWatchEvent`, an `EconomicsCache` build) in order.

Real bug or modeling error? Replay the path against the real reducer as a
test in `test/ui-sync-events.test.ts`, one `SyncEvent` per `Client*` step,
with the `run` helper there. Server steps become the events they publish, and
a step during a dropped stream publishes nothing. If the reducer does what the
model says, the bug is real: report it with the path. If it does not, the
model is wrong: fix the `Client*` operator to match the code, not the rule.

Never weaken an invariant or shrink the model to make a run pass.

## Change the model with the code

- Changed a `reduceSync` case: change the matching `Client*` operator the
  same way, then run. Keep the `Variant` branches that reproduce past bugs.
- Added a `SyncEvent`: add a `Client*` operator and an action in `Next` that
  delivers it from where the code dispatches it.
- Changed what the server publishes or when: change the `Server*` action.
- Fixed the open finding: change `connecting`'s first line to `\* expect: pass`.
- Then move the sync commit above to the commit you checked.

## Scope

Verified: every interleaving of the actions in `Next` with `MaxStimuli = 1`
(one of: a sync started by a watcher or another tab, a Sync click, a rebuild
started by a read, a session archive, a stream drop, a failed status read),
on top of a startup sync that may be running at page load and any number of
the steps those cause. A deeper run with `MaxStimuli = 2` found no violation
on the current code at the sync commit (93,519,541 distinct states, about
seven minutes on ten cores); it is too slow for CI.

Assumed: no server activity before the page's EventSource first connects
(`ActivityWhileConnecting = FALSE`). The `connecting` config drops that
assumption and shows the finding.

Not modeled: the live Sessions auto-refresh (`live_refresh`,
`live_sessions_due`), the reconnect path that refreshes failed slices,
Retry buttons (`refresh_requested`), the progress throttle, the 100 ms
refresh debounce, a Sync click while this page's own POST is still out,
cancelled syncs, and more than one page (another tab appears only as a
server sync with reason `manual`).

## Open finding

Path (`SyncProtocol.connecting.cfg`): the page mounts and reads its data and
the sync status. A startup sync is running on a never-synced archive, so the
status answer shows it (`status_answered`, syncing). The sync ends before the
EventSource connects, so its `sync` event is lost. The stream opens and the
page reads the status again (`stream_message` opened). That read fails
(`status_failed` with `reconnect: false`), which `reduceSync` ignores. The
Sync button spins until a reload. The same window also lets a session archive
or a watcher sync go unannounced, which breaks `NoSilentStaleness`. Replayed
on `reduceSync`: the page stays `syncing: true` after the four events.
