import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Gauge, Monitor, Moon, Search, Settings, Sun } from "lucide-react";
import { ApiError, getJson, getSyncStatus } from "./api.ts";
import { ApiFailureState } from "./api-failure.tsx";
import { paletteShortcutLabel, shouldOpenCommandPalette } from "./command-palette.ts";
import { CommandPalette } from "./command-palette-view.tsx";
import { CostValue, EmptyState, ErrorState } from "./common.tsx";
import { Alert } from "./components/ui/alert.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "./components/ui/sidebar.tsx";
import { emptyData, SLICE_LOADERS, slicesForView } from "./data-slices.ts";
import { ALL_DATE_RANGE, dateRangeQuery, withDateQuery } from "./date-range.ts";
import { useTodayRollover } from "./date-range-control.tsx";
import { ErrorBoundary } from "./error-boundary.tsx";
import { useDisabledFocusRescue } from "./focus.ts";
import { formatDay, formatInt, versionLabel } from "./format.ts";
import { isFramedOrUnknown } from "./frame-guard.ts";
import { Icon } from "./icons.tsx";
import { createLatestThrottle, type LatestThrottle } from "./latest-throttle.ts";
import { Link, locationPath, visit } from "./link.tsx";
import { navGroups, navItems } from "./nav-items.ts";
import {
  documentTitleFor,
  isKnownRoute,
  isSessionDetailPath,
  pathOnly,
  activeRoute as resolveActiveRoute,
  activeRouteKey as resolveActiveRouteKey,
  sessionIncludesArchived,
  sessionPageFromPath,
  sessionProjectFilter,
  sessionRepoFilter,
  sessionsPageHref,
  titleFor,
} from "./navigation.ts";
import {
  ANALYTICS_REPORT_INCLUDES,
  ANALYTICS_REPORT_NEVER_INCLUDES,
  ReportRouteView,
  SESSION_REPORT_INCLUDES,
  SESSION_REPORT_NEVER_INCLUDES,
} from "./report-export.tsx";
import { readStorage, removeStorage, writeStorage } from "./safe-storage.ts";
import { sessionPageFailure, useSessionPage } from "./session-page.ts";
import {
  collectSliceResults,
  dateScopedSliceStatus,
  loadSlicesIndependently,
} from "./slice-loading.ts";
import { type DashboardSource, sourceScopeQuery } from "./source-scope.ts";
import {
  isForegroundSync,
  LIVE_SESSIONS_REFRESH_MS,
  LIVE_SESSIONS_TOP_PX,
  type LiveSessionsViewer,
  liveSessionsAction,
  parseSyncFailure,
  planArchiveUpdate,
  restoreSync,
  sessionsAutoRefresh,
  showsSync,
  showsSyncComplete,
  supersededStatus,
  syncAnnouncement,
  syncCompleteLabel,
  syncNoticeDelay,
} from "./sync-events.ts";
import { SyncProgressLine, SyncProgressNotice } from "./sync-progress.tsx";
import { SyncButton } from "./sync-button.tsx";
import { hasOpenModal, isInteractiveTarget } from "./transcript-navigation.ts";
import type {
  DashboardData,
  DataSlice,
  DateRangeSelection,
  ServerEventPayload,
  SessionPageState,
  SyncProgress,
  SyncStatus,
  ThemeChoice,
} from "./types.ts";
import { UpdateNudge } from "./update-nudge.tsx";
import { AnalyticsView } from "./views/analytics.tsx";
import { CompareView } from "./views/compare.tsx";
import { FilesView } from "./views/files.tsx";
import { InsightsView } from "./views/insights.tsx";
import { ProjectsView } from "./views/projects.tsx";
import { SearchView } from "./views/search.tsx";
import { SessionDetailView } from "./views/session-detail.tsx";
import { SessionsView } from "./views/sessions.tsx";
import { SettingsView } from "./views/settings.tsx";
import { ToolsView } from "./views/tools.tsx";
import "./globals.css";

const LIVE_DISCONNECT_GRACE_MS = 15_000;
const VIEWS_WITHOUT_HEADING = new Set(["not-found"]);
const SYNC_PROGRESS_RENDER_MS = 150;
const TOPBAR_SYNC_LABELS = ["Sync", "Update"] as const;

function liveSessionsViewer(): LiveSessionsViewer {
  return {
    nearTop: window.scrollY <= LIVE_SESSIONS_TOP_PX,
    visible: document.visibilityState !== "hidden",
  };
}

