import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "./clipboard.ts";
import { versionLabel } from "./format.ts";
import { Icon } from "./icons.tsx";
import type { UpdateStatus } from "./types.ts";

const COPIED_RESET_MS = 1_800;

export function UpdateNudge({ status }: { status: UpdateStatus | null }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copied = copyState === "copied";

  useEffect(() => {
    if (copyState === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setCopyState("idle"), COPIED_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  if (status?.updateAvailable !== true || status.latest == null) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 text-sm">
      <a
        className="font-medium underline-offset-4 hover:underline"
        href={`https://github.com/dosu-ai/decant/releases/tag/${versionLabel(status.latest)}`}
        rel="noopener"
        target="_blank"
      >
        Agent Benchmarks {versionLabel(status.latest)} is available
      </a>
      <Button
        aria-label={`Copy the update command: ${status.command}`}
        variant="outline"
        onClick={() => {
          copyTextToClipboard(status.command).then(
            () => setCopyState("copied"),
            () => setCopyState("failed"),
          );
        }}
        title="Copy, then run it in a terminal"
        type="button"
      >
        <code>{status.command}</code>
        <Icon name={copied ? "check" : "copy"} />
      </Button>
      <span
        aria-live="polite"
        className={copyState === "failed" ? "text-destructive" : "sr-only"}
      >
        {copyState === "copied" ? "Copied" : ""}
        {copyState === "failed"
          ? "This page cannot use the clipboard. Type the command in a terminal."
          : ""}
      </span>
    </div>
  );
}
