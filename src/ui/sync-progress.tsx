import { syncCompleteLabel, syncFraction, syncProgressLabel } from "./sync-events.ts";
import type { SyncProgress } from "./types.ts";

function percentText(fraction: number): string {
  return `${Math.floor(fraction * 100)}%`;
}

function SyncFill({ fraction }: { fraction: number | null }) {
  return (
    <span
      className={`block h-full bg-primary transition-[width] ${fraction == null ? "w-1/3 animate-pulse motion-reduce:animate-none" : ""}`}
      data-indeterminate={fraction == null ? "true" : undefined}
      style={fraction == null ? undefined : { width: `${fraction * 100}%` }}
    />
  );
}

export function SyncProgressLine({
  complete,
  progress,
}: {
  complete: boolean;
  progress: SyncProgress | null;
}) {
  const fraction = complete ? 1 : syncFraction(progress);
  return (
    <div
      aria-label="Sync progress"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={fraction == null ? undefined : Math.floor(fraction * 100)}
      aria-valuetext={complete ? syncCompleteLabel(progress) : syncProgressLabel(progress)}
      className="h-1 w-full overflow-hidden bg-muted"
      data-complete={complete ? "true" : undefined}
      role="progressbar"
    >
      <SyncFill fraction={fraction} />
    </div>
  );
}

export function SyncProgressNotice({
  complete,
  firstSync,
  progress,
}: {
  complete: boolean;
  firstSync: boolean;
  progress: SyncProgress | null;
}) {
  const fraction = complete ? 1 : syncFraction(progress);
  return (
    <div className="space-y-2 rounded-md border bg-card p-4 text-sm" data-complete={complete ? "true" : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="font-medium">
          {complete ? syncCompleteLabel(progress) : syncProgressLabel(progress)}
        </strong>
        {firstSync && !complete ? (
          <span className="text-muted-foreground">
            First sync. Totals and insights appear when it finishes.
          </span>
        ) : null}
        {fraction != null && !complete ? (
          <span className="ml-auto tabular-nums text-muted-foreground">{percentText(fraction)}</span>
        ) : null}
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
        <SyncFill fraction={fraction} />
      </div>
    </div>
  );
}
