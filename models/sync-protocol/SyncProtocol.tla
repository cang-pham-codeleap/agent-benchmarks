---------------------------- MODULE SyncProtocol ----------------------------
(***************************************************************************)
(* The sync, Update button and archive_updated protocol.                   *)
(*                                                                         *)
(* Server side: syncNow and applyWatchEvent in src/server/sync.ts, the     *)
(* rebuild queue in src/economics-cache.ts, the event stream in            *)
(* src/server/sse.ts. Page side: reduceSync in src/ui/sync-events.ts. Each *)
(* Client* operator below is one reduceSync case, named after its event.   *)
(*                                                                         *)
(* Variant selects the page logic: "current" is reduceSync today. The      *)
(* others reintroduce past bugs so TLC can show each rule failing:         *)
(*   "pre292"  planArchiveUpdate before ce8a8a3 (#292)                      *)
(*   "fix3"    ce8a8a3's third attempt, where only an Update click and the  *)
(*             plan marked the page caught up                              *)
(*   "window"  a new sync keeps the last sync's completion flag (920482f)   *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS Variant, MaxStimuli, ActivityWhileConnecting

None == "none"
Foreground == {"manual", "startup"}

ShowsSync(reason, archiveSynced) == ~archiveSynced \/ reason \in Foreground

PlanArchiveUpdate(reason, caughtUp, foregroundSyncRunning) ==
  IF Variant = "pre292" THEN
    CASE reason \in Foreground ->
           [refresh |-> TRUE, offer |-> FALSE, caughtUp |-> TRUE]
      [] reason = "stats" /\ caughtUp ->
           [refresh |-> TRUE, offer |-> FALSE, caughtUp |-> FALSE]
      [] reason = "session_state" ->
           [refresh |-> TRUE, offer |-> FALSE, caughtUp |-> caughtUp]
      [] OTHER ->
           [refresh |-> FALSE, offer |-> ~foregroundSyncRunning, caughtUp |-> caughtUp]
  ELSE
    CASE reason \in Foreground \/ reason = "session_state" \/ (reason = "stats" /\ caughtUp) ->
           [refresh |-> TRUE, offer |-> FALSE, caughtUp |-> TRUE]
      [] foregroundSyncRunning ->
           [refresh |-> FALSE, offer |-> FALSE, caughtUp |-> caughtUp]
      [] OTHER ->
           [refresh |-> FALSE, offer |-> TRUE, caughtUp |-> FALSE]

InitialSyncState ==
  [syncing |-> FALSE, manualPending |-> FALSE, complete |-> FALSE,
   archiveSynced |-> TRUE, updateOffered |-> FALSE, caughtUp |-> Variant # "pre292",
   error |-> FALSE, liveDropped |-> FALSE, sawSync |-> FALSE,
   statusRead |-> 0, statusApplied |-> 0, syncEnded |-> 0]

(* A reduceSync step: the next state and its effects. *)
Same(s) == [s |-> s, refresh |-> FALSE, read |-> {}, post |-> FALSE]

RefreshMarksCaughtUp == Variant \in {"current", "window"}

Refresh(r, marks) == [r EXCEPT !.refresh = TRUE, !.s.caughtUp = IF marks THEN TRUE ELSE @]

ReadStatus(r, reconnect) ==
  [r EXCEPT !.s.statusRead = @ + 1,
            !.read = {[read |-> r.s.statusRead + 1, endedBefore |-> r.s.syncEnded,
                       reconnect |-> reconnect]}]

FinishSync(s) ==
  Refresh(Same([s EXCEPT !.updateOffered = FALSE, !.syncing = FALSE, !.complete = TRUE]),
          RefreshMarksCaughtUp)

ClientSyncClicked(s) ==
  [Same([s EXCEPT !.error = FALSE, !.complete = FALSE, !.updateOffered = FALSE,
                  !.syncing = TRUE, !.manualPending = TRUE])
     EXCEPT !.post = TRUE]

ClientManualSyncDone(s) ==
  FinishSync([s EXCEPT !.manualPending = FALSE, !.syncEnded = @ + 1, !.archiveSynced = TRUE])

ClientManualSyncFailed(s) ==
  Same([s EXCEPT !.manualPending = FALSE, !.syncEnded = @ + 1, !.syncing = FALSE,
                 !.error = TRUE])

ClientSyncProgress(s, reason) ==
  IF ~ShowsSync(reason, s.archiveSynced) THEN Same(s)
  ELSE Same([s EXCEPT !.syncEnded = IF s.syncing THEN @ ELSE @ + 1,
                      !.complete = IF s.syncing \/ Variant = "window" THEN @ ELSE FALSE,
                      !.syncing = TRUE])

ClientSyncEnded(s, reason) ==
  LET ended == [s EXCEPT !.syncEnded = @ + 1, !.archiveSynced = TRUE]
  IN IF ~ShowsSync(reason, s.archiveSynced) \/ (reason \notin Foreground /\ s.manualPending)
     THEN Same(ended)
     ELSE FinishSync([ended EXCEPT !.error = FALSE])

ClientSyncFailed(s, reason) ==
  LET counted == [s EXCEPT !.syncEnded = @ + 1]
  IN IF ShowsSync(reason, s.archiveSynced) /\ (reason \in Foreground \/ ~s.manualPending)
     THEN Same([counted EXCEPT !.syncing = FALSE, !.error = TRUE])
     ELSE Same(counted)

ClientArchiveUpdated(s, reason) ==
  LET plan == PlanArchiveUpdate(reason, s.caughtUp, s.syncing)
      planned == [s EXCEPT !.caughtUp = plan.caughtUp]
  IN CASE plan.refresh ->
            Refresh(Same([planned EXCEPT !.updateOffered = FALSE]), RefreshMarksCaughtUp)
       [] plan.offer -> Same([planned EXCEPT !.updateOffered = TRUE])
       [] OTHER -> Same(planned)

ClientUpdateClicked(s) ==
  Refresh(Same([s EXCEPT !.updateOffered = FALSE]), Variant # "pre292")

ClientCompleteElapsed(s) == Same([s EXCEPT !.complete = FALSE])

ClientStreamMessage(s, opened) ==
  CASE s.liveDropped ->
         ReadStatus(Same([s EXCEPT !.liveDropped = FALSE, !.updateOffered = TRUE,
                                   !.caughtUp = FALSE]), TRUE)
    [] opened -> ReadStatus(Same(s), FALSE)
    [] OTHER -> Same(s)

ClientStreamDropped(s) == Same([s EXCEPT !.liveDropped = TRUE])

ClientStatusAnswered(s, a) ==
  LET running == a.inProgress /\ ShowsSync(a.reason, a.archiveSynced)
  IN CASE a.read # s.statusRead ->
            LET seen == [s EXCEPT !.sawSync = @ \/ running]
            IN IF running /\ s.statusApplied = s.statusRead /\ ~s.syncing
               THEN ReadStatus(Same(seen), a.reconnect)
               ELSE Same(seen)
       [] a.endedBefore # s.syncEnded -> ReadStatus(Same(s), a.reconnect)
       [] OTHER ->
            LET syncing == running \/ s.manualPending
                ended == (s.syncing \/ s.sawSync) /\ ~s.manualPending /\ ~running
                applied == [s EXCEPT !.statusApplied = a.read, !.sawSync = FALSE,
                                     !.archiveSynced = a.archiveSynced, !.syncing = syncing,
                                     !.complete = IF syncing THEN FALSE ELSE @,
                                     !.error = IF syncing THEN FALSE ELSE @]
            IN IF ended
               THEN Refresh(Same([applied EXCEPT !.updateOffered = FALSE,
                                   !.error = IF ~a.inProgress /\ a.lastError THEN TRUE ELSE @]),
                            RefreshMarksCaughtUp)
               ELSE Same(applied)

ClientStatusFailed(s, reconnect) ==
  IF reconnect /\ ~s.manualPending THEN Same([s EXCEPT !.syncing = FALSE]) ELSE Same(s)

VARIABLES
  page,        \* SyncState held by main.tsx
  pageData,    \* the server data version the page last loaded
  announced,   \* activity was announced since the page last reloaded
  sync,        \* reason of the server's running sync, or None
  named,       \* the running sync has published progress, so status reports its reason
  archiveSynced, lastError, serverData,
  econ,        \* EconomicsCache: "idle", "building", or "queued" (one build plus one more)
  streamUp, stream,
  reads,       \* status reads sent, not yet answered by the server
  answers,     \* status answers on the wire, delivered in any order
  post,        \* this page's POST /api/sync: None, "sent", "owned", "joined", "ok", "failed"
  stimuli

vars == <<page, pageData, announced, sync, named, archiveSynced, lastError, serverData,
          econ, streamUp, stream, reads, answers, post, stimuli>>

Event(type, reason) == [type |-> type, reason |-> reason]

Publish(events) == IF streamUp THEN stream \o events ELSE stream

Invalidate(e) == IF e = "idle" THEN "building" ELSE "queued"

Apply(r, announces, readsBefore, postBefore) ==
  /\ page' = r.s
  /\ pageData' = IF r.refresh THEN serverData ELSE pageData
  /\ announced' = IF r.refresh THEN FALSE ELSE announced \/ announces
  /\ reads' = readsBefore \cup r.read
  /\ post' = IF r.post THEN "sent" ELSE postBefore

Init ==
  /\ sync \in {None, "startup"}
  /\ named = FALSE
  /\ archiveSynced \in BOOLEAN
  /\ lastError = FALSE
  /\ serverData = 0
  /\ econ = "idle"
  /\ streamUp = FALSE
  /\ stream = <<>>
  /\ answers = {}
  /\ post = None
  /\ stimuli = 0
  /\ LET loaded == ReadStatus(Same(InitialSyncState), FALSE)
     IN /\ page = loaded.s
        /\ reads = loaded.read
  /\ pageData = 0
  /\ announced = FALSE

(* The page loaded its data at mount, and its EventSource has not connected yet. *)
Connecting == ~streamUp /\ ~page.liveDropped

ServerActive == ActivityWhileConnecting \/ ~Connecting

ServerVars == <<sync, named, archiveSynced, lastError, serverData, econ>>

(* syncNow without a running sync, or a watcher, sweep, or another tab's Sync click. *)
ServerStartSync ==
  /\ sync = None /\ stimuli < MaxStimuli /\ ServerActive
  /\ \E reason \in {"watch", "manual"}:
       /\ sync' = reason
       /\ named' = FALSE
       /\ lastError' = FALSE
  /\ stimuli' = stimuli + 1
  /\ UNCHANGED <<page, pageData, announced, archiveSynced, serverData, econ, streamUp, stream,
                 reads, answers, post>>

ServerOwnsPost ==
  /\ post = "sent" /\ sync = None
  /\ sync' = "manual" /\ named' = FALSE /\ lastError' = FALSE /\ post' = "owned"
  /\ UNCHANGED <<page, pageData, announced, archiveSynced, serverData, econ, streamUp, stream,
                 reads, answers, stimuli>>

(* runWithOwnership joins the running sync instead of starting a second one. *)
ServerJoinsPost ==
  /\ post = "sent" /\ sync # None
  /\ post' = "joined"
  /\ UNCHANGED <<page, pageData, announced, ServerVars, streamUp, stream, reads, answers, stimuli>>

ServerProgress ==
  /\ sync # None /\ ~named /\ ServerActive
  /\ named' = TRUE
  /\ stream' = Publish(<<Event("sync_progress", sync)>>)
  /\ UNCHANGED <<page, pageData, announced, sync, archiveSynced, lastError, serverData, econ,
                 streamUp, reads, answers, post, stimuli>>

(* Publishes sync, then invalidates the cache and publishes archive_updated when it ingested. *)
ServerEndSync ==
  /\ sync # None /\ ServerActive
  /\ \E ingested \in BOOLEAN:
       /\ serverData' = IF ingested THEN serverData + 1 ELSE serverData
       /\ econ' = IF ingested THEN Invalidate(econ) ELSE econ
       /\ stream' = Publish(IF ingested
                            THEN <<Event("sync", sync), Event("archive_updated", sync)>>
                            ELSE <<Event("sync", sync)>>)
  /\ sync' = None /\ named' = FALSE /\ archiveSynced' = TRUE
  /\ post' = IF post \in {"owned", "joined"} THEN "ok" ELSE post
  /\ UNCHANGED <<page, pageData, announced, lastError, streamUp, reads, answers, stimuli>>

ServerFailSync ==
  /\ sync # None /\ ServerActive
  /\ stream' = Publish(<<Event("error", sync)>>)
  /\ sync' = None /\ named' = FALSE /\ lastError' = TRUE
  /\ post' = IF post \in {"owned", "joined"} THEN "failed" ELSE post
  /\ UNCHANGED <<page, pageData, announced, archiveSynced, serverData, econ, streamUp, reads,
                 answers, stimuli>>

(* A read finds the economics data version stale and starts a build no event announced. *)
EconRebuildOnRead ==
  /\ econ = "idle" /\ stimuli < MaxStimuli /\ ServerActive
  /\ econ' = "building"
  /\ stimuli' = stimuli + 1
  /\ UNCHANGED <<page, pageData, announced, sync, named, archiveSynced, lastError, serverData,
                 streamUp, stream, reads, answers, post>>

(* A build publishes archive_updated "stats" only when it succeeds, then starts the queued one. *)
EconBuildEnds ==
  /\ econ # "idle" /\ ServerActive
  /\ econ' = IF econ = "queued" THEN "building" ELSE "idle"
  /\ \E ok \in BOOLEAN:
       stream' = IF ok THEN Publish(<<Event("archive_updated", "stats")>>) ELSE stream
  /\ UNCHANGED <<page, pageData, announced, sync, named, archiveSynced, lastError, serverData,
                 streamUp, reads, answers, post, stimuli>>

(* Archiving or deleting a session. *)
ServerSessionStateChange ==
  /\ stimuli < MaxStimuli /\ ServerActive
  /\ serverData' = serverData + 1
  /\ econ' = Invalidate(econ)
  /\ stream' = Publish(<<Event("archive_updated", "session_state")>>)
  /\ stimuli' = stimuli + 1
  /\ UNCHANGED <<page, pageData, announced, sync, named, archiveSynced, lastError, streamUp,
                 reads, answers, post>>

(* GET /api/sync-status answers with the server's state when it runs, not when it was sent. *)
ServerAnswersStatus ==
  /\ \E r \in reads:
       /\ reads' = reads \ {r}
       /\ answers' = answers \cup
            {[read |-> r.read, endedBefore |-> r.endedBefore, reconnect |-> r.reconnect,
              inProgress |-> sync # None, reason |-> IF named THEN sync ELSE None,
              archiveSynced |-> archiveSynced, lastError |-> lastError]}
  /\ UNCHANGED <<page, pageData, announced, ServerVars, streamUp, stream, post, stimuli>>

StreamOpens ==
  /\ ~streamUp
  /\ streamUp' = TRUE
  /\ Apply(ClientStreamMessage(page, TRUE), page.liveDropped, reads, post)
  /\ UNCHANGED <<ServerVars, stream, answers, stimuli>>

(* Events published while the stream is down are lost; EventSource never replays them. *)
StreamDrops ==
  /\ streamUp /\ stimuli < MaxStimuli
  /\ streamUp' = FALSE /\ stream' = <<>>
  /\ Apply(ClientStreamDropped(page), FALSE, reads, post)
  /\ stimuli' = stimuli + 1
  /\ UNCHANGED <<ServerVars, answers>>

ClientReceivesEvent ==
  /\ streamUp /\ stream # <<>>
  /\ LET e == Head(stream)
         r == CASE e.type = "sync_progress" -> ClientSyncProgress(page, e.reason)
                [] e.type = "sync" -> ClientSyncEnded(page, e.reason)
                [] e.type = "error" -> ClientSyncFailed(page, e.reason)
                [] OTHER -> ClientArchiveUpdated(page, e.reason)
     IN Apply(r, e.type = "archive_updated" /\ e.reason = "watch", reads, post)
  /\ stream' = Tail(stream)
  /\ UNCHANGED <<ServerVars, streamUp, answers, stimuli>>

ClientReceivesStatus ==
  /\ \E a \in answers:
       /\ answers' = answers \ {a}
       /\ Apply(ClientStatusAnswered(page, a), FALSE, reads, post)
  /\ UNCHANGED <<ServerVars, streamUp, stream, stimuli>>

ClientStatusReadFails ==
  /\ stimuli < MaxStimuli
  /\ \E r \in reads:
       Apply(ClientStatusFailed(page, r.reconnect), FALSE, reads \ {r}, post)
  /\ stimuli' = stimuli + 1
  /\ UNCHANGED <<ServerVars, streamUp, stream, answers>>

ClientReceivesPostReply ==
  /\ post \in {"ok", "failed"}
  /\ Apply(IF post = "ok" THEN ClientManualSyncDone(page) ELSE ClientManualSyncFailed(page),
           FALSE, reads, None)
  /\ UNCHANGED <<ServerVars, streamUp, stream, answers, stimuli>>

(* The topbar button reads Sync, and is disabled while a sync shows. *)
YouClickSync ==
  /\ ~page.updateOffered /\ ~page.syncing /\ post = None /\ stimuli < MaxStimuli
  /\ Apply(ClientSyncClicked(page), FALSE, reads, post)
  /\ stimuli' = stimuli + 1
  /\ UNCHANGED <<ServerVars, streamUp, stream, answers>>

YouClickUpdate ==
  /\ page.updateOffered
  /\ Apply(ClientUpdateClicked(page), FALSE, reads, post)
  /\ UNCHANGED <<ServerVars, streamUp, stream, answers, stimuli>>

CompletionTimerFires ==
  /\ page.complete
  /\ Apply(ClientCompleteElapsed(page), FALSE, reads, post)
  /\ UNCHANGED <<ServerVars, streamUp, stream, answers, stimuli>>

Quiescent ==
  /\ sync = None /\ econ = "idle" /\ streamUp /\ stream = <<>>
  /\ reads = {} /\ answers = {} /\ post = None

Settled == Quiescent /\ UNCHANGED vars

Next ==
  \/ ServerStartSync \/ ServerOwnsPost \/ ServerJoinsPost \/ ServerProgress
  \/ ServerEndSync \/ ServerFailSync \/ EconRebuildOnRead \/ EconBuildEnds
  \/ ServerSessionStateChange \/ ServerAnswersStatus
  \/ StreamOpens \/ StreamDrops
  \/ ClientReceivesEvent \/ ClientReceivesStatus \/ ClientStatusReadFails
  \/ ClientReceivesPostReply
  \/ YouClickSync \/ YouClickUpdate \/ CompletionTimerFires
  \/ Settled

Spec == Init /\ [][Next]_vars

(* "Sync complete" never shows while a sync runs. *)
CompleteOnlyWhenIdle == page.complete => ~page.syncing

(* Update is offered only for activity announced since the page last reloaded. *)
UpdateMeansNewActivity == page.updateOffered => announced

(* Once the server is idle and every message has landed, the Sync button is not left spinning. *)
NoStuckSync == Quiescent => ~page.syncing

(* Once everything has landed, the page shows the server's data, offers Update, or shows an error. *)
NoSilentStaleness == Quiescent => (pageData = serverData \/ page.updateOffered \/ page.error)
=============================================================================
