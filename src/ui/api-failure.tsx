import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError } from "./api.ts";
import { copyTextToClipboard } from "./clipboard.ts";
import { ErrorState } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { Link } from "./link.tsx";
import type { IconName } from "./types.ts";

export type RecoveryPresentation = {
  actionHref?: string;
  actionLabel?: string;
  command?: string;
  detail: string;
  icon: IconName;
  retry: boolean;
  title: string;
  useSync?: boolean;
};

export function recoveryPresentation(error: unknown): RecoveryPresentation {
  if (!(error instanceof ApiError)) {
    return {
      detail:
        "Agent Benchmarks could not reach the local server. Restart `agent-benchmarks serve` if needed, then retry.",
      icon: "info",
      retry: true,
      title: "Request failed",
    };
  }
  switch (error.code) {
    case "session_not_found":
      return error.extras.archive_empty === true
        ? {
            actionHref: "/sessions",
            actionLabel: "Back to sessions",
            detail: "There are no session logs on this device yet. Sync to import them.",
            icon: "sessions",
            retry: false,
            title: "No session logs yet",
            useSync: true,
          }
        : {
            actionHref: "/sessions",
            actionLabel: "Back to sessions",
            detail: "This session log is no longer available. It may have moved after a rebuild.",
            icon: "inbox",
            retry: false,
            title: "Session not found",
            useSync: true,
          };
    case "schema_too_new":
      return {
        actionLabel: "Rebuild from source",
        detail: "These session logs were indexed by a newer Agent Benchmarks build. Update this checkout, then retry.",
        icon: "info",
        retry: true,
        title: "Agent Benchmarks is out of date",
      };
    case "schema_too_old":
      return {
        actionLabel: "Rebuild archive",
        detail:
          "The session log index predates the supported schema baseline. Back it up, rebuild it, and sync the source logs again.",
        icon: "info",
        retry: false,
        title: "Session log index rebuild required",
      };
    case "launch_unsupported_platform":
      return {
        command: typeof error.extras.command === "string" ? error.extras.command : undefined,
        detail:
          "Native agent and editor launching is available on macOS. Copy the prompt or command and run it manually here.",
        icon: "info",
        retry: false,
        title: "Native launch is unavailable",
      };
    case "launch_failed":
      return {
        command: typeof error.extras.command === "string" ? error.extras.command : undefined,
        actionHref: "/settings",
        actionLabel: "Check launcher settings",
        detail:
          "Agent Benchmarks could not open the selected app. Check the launcher setting, then try again.",
        icon: "info",
        retry: true,
        title: "Launch failed",
      };
    case "archive_locked":
      return {
        detail:
          "Another Agent Benchmarks operation is using the session log index. Wait a moment, then retry.",
        icon: "clock",
        retry: true,
        title: "Session logs are busy",
      };
    case "service_starting":
      return {
        detail: "Agent Benchmarks is finishing local startup. Try again in a moment.",
        icon: "clock",
        retry: true,
        title: "Agent Benchmarks is starting",
      };
    case "internal_error":
      return {
        detail:
          "Agent Benchmarks hit an unexpected local error. Restart `agent-benchmarks serve`, then retry. If it continues, check the server log for the private diagnostic.",
        icon: "info",
        retry: true,
        title: "Agent Benchmarks could not complete the request",
      };
    default:
      if (error.status >= 500) {
        return {
          detail:
            "Agent Benchmarks hit an unexpected local error. Restart `agent-benchmarks serve`, then retry. If it continues, check the server log.",
          icon: "info",
          retry: true,
          title: "Agent Benchmarks could not complete the request",
        };
      }
      return {
        detail: "Agent Benchmarks could not complete this request. Check the input and try again.",
        icon: "info",
        retry: true,
        title: "Request failed",
      };
  }
}

export function ApiFailureState({
  error,
  onRetry,
  onSync,
}: {
  error: unknown;
  onRetry?: () => void;
  onSync?: () => void;
}) {
  const [commandCopied, setCommandCopied] = useState(false);
  const recovery = recoveryPresentation(error);
  const retryIsPrimary =
    !recovery.useSync && recovery.actionHref == null && recovery.retry && onRetry != null;
  const action =
    recovery.actionHref != null && recovery.actionLabel != null ? (
      <Link
        className={buttonVariants()}
        href={recovery.actionHref}
        rel={recovery.actionHref.startsWith("http") ? "noopener" : undefined}
        target={recovery.actionHref.startsWith("http") ? "_blank" : undefined}
      >
        {recovery.actionLabel}
      </Link>
    ) : recovery.useSync && onSync != null ? (
      <Button onClick={onSync} type="button">Sync now</Button>
    ) : retryIsPrimary ? (
      <Button onClick={onRetry} type="button">Retry</Button>
    ) : null;
  const secondaryAction =
    recovery.useSync && onSync != null && action != null ? (
      <Button variant="outline" onClick={onSync} type="button">Sync now</Button>
    ) : recovery.retry && onRetry != null && action != null && !retryIsPrimary ? (
      <Button variant="outline" onClick={onRetry} type="button">Retry</Button>
    ) : null;
  return (
    <div className="space-y-4">
      <ErrorState
        action={action}
        detail={recovery.detail}
        icon={recovery.icon}
        secondaryAction={secondaryAction}
        title={recovery.title}
      />
      {recovery.command != null ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-4">
          <code>{recovery.command}</code>
          <Button
            variant="outline"
            onClick={() => {
              void copyTextToClipboard(recovery.command ?? "")
                .then(() => setCommandCopied(true))
                .catch(() => setCommandCopied(false));
            }}
            type="button"
          >
            <Icon name={commandCopied ? "check" : "copy"} />
            {commandCopied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
