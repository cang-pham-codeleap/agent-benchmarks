import { ApiError } from "./api.ts";
import { formatInt } from "./format.ts";
import {
  pathOnly,
  sessionIncludesArchived,
  sessionPageFromPath,
  sessionProjectFilter,
  sessionRepoFilter,
} from "./navigation.ts";
import type { SyncProgress, SyncStatus } from "./types.ts";

export function isForegroundSync(reason: string | undefined): boolean {
  return reason === "manual" || reason === "startup";
}

export function showsSync(reason: string | undefined, archiveSynced: boolean): boolean {
  return !archiveSynced || isForegroundSync(reason);
}

export interface ArchiveUpdatePlan {
  refresh: boolean;
  offerUpdate: boolean;
  caughtUp: boolean;
}

export function planArchiveUpdate(
  reason: string | undefined,
  caughtUp: boolean,
  foregroundSyncRunning: boolean,
): ArchiveUpdatePlan {
  if (isForegroundSync(reason) || reason === "session_state" || (reason === "stats" && caughtUp)) {
    return { refresh: true, offerUpdate: false, caughtUp: true };
  }
  if (foregroundSyncRunning) {
    return { refresh: false, offerUpdate: false, caughtUp };
  }
  return { refresh: false, offerUpdate: true, caughtUp: false };
}

export const LIVE_SESSIONS_REFRESH_MS = 5_000;

export function sessionsAutoRefresh({
  path,
  textFilterActive,
  paletteOpen,
}: {
  path: string;
  textFilterActive: boolean;
  paletteOpen: boolean;
}): boolean {
  return (
    pathOnly(path) === "/sessions" &&
    sessionPageFromPath(path) === 1 &&
    sessionProjectFilter(path) == null &&
    sessionRepoFilter(path) == null &&
    !sessionIncludesArchived(path) &&
    !textFilterActive &&
    !paletteOpen
  );
}

export type LiveSessionsAction = "refresh" | "offer_update" | "none";

export const LIVE_SESSIONS_TOP_PX = 64;

export interface LiveSessionsViewer {
  nearTop: boolean;
  visible: boolean;
}

export function liveSessionsAction(
  autoRefresh: boolean,
  foregroundSyncRunning: boolean,
  viewer: LiveSessionsViewer,
): LiveSessionsAction {
  if (foregroundSyncRunning) {
    return "none";
  }
  return autoRefresh && viewer.nearTop && viewer.visible ? "refresh" : "offer_update";
}

export interface SyncFailure {
  reason?: string;
  error: string;
}

/**
 * The server publishes sync failures as SSE `error` events, which EventSource
 * delivers to the same listener as its own connection errors. Only the server
 * event carries a data payload, so that is what tells the two apart.
 */
export function parseSyncFailure(event: Event): SyncFailure | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return null;
  }
  try {
    const payload = JSON.parse(event.data) as { reason?: unknown; error?: unknown };
    return {
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
      error: typeof payload.error === "string" ? payload.error : "sync failed",
    };
  } catch {
    return { error: "sync failed" };
  }
}

export interface RestoredSync {
  syncing: boolean;
  progress: SyncProgress | null;
  archiveSynced: boolean;
  ended: boolean;
  failure: string | null;
}

function runningShownSync(status: SyncStatus): boolean {
  return status.in_progress && showsSync(status.reason ?? undefined, status.archive_synced);
}

export function restoreSync(
  status: SyncStatus,
  shown: { syncing: boolean; manualPending: boolean; sawSync?: boolean },
): RestoredSync {
  const running = runningShownSync(status);
  const ended = (shown.syncing || shown.sawSync === true) && !shown.manualPending && !running;
  return {
    syncing: running || shown.manualPending,
    progress: running ? status.progress : null,
    archiveSynced: status.archive_synced,
    ended,
    failure: ended && !status.in_progress ? status.last_error : null,
  };
}

export function supersededStatus(
  status: SyncStatus,
  tab: { newerApplied: boolean; syncing: boolean },
): { sawSync: boolean; readAgain: boolean } {
  const sawSync = runningShownSync(status);
  return { sawSync, readAgain: sawSync && tab.newerApplied && !tab.syncing };
}

export function showsSyncComplete(complete: boolean, syncing: boolean): boolean {
  return complete && !syncing;
}

export function syncFraction(progress: SyncProgress | null): number | null {
  if (progress == null || progress.total <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, progress.scanned / progress.total));
}