function App() {
  const [path, setPath] = useState(locationPath);
  const [data, setData] = useState<DashboardData>(emptyData);
  const [failedSlices, setFailedSlices] = useState<DataSlice[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [recommendationsLoading, setRecommendationsLoading] = useState(
    () => resolveActiveRoute(locationPath(), navItems) === "Insights",
  );
  const [dateRangeSelection, setDateRangeSelection] = useState<DateRangeSelection>(() => {
    const params = new URLSearchParams(locationPath().split("?", 2)[1] ?? "");
    const from = params.get("from");
    const to = params.get("to");
    return from != null || to != null ? { preset: "custom", from, to } : ALL_DATE_RANGE;
  });
  const [sourceSelection, setSourceSelection] = useState<DashboardSource>("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [localSyncing, setLocalSyncing] = useState(false);
  const [syncError, setSyncError] = useState<unknown>(null);
  const [syncComplete, setSyncComplete] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [archiveSynced, setArchiveSynced] = useState(true);
  const [syncNoticeShown, setSyncNoticeShown] = useState(false);
  const [archiveUpdateAvailable, setArchiveUpdateAvailable] = useState(false);
  const [liveDisconnected, setLiveDisconnected] = useState(false);
  const [liveConnectionKey, setLiveConnectionKey] = useState(0);
  const [sessionTextFilterActive, setSessionTextFilterActive] = useState(false);
  const syncCompleteTimerRef = useRef<number | null>(null);
  const syncProgressThrottleRef = useRef<LatestThrottle<SyncProgress> | null>(null);
  const liveSessionsThrottleRef = useRef<LatestThrottle<null> | null>(null);
  const liveSessionsRef = useRef(false);
  const liveDisconnectTimerRef = useRef<number | null>(null);
  const liveDroppedRef = useRef(false);
  const manualSyncPendingRef = useRef(false);
  const syncStatusReadRef = useRef(0);
  const syncStatusAppliedRef = useRef(0);
  const sawSyncRef = useRef(false);
  const syncEndedRef = useRef(0);
  const archiveSyncedRef = useRef(true);
  const caughtUpRef = useRef(true);
  const localSyncingRef = useRef(false);
  const failedSlicesRef = useRef<DataSlice[]>([]);
  useTodayRollover(dateRangeSelection.preset === "today", setDateRangeSelection);
  const dateQuery = dateRangeQuery(dateRangeSelection);
  const sessionProject = sessionProjectFilter(path);
  const sessionRepo = sessionRepoFilter(path);
  const includeArchivedSessions = sessionIncludesArchived(path);
  const sessionPage = sessionPageFromPath(path);
  const refreshTimerRef = useRef<number | null>(null);
  const loadedSlicesRef = useRef(new Map<DataSlice, string>());
  const activeView = resolveActiveRouteKey(path, navItems);
  const dashboardQuery =
    activeView === "analytics" ? sourceScopeQuery(dateQuery, sourceSelection) : dateQuery;
  const showsSessions = activeView === "sessions";
  const sessionParams = new URLSearchParams(path.split("?", 2)[1] ?? "");
  const sessionFilters = new URLSearchParams();
  for (const key of ["tool", "model", "work_type", "outcome"]) {
    if (sessionParams.has(key)) sessionFilters.set(key, sessionParams.get(key) ?? "");
  }
  const sessionPageState = useSessionPage({
    dateQuery,
    enabled: showsSessions,
    filters: sessionFilters.size ? `&${sessionFilters}` : "",
    includeArchived: includeArchivedSessions,
    page: sessionPage,
    project: sessionProject,
    repo: sessionRepo,
    reloadKey,
  });
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    const stored = readStorage("decant-theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  });

  const requestRefresh = useCallback(() => {
    caughtUpRef.current = true;
    if (refreshTimerRef.current != null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      setReloadKey((key) => key + 1);
    }, 100);
  }, []);

  useEffect(() => {
    const onPop = () => setPath(locationPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useDisabledFocusRescue();

  useEffect(() => {
    localSyncingRef.current = localSyncing;
  }, [localSyncing]);

  useEffect(() => {
    archiveSyncedRef.current = archiveSynced;
  }, [archiveSynced]);

  const dismissSyncComplete = useCallback(() => {
    if (syncCompleteTimerRef.current == null) {
      return;
    }
    window.clearTimeout(syncCompleteTimerRef.current);
    syncCompleteTimerRef.current = null;
    setSyncComplete(false);
    setSyncProgress(null);
  }, []);

  const readSyncStatus = useCallback(async (): Promise<boolean> => {
    let status: SyncStatus;
    for (;;) {
      const read = ++syncStatusReadRef.current;
      const endedBefore = syncEndedRef.current;
      try {
        status = await getSyncStatus();
      } catch {
        return false;
      }
      if (read !== syncStatusReadRef.current) {
        const superseded = supersededStatus(status, {
          newerApplied: syncStatusAppliedRef.current === syncStatusReadRef.current,
          syncing: localSyncingRef.current,
        });
        if (superseded.sawSync) {
          sawSyncRef.current = true;
        }
        if (!superseded.readAgain) {
          return true;
        }
      } else if (endedBefore === syncEndedRef.current) {
        syncStatusAppliedRef.current = read;
        break;
      }
    }
    const restored = restoreSync(status, {
      syncing: localSyncingRef.current,
      manualPending: manualSyncPendingRef.current,
      sawSync: sawSyncRef.current,
    });
    sawSyncRef.current = false;
    setArchiveSynced(restored.archiveSynced);
    if (restored.syncing) {
      setLocalSyncing(true);
      setSyncError(null);
      dismissSyncComplete();
      if (restored.progress != null) {
        syncProgressThrottleRef.current?.push(restored.progress);
      }
    } else {
      syncProgressThrottleRef.current?.cancel();
      setLocalSyncing(false);
      setSyncProgress(null);
    }
    if (restored.ended) {
      setArchiveUpdateAvailable(false);
      requestRefresh();
      if (restored.failure != null) {
        setSyncError(new ApiError(500, "internal_error", restored.failure));
      }
    }
    return true;
  }, [dismissSyncComplete, requestRefresh]);

  useEffect(() => {
    void readSyncStatus();
  }, [readSyncStatus]);

  const firstSync = localSyncing && !archiveSynced;
  useEffect(() => {
    if (!localSyncing) {
      return;
    }
    const delay = syncNoticeDelay({ firstSync, requested: manualSyncPendingRef.current });
    if (delay === 0) {
      setSyncNoticeShown(true);
      return;
    }
    const timer = window.setTimeout(() => setSyncNoticeShown(true), delay);
    return () => window.clearTimeout(timer);
  }, [firstSync, localSyncing]);

  useEffect(() => {
    if (!localSyncing && !syncComplete) {
      setSyncNoticeShown(false);
    }
  }, [localSyncing, syncComplete]);

  const sessionFailure = sessionPageFailure(sessionPageState, sessionPage);
  const liveSessions = sessionsAutoRefresh({
    path,
    textFilterActive: sessionTextFilterActive,
    paletteOpen: commandPaletteOpen,
  });

  useEffect(() => {
    const throttle = createLatestThrottle<null>(() => {
      const action = liveSessionsAction(
        liveSessionsRef.current,
        localSyncingRef.current,
        liveSessionsViewer(),
      );
      if (action === "refresh") {
        setArchiveUpdateAvailable(false);
        requestRefresh();
      } else if (action === "offer_update") {
        setArchiveUpdateAvailable(true);
      }
    }, LIVE_SESSIONS_REFRESH_MS);
    liveSessionsThrottleRef.current = throttle;
    return () => {
      throttle.cancel();
      liveSessionsThrottleRef.current = null;
    };
  }, [requestRefresh]);

  useEffect(() => {
    liveSessionsRef.current = liveSessions;
    if (liveSessions && archiveUpdateAvailable) {
      liveSessionsThrottleRef.current?.push(null);
    }
  }, [archiveUpdateAvailable, liveSessions]);

  useEffect(() => {
    if (!liveSessions || !archiveUpdateAvailable) {
      return;
    }
    const resume = () => {
      const viewer = liveSessionsViewer();
      if (viewer.nearTop && viewer.visible) {
        liveSessionsThrottleRef.current?.push(null);
      }
    };
    window.addEventListener("scroll", resume, { passive: true });
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("scroll", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [archiveUpdateAvailable, liveSessions]);

  useEffect(() => {
    document.title = documentTitleFor(path, navItems);
  }, [path]);

  useEffect(() => {
    if (
      sourceSelection !== "" &&
      !data.sessionSources.some((source) => source.key === sourceSelection)
    ) {
      setSourceSelection("");
    }
  }, [data.sessionSources, sourceSelection]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current != null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
      removeStorage("decant-theme");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", prefersDark);
    } else {
      root.dataset.theme = theme;
      writeStorage("decant-theme", theme);
      root.classList.toggle("dark", theme === "dark");
    }
    window.dispatchEvent(new CustomEvent("decant:set-theme"));
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle("dark", e.matches);
    };
    media.addEventListener("change", onSchemeChange);
    return () => media.removeEventListener("change", onSchemeChange);
  }, [theme]);

  useLayoutEffect(() => {
    setRecommendationsLoading(
      activeView === "insights" &&
        loadedSlicesRef.current.get("recommendations") !== `${reloadKey}`,
    );
  }, [activeView, reloadKey]);

  useEffect(() => {
    const sliceKey = (slice: DataSlice): string =>
      SLICE_LOADERS[slice].dateScoped ? `${dashboardQuery}|${reloadKey}` : `${reloadKey}`;
    const needed = slicesForView(activeView);
    const relevantFailures = failedSlicesRef.current.filter((slice) => needed.includes(slice));
    failedSlicesRef.current = relevantFailures;
    setFailedSlices(relevantFailures);
    const missing = needed.filter(
      (slice) => loadedSlicesRef.current.get(slice) !== sliceKey(slice),
    );
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    void loadSlicesIndependently<DataSlice, DashboardData>(
      missing,
      (slice) => SLICE_LOADERS[slice].load(dashboardQuery),
      (slice, result) => {
        if (cancelled) {
          return;
        }
        const settled = collectSliceResults<DataSlice, DashboardData>([slice], [result]);
        setData((current) => ({ ...current, ...settled.data }));
        for (const loaded of settled.loaded) {
          loadedSlicesRef.current.set(loaded, sliceKey(loaded));
        }
        const failures = [
          ...failedSlicesRef.current.filter((failed) => failed !== slice),
          ...settled.failures.map((failure) => failure.slice),
        ];
        failedSlicesRef.current = failures;
        setFailedSlices(failures);
        if (slice === "recommendations") {
          setRecommendationsLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [activeView, dashboardQuery, reloadKey]);

  useEffect(() => {
    void liveConnectionKey;
    const events = new EventSource("/api/events");
    const progressThrottle = createLatestThrottle<SyncProgress>(
      setSyncProgress,
      SYNC_PROGRESS_RENDER_MS,
    );
    syncProgressThrottleRef.current = progressThrottle;
    const markConnected = () => {
      if (liveDroppedRef.current) {
        liveDroppedRef.current = false;
        if (failedSlicesRef.current.length > 0) {
          requestRefresh();
        } else {
          setArchiveUpdateAvailable(true);
          caughtUpRef.current = false;
        }
        void readSyncStatus().then((read) => {
          if (read) {
            return;
          }
          if (!manualSyncPendingRef.current) {
            progressThrottle.cancel();
            setLocalSyncing(false);
            setSyncProgress(null);
          }
        });
      }
      if (liveDisconnectTimerRef.current != null) {
        window.clearTimeout(liveDisconnectTimerRef.current);
        liveDisconnectTimerRef.current = null;
      }
      setLiveDisconnected(false);
    };
    const handleProgress = (event: MessageEvent<string>) => {
      markConnected();
      try {
        const payload = JSON.parse(event.data) as {
          progress?: SyncProgress;
          reason?: string;
        };
        if (!showsSync(payload.reason, archiveSyncedRef.current)) {
          return;
        }
        if (payload.progress != null) {
          if (!localSyncingRef.current) {
            syncEndedRef.current += 1;
            dismissSyncComplete();
          }
          progressThrottle.push(payload.progress);
          setLocalSyncing(true);
        }
      } catch {}
    };
    const handleSync = (event: MessageEvent<string>) => {
      markConnected();
      let payload: ServerEventPayload = {};
      try {
        payload = JSON.parse(event.data) as ServerEventPayload;
      } catch {}
      const shown = showsSync(payload.reason, archiveSyncedRef.current);
      syncEndedRef.current += 1;
      setArchiveSynced(true);
      if (!shown) {
        return;
      }
      if (!isForegroundSync(payload.reason) && manualSyncPendingRef.current) {
        return;
      }
      progressThrottle.flush();
      setArchiveUpdateAvailable(false);
      setLocalSyncing(false);
      setSyncError(null);
      setSyncComplete(true);
      if (syncCompleteTimerRef.current != null) {
        window.clearTimeout(syncCompleteTimerRef.current);
      }
      syncCompleteTimerRef.current = window.setTimeout(() => {
        syncCompleteTimerRef.current = null;
        setSyncComplete(false);
        setSyncProgress(null);
      }, 1_500);
      requestRefresh();
    };
    const handleArchiveUpdated = (event: MessageEvent<string>) => {
      let payload: ServerEventPayload = {};
      try {
        payload = JSON.parse(event.data) as ServerEventPayload;
      } catch {}
      const plan = planArchiveUpdate(payload.reason, caughtUpRef.current, localSyncingRef.current);
      caughtUpRef.current = plan.caughtUp;
      if (plan.refresh) {
        setArchiveUpdateAvailable(false);
        requestRefresh();
        return;
      }
      if (plan.offerUpdate) {
        const liveRefresh = liveSessionsThrottleRef.current;
        if (liveSessionsRef.current && liveRefresh != null) {
          liveRefresh.push(null);
        } else {
          setArchiveUpdateAvailable(true);
        }
      }
    };
    const handleOpen = () => {
      const dropped = liveDroppedRef.current;
      markConnected();
      if (!dropped) {
        void readSyncStatus();
      }
    };
    const handleError = (event: Event) => {
      const failure = parseSyncFailure(event);
      if (failure != null) {
        markConnected();
        syncEndedRef.current += 1;
        if (
          showsSync(failure.reason, archiveSyncedRef.current) &&
          (isForegroundSync(failure.reason) || !manualSyncPendingRef.current)
        ) {
          progressThrottle.cancel();
          setLocalSyncing(false);
          setSyncProgress(null);
          setSyncError(new ApiError(500, "internal_error", failure.error));
        }
        return;
      }
      liveDroppedRef.current = true;
      if (liveDisconnectTimerRef.current != null) {
        return;
      }
      liveDisconnectTimerRef.current = window.setTimeout(() => {
        liveDisconnectTimerRef.current = null;
        if (events.readyState !== EventSource.OPEN) {
          setLiveDisconnected(true);
          setLiveConnectionKey((key) => key + 1);
        }
      }, LIVE_DISCONNECT_GRACE_MS);
    };
    const handleHeartbeat = () => markConnected();
    events.addEventListener("open", handleOpen);
    events.addEventListener("hello", handleHeartbeat);
    events.addEventListener("ping", handleHeartbeat);
    events.addEventListener("sync_progress", handleProgress as EventListener);
    events.addEventListener("sync", handleSync);
    events.addEventListener("archive_updated", handleArchiveUpdated as EventListener);
    events.addEventListener("error", handleError);
    return () => {
      events.removeEventListener("open", handleOpen);
      events.removeEventListener("hello", handleHeartbeat);
      events.removeEventListener("ping", handleHeartbeat);
      events.removeEventListener("sync_progress", handleProgress as EventListener);
      events.removeEventListener("sync", handleSync);
      events.removeEventListener("archive_updated", handleArchiveUpdated as EventListener);
      events.removeEventListener("error", handleError);
      events.close();
      progressThrottle.cancel();
      syncProgressThrottleRef.current = null;
      if (liveDisconnectTimerRef.current != null) {
        window.clearTimeout(liveDisconnectTimerRef.current);
        liveDisconnectTimerRef.current = null;
      }
      if (syncCompleteTimerRef.current != null) {
        window.clearTimeout(syncCompleteTimerRef.current);
      }
    };
  }, [dismissSyncComplete, liveConnectionKey, readSyncStatus, requestRefresh]);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      const targetIsInteractive =
        isInteractiveTarget(event.target) || isInteractiveTarget(document.activeElement);
      if (
        !shouldOpenCommandPalette({
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          interactiveTarget: targetIsInteractive,
          key: event.key,
          metaKey: event.metaKey,
          modalOpen: hasOpenModal(document),
          shiftKey: event.shiftKey,
        })
      ) {
        return;
      }
      event.preventDefault();
      setCommandPaletteOpen(true);
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  const activeLabel = resolveActiveRoute(path, navItems);
  const activeFailedSlices = failedSlices.filter((slice) =>
    slicesForView(activeView).includes(slice),
  );
  const metrics = data.summary;
  const lastActivity = formatDay(data.dateBounds?.latest_started_at ?? null);
  const syncInProgress = localSyncing;
  const syncCompleteShown = showsSyncComplete(syncComplete, syncInProgress);
  const runSync = () => {
    if (syncInProgress) {
      return;
    }
    setSyncError(null);
    dismissSyncComplete();
    syncProgressThrottleRef.current?.cancel();
    setSyncProgress(null);
    setArchiveUpdateAvailable(false);
    setLocalSyncing(true);
    manualSyncPendingRef.current = true;
    void getJson<unknown>("/api/sync", { method: "POST", body: "{}" })
      .finally(() => {
        manualSyncPendingRef.current = false;
        syncEndedRef.current += 1;
      })
      .then(() => {
        syncProgressThrottleRef.current?.flush();
        setArchiveUpdateAvailable(false);
        setArchiveSynced(true);
        setLocalSyncing(false);
        setSyncComplete(true);
        requestRefresh();
        if (syncCompleteTimerRef.current != null) {
          window.clearTimeout(syncCompleteTimerRef.current);
        }
        syncCompleteTimerRef.current = window.setTimeout(() => {
          syncCompleteTimerRef.current = null;
          setSyncComplete(false);
          setSyncProgress(null);
        }, 1_500);
      })
      .catch((err: unknown) => {
        syncProgressThrottleRef.current?.cancel();
        setLocalSyncing(false);
        setSyncProgress(null);
        setSyncError(err);
      });
  };
  const handleDateRangeChange = useCallback(
    (next: DateRangeSelection) => {
      if (sessionPageFromPath(path) > 1) {
        visit(sessionsPageHref(path, 1), setPath);
      }
      setDateRangeSelection(next);
    },
    [path],
  );
  const loadArchiveUpdates = () => {
    setArchiveUpdateAvailable(false);
    requestRefresh();
  };
  const reconnectLiveUpdates = () => {
    liveDroppedRef.current = false;
    setLiveDisconnected(false);
    setLiveConnectionKey((key) => key + 1);
    requestRefresh();
  };
  const analyticsReport = pathOnly(path) === "/reports/analytics";
  const sessionReportMatch = pathOnly(path).match(/^\/reports\/session\/(\d+)$/);
  if (analyticsReport) {
    const date = path.includes("?") ? (path.split("?", 2)[1] ?? "") : "";
    const sourceHref = withDateQuery("/api/reports/analytics.html", date);
    return (
      <ReportRouteView
        backHref="/"
        downloadHref={sourceHref}
        excluded={ANALYTICS_REPORT_NEVER_INCLUDES}
        includes={ANALYTICS_REPORT_INCLUDES}
        onSync={runSync}
        sourceHref={sourceHref}
        title="Analytics report"
      />
    );
  }
  if (sessionReportMatch != null) {
    const id = Number(sessionReportMatch[1]);
    const sourceHref = `/api/reports/session/${id}.html`;
    return (
      <ReportRouteView
        backHref={`/sessions/${id}`}
        downloadHref={sourceHref}
        excluded={SESSION_REPORT_NEVER_INCLUDES}
        includes={SESSION_REPORT_INCLUDES}
        onSync={runSync}
        sourceHref={sourceHref}
        title="Session report"
      />
    );
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg">
                <Link href="/" setPath={setPath}>
                  <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Gauge className="size-4" /></span>
                  <span className="truncate font-semibold">Agent Benchmarks</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {navGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu aria-label={group.label}>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={activeView === item.key} tooltip={item.label}>
                      <Link href={item.href} setPath={setPath}><Icon name={item.icon} /><span>{item.label}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="border-t text-xs text-muted-foreground [&_svg]:size-4">
          {firstSync ? (
            <div className="flex items-center gap-2 px-2 py-1"><Icon name="trend" /><span>Totals after the first sync</span></div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-2 py-1" title="Top-level sessions matching this page's filters"><Icon name="trend" /><span><strong className="font-medium text-sidebar-foreground">{metrics == null ? "-" : formatInt(metrics.sessions)}</strong> sessions</span></div>
              <div className="flex items-center gap-2 px-2 py-1"><Icon name="money" /><span><strong className="font-medium text-sidebar-foreground">{metrics == null ? "-" : <CostValue cost={metrics.estimated_cost_usd} sessions={metrics.sessions} usageSessions={metrics.usage_sessions} />}</strong>{" "}tracked</span></div>
            </>
          )}
          {lastActivity != null && !firstSync ? <div className="flex items-center gap-2 px-2 py-1"><Icon name="clock" /><span>latest {lastActivity}</span></div> : null}
          <UpdateNudge status={data.update} />
          <a className="px-2 py-1 text-[11px] hover:text-sidebar-foreground" href="https://github.com/dosu-ai/decant/releases" rel="noopener" target="_blank" title={`Current build: ${versionLabel(data.config?.version)}`}>Agent Benchmarks {versionLabel(data.config?.version)}</a>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 max-md:[&_[data-sync-label]]:hidden">
          <SidebarTrigger className="-ml-1" />
          {VIEWS_WITHOUT_HEADING.has(activeView) ? <h1 className="text-sm font-semibold tracking-tight">{titleFor(activeLabel)}</h1> : <p className="text-sm font-semibold tracking-tight">{titleFor(activeLabel)}</p>}
          <Button aria-expanded={commandPaletteOpen} aria-haspopup="dialog" aria-label="Open command palette" className="hidden min-w-0 max-w-lg flex-1 justify-start font-normal text-muted-foreground md:inline-flex" onClick={() => setCommandPaletteOpen(true)} size="sm" type="button" variant="outline"><Search /><span className="truncate">Search sessions, messages, and tools…</span><kbd className="ml-auto rounded border bg-muted px-1.5 font-mono text-[11px]">{paletteShortcutLabel(navigator.userAgent)}</kbd></Button>
          <Button aria-expanded={commandPaletteOpen} aria-haspopup="dialog" aria-label="Search" className="md:hidden" onClick={() => setCommandPaletteOpen(true)} size="icon" type="button" variant="ghost"><Search /></Button>
          <div className="ml-auto hidden sm:block" />
          <SyncButton ariaLabel={archiveUpdateAvailable ? "Load new activity" : "Sync session logs"} busy={syncInProgress} label={archiveUpdateAvailable ? "Update" : "Sync"} labels={TOPBAR_SYNC_LABELS} onClick={archiveUpdateAvailable ? loadArchiveUpdates : runSync} update={archiveUpdateAvailable} />
          <span aria-live="polite" className="sr-only" role="status">{syncInProgress ? syncAnnouncement(syncProgress) : syncCompleteShown ? syncCompleteLabel(syncProgress) : ""}</span>
          <Button asChild aria-label="Settings" size="icon" title="Settings" variant="ghost"><Link href="/settings" setPath={setPath}><Settings /></Link></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button aria-label="Choose theme" className="shrink-0" size="icon" variant="ghost">{theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeChoice)}><DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem><DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem><DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent>
          </DropdownMenu>
          {syncInProgress || syncComplete ? <SyncProgressLine complete={syncCompleteShown} progress={syncProgress} /> : null}
        </header>
        <div className="min-w-0 flex-1 px-4 pb-12 pt-6 sm:px-8">
          <div className="mx-auto w-full min-w-0 max-w-[96rem]">
            {syncNoticeShown && (syncInProgress || syncComplete) ? <SyncProgressNotice complete={syncCompleteShown} firstSync={firstSync} progress={syncProgress} /> : null}
            {liveDisconnected ? <Alert className="mb-4 flex flex-wrap items-center justify-between gap-3" role="status"><span>Live updates disconnected · the browser will reconnect automatically.</span><Button onClick={reconnectLiveUpdates} size="sm" type="button" variant="outline">Reconnect</Button></Alert> : null}
            {syncError != null ? <div className="mb-4"><ApiFailureState error={syncError} onRetry={runSync} /></div> : null}
            {activeFailedSlices.length > 0 ? <Alert className="mb-4 flex flex-wrap items-center justify-between gap-3" variant="destructive"><span>Some dashboard data could not be loaded. Available data is still shown. Failed: {activeFailedSlices.join(", ")}.</span><Button onClick={requestRefresh} size="sm" type="button" variant="outline">Retry</Button></Alert> : null}
            {activeView === "sessions" && sessionFailure === "notice" ? <Alert className="mb-4 flex flex-wrap items-center justify-between gap-3" variant="destructive"><span>The session list could not be refreshed. The sessions shown may be out of date.</span><Button onClick={requestRefresh} size="sm" type="button" variant="outline">Retry</Button></Alert> : null}
            {activeView === "sessions" && sessionFailure === "replace" ? <ApiFailureState error={sessionPageState.error} onRetry={requestRefresh} onSync={runSync} /> : renderView(activeView, path, data, {
              dashboardQuery,
              dateRange: dateRangeSelection,
              onDateRangeChange: handleDateRangeChange,
              onSessionTextFilterChange: setSessionTextFilterActive,
              onSourceChange: setSourceSelection,
              refresh: requestRefresh,
              reloadKey,
              runSync,
              failedSlices,
              firstSync,
              loadedSlices: loadedSlicesRef.current,
              recommendationsLoading,
              sessionPageState,
              source: sourceSelection,
              syncing: syncInProgress,
            })}
          </div>
        </div>
      </SidebarInset>
      <CommandPalette analyticsReportHref={withDateQuery("/reports/analytics", dashboardQuery)} onClose={() => setCommandPaletteOpen(false)} onNavigate={(href) => { setCommandPaletteOpen(false); visit(href, setPath); }} onRunSync={() => { setCommandPaletteOpen(false); runSync(); }} onToggleTheme={() => setTheme((current) => current === "system" ? "light" : current === "light" ? "dark" : "system")} open={commandPaletteOpen} refreshKey={reloadKey} syncing={syncInProgress} />
    </SidebarProvider>
  );
}

function renderView(
  routeKey: string,
  path: string,
  data: DashboardData,
  actions: {
    dashboardQuery: string;
    dateRange: DateRangeSelection;
    onDateRangeChange: (range: DateRangeSelection) => void;
    onSessionTextFilterChange: (active: boolean) => void;
    onSourceChange: (source: DashboardSource) => void;
    refresh: () => void;
    reloadKey: number;
    runSync: () => void;
    failedSlices: DataSlice[];
    firstSync: boolean;
    loadedSlices: ReadonlyMap<DataSlice, string>;
    recommendationsLoading: boolean;
    sessionPageState: SessionPageState;
    source: DashboardSource;
    syncing: boolean;
  },
) {
  const pathname = pathOnly(path);
  const sliceStatus = (slice: DataSlice) =>
    dateScopedSliceStatus(
      actions.loadedSlices.get(slice),
      actions.failedSlices.includes(slice),
      dateRangeQuery(actions.dateRange),
    );
  if (isSessionDetailPath(pathname)) {
    return (
      <SessionDetailView
        id={Number(pathname.split("/").at(-1))}
        onSync={actions.runSync}
        syncing={actions.syncing}
      />
    );
  }
  if (!isKnownRoute(path, navItems)) {
    return <NotFoundView pathname={pathname} />;
  }
  switch (routeKey) {
    case "sessions":
      return (
        <SessionsView
          data={data}
          dateRange={actions.dateRange}
          onDateRangeChange={actions.onDateRangeChange}
          onTextFilterChange={actions.onSessionTextFilterChange}
          path={path}
          reloadKey={actions.reloadKey}
          sessionPageState={actions.sessionPageState}
        />
      );
    case "projects":
      return (
        <ProjectsView onSync={actions.runSync} projects={data.projects} syncing={actions.syncing} />
      );
    case "search":
      return <SearchView dateRange={actions.dateRange} path={path} />;
    case "compare":
      return <CompareView data={data} dateRange={actions.dateRange} onDateRangeChange={actions.onDateRangeChange} reloadKey={actions.reloadKey} />;
    case "analytics":
      return (
        <AnalyticsView
          data={data}
          dateRange={actions.dateRange}
          firstSync={actions.firstSync}
          onDateRangeChange={actions.onDateRangeChange}
          onSourceChange={actions.onSourceChange}
          onSync={actions.runSync}
          sliceStatus={(slice) =>
            dateScopedSliceStatus(
              actions.loadedSlices.get(slice),
              actions.failedSlices.includes(slice),
              actions.dashboardQuery,
            )
          }
          source={actions.source}
          syncing={actions.syncing}
        />
      );
    case "insights":
      return (
        <InsightsView
          firstSync={actions.firstSync}
          loading={actions.recommendationsLoading}
          loadFailed={actions.failedSlices.includes("recommendations")}
          rows={data.recommendations}
          settingsInfo={data.settings}
          onMarked={actions.refresh}
        />
      );
    case "tools":
      return (
        <ToolsView
          data={data}
          dateRange={actions.dateRange}
          mcpStatus={sliceStatus("mcp")}
          onDateRangeChange={actions.onDateRangeChange}
          reloadKey={actions.reloadKey}
          toolsStatus={sliceStatus("tools")}
        />
      );
    case "files":
      return (
        <FilesView
          dateBounds={data.dateBounds}
          dateRange={actions.dateRange}
          onDateRangeChange={actions.onDateRangeChange}
          reloadKey={actions.reloadKey}
        />
      );
    case "settings":
      return (
        <SettingsView
          config={data.config}
          onSaved={actions.refresh}
          settingsInfo={data.settings}
          update={data.update}
        />
      );
    default:
      return <NotFoundView pathname={pathname} />;
  }
}

function NotFoundView({ pathname }: { pathname: string }) {
  return (
    <ErrorState
      action={
        <Button asChild><Link href="/">Back to Analytics</Link></Button>
      }
      detail={`There is no page at ${pathname}.`}
      icon="inbox"
      title="Page not found"
    />
  );
}

function FramedNotice() {
  return (
    <EmptyState
      icon="shield"
      message="Open Agent Benchmarks directly in its own browser tab or window to use it."
      title="Agent Benchmarks cannot be displayed in a frame"
    />
  );
}

const root = document.getElementById("root");
if (root == null) {
  throw new Error("missing #root");
}
createRoot(root).render(
  isFramedOrUnknown(window) ? (
    <FramedNotice />
  ) : (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  ),
);
