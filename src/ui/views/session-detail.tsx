import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { SESSION_MESSAGE_PAGE_MAX } from "../../api-limits.ts";
import { getJson } from "../api.ts";
import { ApiFailureState } from "../api-failure.tsx";
import { Badge, ModelBadge, ReasoningBadge, ToolBadge } from "../badges.tsx";
import { SESSION_DETAIL_MESSAGE_PAGE_SIZE } from "../constants.ts";
import { ContextWindowPanel } from "../context-window-strip.tsx";
import { costSourceLabel, costSourceTooltip } from "../cost-source.ts";
import { useBackdropDismiss, useDialogFocusTrap } from "../focus.ts";
import { basename, compact, errorMessage, formatInt, money } from "../format.ts";
import { Icon } from "../icons.tsx";
import { formatIssueBadge, unknownRecordTypeSummary } from "../ingest-issues.ts";
import { Link, visit } from "../link.tsx";
import { projectSessionsHref, sessionsArchivedHref } from "../navigation.ts";
import {
  ReportExportButton,
  SESSION_REPORT_INCLUDES,
  SESSION_REPORT_NEVER_INCLUDES,
} from "../report-export.tsx";
import {
  archiveActionFor,
  DELETE_SESSION_EXPLANATION,
  DELETE_SESSION_EYEBROW,
  type SessionStateUpdate,
  sessionStateRequest,
} from "../session-state.ts";
import { sessionDisplayTitle } from "../session-title.ts";
import { SyncButton } from "../sync-button.tsx";
import { ThreadTocEntry, threadStats, threadToc, threadTocFromOutline } from "../thread-toc.tsx";
import {
  countSubagentRuns,
  messageKey,
  nearestTranscriptSeq,
  renderableMessages,
  scrollTranscriptMessage,
  subagentMap,
  TranscriptTurn,
} from "../transcript.tsx";
import {
  hasOpenModal,
  isInteractiveTarget,
  nextTranscriptSeq,
  type TranscriptNavigationDirection,
  transcriptNavigationDirection,
  transcriptSeqFromHash,
} from "../transcript-navigation.ts";
import {
  appendTranscriptPage,
  fetchTranscriptRange,
  prependTranscriptPage,
  previousTranscriptPageRequest,
  runWithTranscriptRequestSlot,
  transcriptPrefixRequest,
} from "../transcript-pagination.ts";
import type {
  ContextWindowTimelineData,
  SessionDetailData,
  SessionIngestIssue,
  SessionOutlineItemData,
  TokenEconomics,
} from "../types.ts";
import { TokenEconomicsPanel } from "./analytics.tsx";
import { DosuProvenanceBadge } from "./sessions.tsx";