export function syncProgressLabel(progress: SyncProgress | null): string {
  if (progress == null || progress.total <= 0) {
    return "Syncing session logs";
  }
  const files = progress.total === 1 ? "file" : "files";
  return `Syncing ${formatInt(progress.scanned)} of ${formatInt(progress.total)} ${files}`;
}

export function syncCompleteLabel(progress: SyncProgress | null): string {
  if (progress == null || progress.ingested <= 0) {
    return "Sync complete";
  }
  const files = progress.ingested === 1 ? "file" : "files";
  return `Sync complete, ${formatInt(progress.ingested)} ${files} ingested`;
}

export function syncAnnouncement(progress: SyncProgress | null): string {
  const fraction = syncFraction(progress);
  const step = fraction == null ? 0 : Math.min(90, Math.floor(fraction * 10) * 10);
  return step === 0 ? "Syncing session logs" : `Syncing session logs, ${step}% done`;
}

export const SYNC_NOTICE_DELAY_MS = 700;

export function syncNoticeDelay(sync: { firstSync: boolean; requested: boolean }): number {
  return sync.firstSync || sync.requested ? 0 : SYNC_NOTICE_DELAY_MS;
}

export const SYNC_COMPLETE_MS = 1_500;

export interface SyncState {
  syncing: boolean;
  manualPending: boolean;
  complete: boolean;
  completion: number;
  archiveSynced: boolean;
  updateOffered: boolean;
  caughtUp: boolean;
  error: unknown;
  liveDropped: boolean;
  sawSync: boolean;
  statusRead: number;
  statusApplied: number;
  syncEnded: number;
}

export const INITIAL_SYNC_STATE: SyncState = {
  syncing: false,
  manualPending: false,
  complete: false,
  completion: 0,
  archiveSynced: true,
  updateOffered: false,
  caughtUp: true,
  error: null,
  liveDropped: false,
  sawSync: false,
  statusRead: 0,
  statusApplied: 0,
  syncEnded: 0,
};

export type SyncEvent =
  | { type: "page_loaded" }
  | { type: "sync_clicked" }
  | { type: "manual_sync_done" }
  | { type: "manual_sync_failed"; error: unknown }
  | { type: "sync_progress"; reason?: string; progress?: SyncProgress }
  | { type: "sync_ended"; reason?: string }
  | { type: "sync_failed"; reason?: string; error: string }
  | { type: "archive_updated"; reason?: string; liveSessions: boolean }
  | { type: "live_sessions_due"; autoRefresh: boolean; viewer: LiveSessionsViewer }
  | { type: "update_clicked" }
  | { type: "refresh_requested" }
  | { type: "complete_elapsed"; completion: number }
  | { type: "stream_message"; opened: boolean; failedSlices: boolean }
  | { type: "stream_dropped" }
  | { type: "reconnect_clicked" }
  | {
      type: "status_answered";
      read: number;
      endedBefore: number;
      reconnect: boolean;
      status: SyncStatus;
    }
  | { type: "status_failed"; reconnect: boolean };

export type SyncEffect =
  | { type: "refresh" }
  | { type: "post_sync" }
  | { type: "read_status"; read: number; endedBefore: number; reconnect: boolean }
  | { type: "live_refresh" }
  | { type: "show_progress"; progress: SyncProgress }
  | { type: "flush_progress" }
  | { type: "clear_progress" };

export interface SyncStep {
  state: SyncState;
  effects: SyncEffect[];
}

export function reduceSync(state: SyncState, event: SyncEvent): SyncStep {
  const s = { ...state };
  const effects: SyncEffect[] = [];
  // A refresh reloads everything the server has, so it is the one place the page becomes caught up.
  const refresh = () => {
    s.caughtUp = true;
    effects.push({ type: "refresh" });
  };
  const dismissComplete = () => {
    if (s.complete) {
      s.complete = false;
      effects.push({ type: "clear_progress" });
    }
  };
  const finishSync = () => {
    effects.push({ type: "flush_progress" });
    s.updateOffered = false;
    s.syncing = false;
    s.complete = true;
    s.completion += 1;
    refresh();
  };
  const stopSyncing = () => {
    effects.push({ type: "clear_progress" });
    s.syncing = false;
  };
  const readStatus = (reconnect: boolean) => {
    s.statusRead += 1;
    effects.push({ type: "read_status", read: s.statusRead, endedBefore: s.syncEnded, reconnect });
  };

  switch (event.type) {
    case "page_loaded":
      readStatus(false);
      break;
    case "sync_clicked":
      if (s.syncing) {
        break;
      }
      s.error = null;
      dismissComplete();
      effects.push({ type: "clear_progress" }, { type: "post_sync" });
      s.updateOffered = false;
      s.syncing = true;
      s.manualPending = true;
      break;
    case "manual_sync_done":
      s.manualPending = false;
      s.syncEnded += 1;
      s.archiveSynced = true;
      finishSync();
      break;
    case "manual_sync_failed":
      s.manualPending = false;
      s.syncEnded += 1;
      stopSyncing();
      s.error = event.error;
      break;
    case "sync_progress":
      if (!showsSync(event.reason, s.archiveSynced) || event.progress == null) {
        break;
      }
      if (!s.syncing) {
        s.syncEnded += 1;
        dismissComplete();
      }
      effects.push({ type: "show_progress", progress: event.progress });
      s.syncing = true;
      break;
    case "sync_ended": {
      const shown = showsSync(event.reason, s.archiveSynced);
      s.syncEnded += 1;
      s.archiveSynced = true;
      if (!shown || (!isForegroundSync(event.reason) && s.manualPending)) {
        break;
      }
      s.error = null;
      finishSync();
      break;
    }
    case "sync_failed":
      s.syncEnded += 1;
      if (
        showsSync(event.reason, s.archiveSynced) &&
        (isForegroundSync(event.reason) || !s.manualPending)
      ) {
        stopSyncing();
        s.error = new ApiError(500, "internal_error", event.error);
      }
      break;
    case "archive_updated": {
      const plan = planArchiveUpdate(event.reason, s.caughtUp, s.syncing);
      s.caughtUp = plan.caughtUp;
      if (plan.refresh) {
        s.updateOffered = false;
        refresh();
      } else if (plan.offerUpdate && event.liveSessions) {
        effects.push({ type: "live_refresh" });
      } else if (plan.offerUpdate) {
        s.updateOffered = true;
      }
      break;
    }
    case "live_sessions_due": {
      const action = liveSessionsAction(event.autoRefresh, s.syncing, event.viewer);
      if (action === "refresh") {
        s.updateOffered = false;
        refresh();
      } else if (action === "offer_update") {
        s.updateOffered = true;
      }
      break;
    }
    case "update_clicked":
      s.updateOffered = false;
      refresh();
      break;
    case "refresh_requested":
      refresh();
      break;
    case "complete_elapsed":
      if (s.complete && event.completion === s.completion) {
        s.complete = false;
        effects.push({ type: "clear_progress" });
      }
      break;
    case "stream_message":
      if (s.liveDropped) {
        s.liveDropped = false;
        if (event.failedSlices) {
          refresh();
        } else {
          s.updateOffered = true;
          s.caughtUp = false;
        }
        readStatus(true);
      } else if (event.opened) {
        readStatus(false);
      }
      break;
    case "stream_dropped":
      s.liveDropped = true;
      break;
    case "reconnect_clicked":
      s.liveDropped = false;
      refresh();
      break;
    case "status_answered": {
      if (event.read !== s.statusRead) {
        const superseded = supersededStatus(event.status, {
          newerApplied: s.statusApplied === s.statusRead,
          syncing: s.syncing,
        });
        s.sawSync ||= superseded.sawSync;
        if (superseded.readAgain) {
          readStatus(event.reconnect);
        }
        break;
      }
      if (event.endedBefore !== s.syncEnded) {
        readStatus(event.reconnect);
        break;
      }
      s.statusApplied = event.read;
      const restored = restoreSync(event.status, s);
      s.sawSync = false;
      s.archiveSynced = restored.archiveSynced;
      if (restored.syncing) {
        s.syncing = true;
        s.error = null;
        dismissComplete();
        if (restored.progress != null) {
          effects.push({ type: "show_progress", progress: restored.progress });
        }
      } else {
        stopSyncing();
      }
      if (restored.ended) {
        s.updateOffered = false;
        refresh();
        if (restored.failure != null) {
          s.error = new ApiError(500, "internal_error", restored.failure);
        }
      }
      break;
    }
    case "status_failed":
      if (event.reconnect && !s.manualPending) {
        stopSyncing();
      }
      break;
  }
  const unchanged = (Object.keys(s) as (keyof SyncState)[]).every((key) => s[key] === state[key]);
  return { state: unchanged ? state : s, effects };
}