export function DeleteSessionDialog({
  error,
  onClose,
  onConfirm,
  open,
  pending,
  title,
}: {
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  pending: boolean;
  title: string;
}) {
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  onCloseRef.current = onClose;
  const requestClose = useCallback(() => onCloseRef.current(), []);
  useDialogFocusTrap(open, dialogRef, requestClose);
  useBackdropDismiss(open && !pending, backdropRef, requestClose);
  if (!open) {
    return null;
  }
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      ref={backdropRef}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-lg space-y-4 rounded-lg border bg-background p-6 shadow-lg"
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <span className="text-sm text-muted-foreground">{DELETE_SESSION_EYEBROW}</span>
            <h2 id={titleId}>Delete session?</h2>
          </div>
          <Button
            aria-label="Close delete confirmation"
            variant="ghost"
            size="icon"
            disabled={pending}
            onClick={requestClose}
            type="button"
          >
            <Icon name="x" />
          </Button>
        </header>
        <div className="space-y-3">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground" id={descriptionId}>
            {DELETE_SESSION_EXPLANATION}
          </p>
          {error != null ? (
            <Alert variant="destructive" role="alert">
              {error}
            </Alert>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={requestClose} type="button">
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm} type="button">
            <Icon name="trash" />
            {pending ? "Deleting…" : "Delete from Agent Benchmarks"}
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function SessionDetailView({
  id,
  onSync,
  syncing,
}: {
  id: number;
  onSync: () => void;
  syncing: boolean;
}) {
  const [detail, setDetail] = useState<SessionDetailData | null>(null);
  const [outline, setOutline] = useState<SessionOutlineItemData[] | null>(null);
  const [economics, setEconomics] = useState<TokenEconomics | null>(null);
  const [contextWindow, setContextWindow] = useState<ContextWindowTimelineData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [economicsError, setEconomicsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadEarlierError, setLoadEarlierError] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [issues, setIssues] = useState<SessionIngestIssue[] | null>(null);
  const [issuesError, setIssuesError] = useState<unknown>(null);
  const [detailRetryKey, setDetailRetryKey] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionStatePending, setSessionStatePending] = useState<SessionStateUpdate | null>(null);
  const [sessionStateError, setSessionStateError] = useState<string | null>(null);
  const [sessionStateNotice, setSessionStateNotice] = useState<string | null>(null);
  const [jumpingToSeq, setJumpingToSeq] = useState<number | null>(null);
  const [activeMessageSeq, setActiveMessageSeq] = useState<number | null>(null);
  const detailRef = useRef<SessionDetailData | null>(null);
  const activeMessageSeqRef = useRef<number | null>(null);
  const handledMessageHashRef = useRef<string | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMorePromiseRef = useRef<Promise<boolean> | null>(null);
  const sessionVersionRef = useRef(0);
  const jumpGenerationRef = useRef(0);
  const sessionStateMutationGenerationRef = useRef(0);

  useEffect(() => {
    void id;
    sessionStateMutationGenerationRef.current += 1;
    setDeleteDialogOpen(false);
    setSessionStatePending(null);
    setSessionStateError(null);
    setSessionStateNotice(null);
    return () => {
      sessionStateMutationGenerationRef.current += 1;
    };
  }, [id]);

  useEffect(() => {
    void detailRetryKey;
    const sessionVersion = sessionVersionRef.current + 1;
    sessionVersionRef.current = sessionVersion;
    let cancelled = false;
    setDetail(null);
    detailRef.current = null;
    loadMorePromiseRef.current = null;
    setOutline(null);
    setEconomics(null);
    setContextWindow(null);
    setError(null);
    setEconomicsError(null);
    setLoadingMore(false);
    setLoadMoreError(null);
    setLoadEarlierError(null);
    setShowIssues(false);
    setIssues(null);
    setIssuesError(null);
    setJumpingToSeq(null);
    jumpGenerationRef.current += 1;
    activeMessageSeqRef.current = null;
    handledMessageHashRef.current = null;
    setActiveMessageSeq(null);
    if (!Number.isFinite(id)) {
      setError("Invalid session id.");
      return;
    }
    void getJson<SessionDetailData>(
      `/api/sessions/${id}?message_limit=${SESSION_DETAIL_MESSAGE_PAGE_SIZE}`,
    )
      .then((nextDetail) => {
        if (!cancelled && sessionVersionRef.current === sessionVersion) {
          detailRef.current = nextDetail;
          setDetail(nextDetail);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err);
        }
      });
    void getJson<SessionOutlineItemData[]>(`/api/sessions/${id}/outline`)
      .then((nextOutline) => {
        if (!cancelled && sessionVersionRef.current === sessionVersion) {
          setOutline(nextOutline);
        }
      })
      .catch(() => {});
    void getJson<TokenEconomics>(`/api/sessions/${id}/token-economics`)
      .then((nextEconomics) => {
        if (!cancelled) {
          setEconomics(nextEconomics);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEconomicsError(errorMessage(err));
        }
      });
    void getJson<ContextWindowTimelineData>(`/api/sessions/${id}/context-window`)
      .then((nextTimeline) => {
        if (!cancelled) {
          setContextWindow(nextTimeline);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      sessionVersionRef.current += 1;
    };
  }, [detailRetryKey, id]);

  useEffect(() => {
    if (!showIssues || issues != null || issuesError != null) {
      return;
    }
    let cancelled = false;
    void getJson<SessionIngestIssue[]>(`/api/sessions/${id}/issues`)
      .then((nextIssues) => {
        if (!cancelled) {
          setIssues(nextIssues);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setIssuesError(err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, showIssues, issues, issuesError]);

  const loadMoreMessages = useCallback((): Promise<boolean> => {
    if (loadMorePromiseRef.current != null) {
      return loadMorePromiseRef.current;
    }
    const current = detailRef.current;
    if (current == null || current.has_more_messages !== true) {
      return Promise.resolve(false);
    }
    const sessionVersion = sessionVersionRef.current;
    const offset = (current.message_offset ?? 0) + current.messages.length;
    setLoadingMore(true);
    setLoadMoreError(null);
    const request = getJson<SessionDetailData>(
      `/api/sessions/${id}?message_limit=${SESSION_DETAIL_MESSAGE_PAGE_SIZE}&message_offset=${offset}`,
    )
      .then((page) => {
        if (sessionVersionRef.current !== sessionVersion) {
          return false;
        }
        const latest = detailRef.current;
        if (latest == null || latest.summary.id !== id) {
          return false;
        }
        const messages = appendTranscriptPage(latest.messages, page.messages);
        const nextDetail = {
          ...latest,
          messages,
          message_offset: latest.message_offset ?? 0,
          message_limit: SESSION_DETAIL_MESSAGE_PAGE_SIZE,
          has_more_messages: page.has_more_messages === true,
        };
        detailRef.current = nextDetail;
        setDetail(nextDetail);
        return page.has_more_messages === true;
      })
      .catch((err: unknown) => {
        if (sessionVersionRef.current === sessionVersion) {
          setLoadMoreError(errorMessage(err));
        }
        return false;
      })
      .finally(() => {
        if (loadMorePromiseRef.current === request) {
          loadMorePromiseRef.current = null;
        }
        if (sessionVersionRef.current === sessionVersion) {
          setLoadingMore(false);
        }
      });
    loadMorePromiseRef.current = request;
    return request;
  }, [id]);

  const loadPreviousMessages = useCallback((): Promise<boolean> => {
    const sessionVersion = sessionVersionRef.current;
    return runWithTranscriptRequestSlot(
      loadMorePromiseRef,
      () => sessionVersionRef.current === sessionVersion,
      false,
      async () => {
        const current = detailRef.current;
        if (current == null || current.summary.id !== id) {
          return false;
        }
        const request = previousTranscriptPageRequest(
          current.message_offset ?? 0,
          SESSION_DETAIL_MESSAGE_PAGE_SIZE,
        );
        if (request == null) {
          return false;
        }
        setLoadingMore(true);
        setLoadEarlierError(null);
        return getJson<SessionDetailData>(
          `/api/sessions/${id}?message_limit=${request.limit}&message_offset=${request.offset}`,
        )
          .then((page) => {
            if (sessionVersionRef.current !== sessionVersion) {
              return false;
            }
            const latest = detailRef.current;
            if (latest == null || latest.summary.id !== id) {
              return false;
            }
            if (page.messages.length === 0) {
              return false;
            }
            preserveScrollAcrossPrepend(latest.messages, () => {
              const nextDetail = {
                ...latest,
                messages: prependTranscriptPage(latest.messages, page.messages),
                message_offset: request.offset,
              };
              detailRef.current = nextDetail;
              flushSync(() => {
                setDetail(nextDetail);
              });
            });
            return true;
          })
          .catch((err: unknown) => {
            if (sessionVersionRef.current === sessionVersion) {
              setLoadEarlierError(errorMessage(err));
            }
            return false;
          })
          .finally(() => {
            if (sessionVersionRef.current === sessionVersion) {
              setLoadingMore(false);
            }
          });
      },
    );
  }, [id]);

  const loadMessageWindow = useCallback(
    async (seq: number): Promise<boolean> => {
      const sessionVersion = sessionVersionRef.current;
      return runWithTranscriptRequestSlot(
        loadMorePromiseRef,
        () => sessionVersionRef.current === sessionVersion,
        false,
        async () => {
          const current = detailRef.current;
          if (current == null || current.summary.id !== id) {
            return false;
          }
          if (
            (current.message_offset ?? 0) === 0 &&
            current.messages.some((message) => message.seq === seq)
          ) {
            return true;
          }
          const request = transcriptPrefixRequest(
            seq,
            current.summary.message_count,
            SESSION_DETAIL_MESSAGE_PAGE_SIZE,
          );
          setLoadingMore(true);
          setLoadMoreError(null);
          return fetchTranscriptRange(
            (offset, limit) =>
              getJson<SessionDetailData>(
                `/api/sessions/${id}?message_limit=${limit}&message_offset=${offset}`,
              ),
            request.offset,
            request.limit,
            SESSION_MESSAGE_PAGE_MAX,
            () => sessionVersionRef.current === sessionVersion,
          )
            .then((page) => {
              if (sessionVersionRef.current !== sessionVersion) {
                return false;
              }
              if (page.messages.length === 0) {
                return false;
              }
              const latest = detailRef.current;
              if (latest == null || latest.summary.id !== id) {
                return false;
              }
              const messages =
                (latest.message_offset ?? 0) > 0
                  ? appendTranscriptPage(page.messages, latest.messages)
                  : page.messages;
              const nextDetail = {
                ...page,
                messages,
                message_offset: 0,
                message_limit: request.limit,
                has_more_messages:
                  messages.length < latest.summary.message_count ||
                  page.has_more_messages === true ||
                  latest.has_more_messages === true,
              };
              detailRef.current = nextDetail;
              flushSync(() => {
                setDetail(nextDetail);
              });
              return nextDetail.messages.some((message) => message.seq === seq);
            })
            .catch((err: unknown) => {
              if (sessionVersionRef.current === sessionVersion) {
                setLoadMoreError(errorMessage(err));
              }
              return false;
            })
            .finally(() => {
              if (sessionVersionRef.current === sessionVersion) {
                setLoadingMore(false);
              }
            });
        },
      );
    },
    [id],
  );

  const jumpToMessage = useCallback(
    async (seq: number) => {
      const sessionVersion = sessionVersionRef.current;
      const jumpGeneration = jumpGenerationRef.current + 1;
      jumpGenerationRef.current = jumpGeneration;
      const hash = `#message-${seq}`;
      handledMessageHashRef.current = `${id}:${seq}`;
      window.history.replaceState(null, "", hash);
      setJumpingToSeq(seq);
      try {
        const loaded = await loadMessageWindow(seq);
        if (
          !loaded ||
          sessionVersionRef.current !== sessionVersion ||
          jumpGenerationRef.current !== jumpGeneration
        ) {
          return;
        }
        activeMessageSeqRef.current = seq;
        setActiveMessageSeq(seq);
        requestAnimationFrame(() => {
          if (
            sessionVersionRef.current === sessionVersion &&
            jumpGenerationRef.current === jumpGeneration
          ) {
            scrollTranscriptMessage(
              seq,
              true,
              () =>
                sessionVersionRef.current === sessionVersion &&
                jumpGenerationRef.current === jumpGeneration,
            );
          }
        });
      } finally {
        if (
          sessionVersionRef.current === sessionVersion &&
          jumpGenerationRef.current === jumpGeneration
        ) {
          setJumpingToSeq((current) => (current === seq ? null : current));
        }
      }
    },
    [id, loadMessageWindow],
  );

  const loadedMessageCount = detail?.messages.length ?? 0;
  useEffect(() => {
    if (detail == null) {
      return;
    }
    const followMessageHash = () => {
      const seq = transcriptSeqFromHash(window.location.hash);
      if (seq == null) {
        return;
      }
      const key = `${id}:${seq}`;
      if (handledMessageHashRef.current === key) {
        return;
      }
      handledMessageHashRef.current = key;
      void jumpToMessage(seq);
    };
    followMessageHash();
    window.addEventListener("hashchange", followMessageHash);
    return () => window.removeEventListener("hashchange", followMessageHash);
  }, [detail, id, jumpToMessage]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (
      sentinel == null ||
      loadedMessageCount === 0 ||
      detail?.has_more_messages !== true ||
      loadMoreError != null ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreMessages();
        }
      },
      { rootMargin: "700px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [detail?.has_more_messages, loadedMessageCount, loadMoreError, loadMoreMessages]);

  const navigateTranscript = useCallback(
    async (direction: TranscriptNavigationDirection) => {
      const sessionVersion = sessionVersionRef.current;
      let current = detailRef.current;
      if (current == null) {
        return;
      }
      let sequences = renderableMessages(current.messages).map((message) => message.seq);
      let activeSeq = activeMessageSeqRef.current;
      if (activeSeq == null || !sequences.includes(activeSeq)) {
        activeSeq = nearestTranscriptSeq(sequences);
      }
      let targetSeq = nextTranscriptSeq(sequences, activeSeq, direction);
      const canLoadForward = direction === 1 && current.has_more_messages === true;
      const canLoadBackward = direction === -1 && (current.message_offset ?? 0) > 0;
      if (targetSeq == null && (canLoadForward || canLoadBackward)) {
        await (canLoadForward ? loadMoreMessages() : loadPreviousMessages());
        if (sessionVersionRef.current !== sessionVersion) {
          return;
        }
        current = detailRef.current;
        sequences =
          current == null
            ? sequences
            : renderableMessages(current.messages).map((message) => message.seq);
        targetSeq = nextTranscriptSeq(sequences, activeSeq, direction);
      }
      if (targetSeq == null) {
        return;
      }
      activeMessageSeqRef.current = targetSeq;
      setActiveMessageSeq(targetSeq);
      handledMessageHashRef.current = `${id}:${targetSeq}`;
      window.history.replaceState(null, "", `#message-${targetSeq}`);
      requestAnimationFrame(() => {
        if (sessionVersionRef.current === sessionVersion) {
          scrollTranscriptMessage(targetSeq);
        }
      });
    },
    [id, loadMoreMessages, loadPreviousMessages],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const direction = transcriptNavigationDirection(event);
      if (
        direction == null ||
        event.repeat ||
        isInteractiveTarget(event.target) ||
        isInteractiveTarget(document.activeElement) ||
        hasOpenModal(document)
      ) {
        return;
      }
      event.preventDefault();
      void navigateTranscript(direction);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateTranscript]);

  const mutateSessionState = useCallback(
    (state: SessionStateUpdate) => {
      const mutationGeneration = sessionStateMutationGenerationRef.current + 1;
      sessionStateMutationGenerationRef.current = mutationGeneration;
      setSessionStatePending(state);
      setSessionStateError(null);
      setSessionStateNotice(null);
      const request = sessionStateRequest(id, state);
      void getJson<{ ok: true }>(request.path, request.init)
        .then(() => {
          if (sessionStateMutationGenerationRef.current !== mutationGeneration) {
            return;
          }
          if (state === "deleted") {
            setDeleteDialogOpen(false);
            visit("/sessions");
            return;
          }
          setDeleteDialogOpen(false);
          if (state === "visible") {
            setSessionStateNotice("Session restored to the default views.");
          }
          setDetailRetryKey((key) => key + 1);
        })
        .catch((err: unknown) => {
          if (sessionStateMutationGenerationRef.current === mutationGeneration) {
            setSessionStateError(errorMessage(err));
          }
        })
        .finally(() => {
          if (sessionStateMutationGenerationRef.current === mutationGeneration) {
            setSessionStatePending(null);
          }
        });
    },
    [id],
  );

  const subagents = detail?.subagents;
  const subagentsByToolUse = useMemo(() => subagentMap(subagents ?? []), [subagents]);
  const detailMessages = detail?.messages;
  const messages = useMemo(() => renderableMessages(detailMessages ?? []), [detailMessages]);
  const toc = useMemo(
    () => (outline == null ? threadToc(messages) : threadTocFromOutline(outline)),
    [messages, outline],
  );
  const compactions = contextWindow?.compactions;
  const compactionBySeq = useMemo(
    () => new Map((compactions ?? []).map((compaction) => [compaction.seq, compaction] as const)),
    [compactions],
  );
  const compactionNumberBySeq = useMemo(
    () => new Map((compactions ?? []).map((compaction, index) => [compaction.seq, index + 1])),
    [compactions],
  );

  if (error != null) {
    return (
      <ApiFailureState
        error={error}
        onRetry={() => setDetailRetryKey((key) => key + 1)}
        onSync={onSync}
      />
    );
  }

  if (detail == null) {
    return <SessionDetailSkeleton />;
  }

  const stats = threadStats(
    detail.summary,
    messages,
    toc,
    contextWindow?.turn_count,
    detail.totals,
  );
  const subagentRuns = countSubagentRuns(detail.subagents);
  const windowTokens = contextWindow?.window_tokens ?? null;
  const detailTitle = sessionDisplayTitle(detail.summary);
  const archiveAction = archiveActionFor(detail.summary);
  const sessionsHref = detail.summary.is_user_archived
    ? sessionsArchivedHref("/sessions", true)
    : "/sessions";

  return (
    <div className="flex flex-col gap-6 p-6">
      <Card className="gap-4 p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">{detailTitle}</h1>
            <div className="flex items-center gap-2">
              <ReportExportButton
                excluded={SESSION_REPORT_NEVER_INCLUDES}
                href={`/api/reports/session/${detail.summary.id}.html`}
                includes={SESSION_REPORT_INCLUDES}
                previewHref={`/reports/session/${detail.summary.id}`}
                title="Review session report"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`More actions for ${detailTitle}`}
                  >
                    <Icon name="ellipsis" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {archiveAction != null ? (
                    <DropdownMenuItem
                      disabled={sessionStatePending != null}
                      onSelect={() => mutateSessionState(archiveAction)}
                    >
                      <Icon name="archive" />
                      <span>
                        {archiveAction === "visible" ? "Unarchive session" : "Archive session"}
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={sessionStatePending != null}
                    onSelect={() => {
                      setSessionStateError(null);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    <Icon name="trash" />
                    <span>Delete session</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ToolBadge tool={detail.summary.tool} />
            <ModelBadge model={detail.summary.model} />
            {detail.summary.model_provider != null ? (
              <Badge mono title={`Served through the ${detail.summary.model_provider} provider`}>
                {detail.summary.model_provider}
              </Badge>
            ) : null}
            <ReasoningBadge
              effort={detail.summary.reasoning_effort}
              levels={detail.summary.reasoning_effort_levels}
              totalReasoningTokens={detail.summary.total_reasoning_tokens}
              reasoningSource={detail.summary.reasoning_source}
              labeled
            />
            {detail.summary.ingest_issue_count > 0 ? (
              <button
                aria-expanded={showIssues}
                aria-label={`${showIssues ? "Hide" : "Show"} ingest diagnostics`}
                className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => setShowIssues((value) => !value)}
                type="button"
              >
                <Badge tone="warning">{formatIssueBadge(detail.summary.ingest_issue_count)}</Badge>
              </button>
            ) : null}
            {detail.summary.project_path != null ? (
              <Link
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent [&_svg]:size-3"
                href={projectSessionsHref(detail.summary.project_path)}
                title={detail.summary.project_path}
              >
                <Icon name="folder" />
                {basename(detail.summary.project_path)}
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
            <span>
              <strong>{formatInt(stats.turns)}</strong> {stats.turns === 1 ? "turn" : "turns"}
            </span>
            <span>
              <strong>{formatInt(stats.replies)}</strong>{" "}
              {stats.replies === 1 ? "reply" : "replies"}
            </span>
            <span>
              <strong>{formatInt(stats.toolCalls)}</strong>{" "}
              {stats.toolCalls === 1 ? "tool call" : "tool calls"}
            </span>
            <span>
              <strong>
                {detail.summary.usage_available ? compact(stats.tokens) : "Unavailable"}
              </strong>{" "}
              tokens
            </span>
            <span
              title={
                detail.summary.usage_available
                  ? costSourceTooltip(detail.summary.cost_source)
                  : "This source records no token usage, so Agent Benchmarks cannot estimate its cost."
              }
            >
              <strong>
                {detail.summary.usage_available
                  ? money(detail.summary.estimated_cost_usd)
                  : "Unavailable"}
              </strong>
              {costSourceLabel(detail.summary.cost_source) != null ? (
                <span className="text-muted-foreground">
                  {" "}
                  {costSourceLabel(detail.summary.cost_source)}
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </Card>

      {detail.summary.is_user_archived ? (
        <Alert className="flex flex-wrap items-center justify-between gap-4" role="status">
          <span>
            {detail.summary.user_state === "archived"
              ? "This session is archived and hidden from default lists, search, and analytics."
              : "This session is archived with a parent session."}
          </span>
          {detail.summary.user_state === "archived" ? (
            <Button
              variant="outline"
              disabled={sessionStatePending != null}
              onClick={() => mutateSessionState("visible")}
              type="button"
            >
              Unarchive
            </Button>
          ) : null}
        </Alert>
      ) : sessionStateNotice != null ? (
        <Alert role="status">{sessionStateNotice}</Alert>
      ) : null}
      {sessionStateError != null && !deleteDialogOpen ? (
        <Alert
          variant="destructive"
          className="flex flex-wrap items-center justify-between gap-4"
          role="alert"
        >
          <span>{sessionStateError}</span>
          {archiveAction != null ? (
            <Button
              variant="outline"
              disabled={sessionStatePending != null}
              onClick={() => mutateSessionState(archiveAction)}
              type="button"
            >
              Retry
            </Button>
          ) : null}
        </Alert>
      ) : null}

      {showIssues ? (
        <IngestIssuesPanel
          error={issuesError}
          issues={issues}
          onResync={onSync}
          onRetry={() => setIssuesError(null)}
          syncing={syncing}
        />
      ) : null}

      <Link
        className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground [&_svg]:size-4"
        href={sessionsHref}
      >
        <Icon name="arrowLeft" />
        Sessions
      </Link>

      <DeleteSessionDialog
        error={deleteDialogOpen ? sessionStateError : null}
        onClose={() => {
          if (sessionStatePending == null) {
            setDeleteDialogOpen(false);
            setSessionStateError(null);
          }
        }}
        onConfirm={() => mutateSessionState("deleted")}
        open={deleteDialogOpen}
        pending={sessionStatePending === "deleted"}
        title={detailTitle}
      />

      {economics != null ? (
        <TokenEconomicsPanel
          compact
          costAvailable={detail.summary.usage_available}
          description="Estimated agent activity inside this session, including nested subagents; capped user response time is shown separately."
          economics={economics}
          subagentRuns={subagentRuns}
          title="Activity breakdown"
        />
      ) : economicsError != null ? (
        <Alert>Activity breakdown unavailable: {economicsError}</Alert>
      ) : (
        <SessionEconomicsSkeleton />
      )}

      <ContextWindowPanel onJump={jumpToMessage} timeline={contextWindow} />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <div className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col gap-2 overflow-y-auto rounded-lg border bg-card p-4">
            <div className="font-semibold">In this thread</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground [&_kbd]:rounded [&_kbd]:border [&_kbd]:px-1">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd>
              </span>
              Move through messages
            </div>
            {toc.length === 0 ? <p>No prompts or Dosu calls to list</p> : null}
            {toc.map((item) => (
              <ThreadTocEntry
                current={activeMessageSeq === item.seq}
                item={item}
                jumping={jumpingToSeq === item.seq}
                key={item.key}
                onJump={jumpToMessage}
              />
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          {(detail.message_offset ?? 0) > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
              <span>
                {formatInt(detail.message_offset ?? 0)} earlier{" "}
                {(detail.message_offset ?? 0) === 1 ? "message" : "messages"} not loaded
              </span>
              {loadEarlierError != null ? (
                <span className="text-destructive" role="status">
                  Couldn’t load the earlier messages: {loadEarlierError}
                </span>
              ) : null}
              <span className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void loadPreviousMessages()}
                  type="button"
                >
                  {loadEarlierError != null
                    ? "Try again"
                    : loadingMore
                      ? "Loading…"
                      : "Load earlier"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void jumpToMessage(0)}
                  type="button"
                >
                  Start at the beginning
                </Button>
              </span>
            </div>
          ) : null}
          {messages.map((message) => (
            <TranscriptTurn
              active={activeMessageSeq === message.seq}
              compaction={compactionBySeq.get(message.seq) ?? null}
              compactionNumber={compactionNumberBySeq.get(message.seq) ?? null}
              key={messageKey(message)}
              message={message}
              sessionIsSubagent={detail.summary.is_subagent}
              subagentsByToolUse={subagentsByToolUse}
              tool={detail.summary.tool}
              windowTokens={windowTokens}
            />
          ))}
          {detail.has_more_messages === true ? (
            <div
              aria-live="polite"
              className="flex flex-wrap items-center gap-2 p-4 text-sm text-muted-foreground [&_small]:ml-2"
              ref={loadMoreSentinelRef}
              role="status"
            >
              {loadMoreError != null ? (
                <>
                  <span>Couldn’t load the next messages: {loadMoreError}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadMoreMessages()}
                    type="button"
                  >
                    Try again
                  </Button>
                </>
              ) : (
                <span>
                  {loadingMore ? "Loading more messages…" : "Keep scrolling to load more"}
                  <small>
                    {formatInt(detail.messages.length)} of {formatInt(detail.summary.message_count)}
                  </small>
                </span>
              )}
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {(detail.message_offset ?? 0) === 0
                ? `All ${formatInt(detail.summary.message_count)} messages loaded`
                : "Reached the end of this session"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function preserveScrollAcrossPrepend(
  renderedMessages: readonly { seq: number }[],
  prepend: () => void,
): void {
  let anchorSeq: number | null = null;
  let anchorTop: number | null = null;
  for (const message of renderedMessages) {
    const top = document.getElementById(`message-${message.seq}`)?.getBoundingClientRect().top;
    if (top != null) {
      anchorSeq = message.seq;
      anchorTop = top;
      break;
    }
  }
  prepend();
  if (anchorSeq != null && anchorTop != null) {
    const after = document.getElementById(`message-${anchorSeq}`)?.getBoundingClientRect().top;
    if (after != null && after !== anchorTop) {
      window.scrollBy({ behavior: "auto", top: after - anchorTop });
    }
  }
}

export function IngestIssuesPanel({
  error,
  issues,
  onResync,
  onRetry,
  syncing,
}: {
  error: unknown;
  issues: SessionIngestIssue[] | null;
  onResync: () => void;
  onRetry: () => void;
  syncing: boolean;
}) {
  const unknownIssues = issues?.filter((issue) => issue.code === "unknown_record_type") ?? [];
  const otherIssues = issues?.filter((issue) => issue.code !== "unknown_record_type") ?? [];
  const unknownSummary = unknownRecordTypeSummary(unknownIssues.map((issue) => issue.error));
  return (
    <Card className="gap-0 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Ingest diagnostics</h2>
          <p className="text-sm text-muted-foreground">
            A source line could not be parsed, so this session may be incomplete. Informational
            parser notes are included here for context.
          </p>
        </div>
        <SyncButton
          ariaLabel="Re-sync session logs"
          busy={syncing}
          label="Re-sync"
          onClick={onResync}
        />
      </div>
      <div className="pt-4">
        {error != null ? (
          <ApiFailureState error={error} onRetry={onRetry} />
        ) : issues == null ? (
          <p className="text-muted-foreground">Loading issues…</p>
        ) : issues.length === 0 ? (
          <p className="text-muted-foreground">No issues recorded for this session.</p>
        ) : (
          <div className="space-y-3">
            {unknownSummary.count > 0 ? (
              <div className="rounded-md border bg-muted/50 p-3">
                <div className="text-muted-foreground">
                  Agent Benchmarks safely preserved or ignored {formatInt(unknownSummary.count)}{" "}
                  unknown source {unknownSummary.count === 1 ? "record type" : "record types"}
                  {unknownSummary.types.length > 0
                    ? `: ${unknownSummary.types.map((type) => `“${type}”`).join(", ")}`
                    : ""}
                  . Review the unknown record types before re-syncing.
                </div>
              </div>
            ) : null}
            {otherIssues.map((issue) => (
              <div className="rounded-md border bg-muted/50 p-3" key={issue.id}>
                <div>
                  <div>
                    <code className="font-mono">{issue.code}</code>
                    {issue.line_no != null ? (
                      <span className="text-muted-foreground"> · line {issue.line_no}</span>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground">{issue.error}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function SessionDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6" aria-label="Loading session" role="status">
      <Card className="gap-4 p-6">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
      </Card>
      <Skeleton className="h-4 w-24" />
      <SessionEconomicsSkeleton />
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="gap-3 p-4">
          {["one", "two", "three", "four"].map((key) => (
            <Skeleton className="h-4 w-full" key={key} />
          ))}
        </Card>
        <div className="space-y-4">
          {["prompt", "reply", "tool", "followup", "summary"].map((key) => (
            <Card className="gap-3 p-4" key={key}>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SessionEconomicsSkeleton() {
  return (
    <Card aria-label="Loading activity breakdown" className="gap-3 p-6" role="status">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-2/3" />
      {["context", "planning", "code", "communicating"].map((key) => (
        <Skeleton className="h-4 w-full" key={key} />
      ))}
    </Card>
  );
}
