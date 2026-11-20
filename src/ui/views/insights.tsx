import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { getJson } from "../api.ts";
import { ApiFailureState } from "../api-failure.tsx";
import { copyTextToClipboard } from "../clipboard.ts";
import { EmptyState } from "../common.tsx";
import { field, formatInt, isPresent, shortDate } from "../format.ts";
import { Icon } from "../icons.tsx";
import type { IconName, Recommendation, SettingsInfo } from "../types.ts";

export type RecommendationAction = "launch" | "copy" | "mark";

export type PendingActions = Readonly<Record<string, RecommendationAction>>;

export type RecommendationHandlers = {
  agentLabel: string | null;
  canLaunch: boolean;
  copiedKey: string | null;
  onComplete: (row: Recommendation) => void;
  onCopy: (row: Recommendation) => void;
  pending: PendingActions;
};

export function RecommendationHero({
  row,
  ...handlers
}: RecommendationHandlers & { row: Recommendation }) {
  const facts = recommendationFacts(row);
  return (
    <article className="flex gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
      <span className="rounded-md bg-muted p-2">
        <Icon name={recommendationIcon(row)} />
      </span>
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <span className="text-sm text-muted-foreground">Top signal</span>
        <div className="flex flex-wrap items-center gap-2 font-semibold">
          <h3>{row.title}</h3>
          {isPresent(row.impact_label) ? <strong>{row.impact_label}</strong> : null}
        </div>
        {facts.summary != null ? <p className="text-sm text-muted-foreground">{facts.summary}</p> : null}
        <RecommendationDetail facts={facts} row={row} {...handlers} />
      </div>
    </article>
  );
}

export function RecommendationRow({
  row,
  ...handlers
}: RecommendationHandlers & { row: Recommendation }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const facts = recommendationFacts(row);
  return (
    <article className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <button
        aria-controls={expanded ? detailId : undefined}
        aria-expanded={expanded}
        className="flex w-full items-start gap-4 p-4 text-left hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="rounded-md bg-muted p-2">
          <Icon name={recommendationIcon(row)} />
        </span>
        <span className="grid min-w-0 flex-1 gap-1 [overflow-wrap:anywhere]">
          <span className="font-semibold">{row.title}</span>
          {facts.summary != null ? (
            <span className="text-sm text-muted-foreground">{facts.summary}</span>
          ) : null}
        </span>
        {isPresent(row.impact_label) ? (
          <strong className="text-sm">{row.impact_label}</strong>
        ) : null}
        <span aria-hidden="true" className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>{expanded ? "Close" : "View"}</span>
          <Icon name={expanded ? "chevronUp" : "chevronDown"} />
        </span>
      </button>
      {expanded ? (
        <div className="border-t p-4" id={detailId}>
          <RecommendationDetail facts={facts} row={row} {...handlers} />
        </div>
      ) : null}
    </article>
  );
}

export function RecommendationDetail({
  facts,
  row,
  ...handlers
}: RecommendationHandlers & { facts: RecommendationFacts; row: Recommendation }) {
  return (
    <div className="mt-4 space-y-4">
      {facts.suggestion != null ? (
        <div>
          <span className="text-sm font-medium">Suggested</span>
          <p className="text-sm text-muted-foreground">{facts.suggestion}</p>
        </div>
      ) : null}
      {facts.evidence != null ? (
        <div>
          <span className="text-sm font-medium">Evidence</span>
          <p className="text-sm text-muted-foreground">{facts.evidence}</p>
        </div>
      ) : null}
      <PromotionPanel row={row} />
      <PromptPreview agentLabel={handlers.agentLabel} canLaunch={handlers.canLaunch} row={row} />
      <RecommendationActions row={row} {...handlers} />
    </div>
  );
}

export type RecommendationFacts = {
  summary: string | null;
  suggestion: string | null;
  evidence: string | null;
};

export function recommendationFacts(row: Recommendation): RecommendationFacts {
  const seen = new Set<string>();
  const sameText = (value: string) =>
    value
      .trim()
      .replace(/[.!]+$/, "")
      .toLowerCase();
  if (isPresent(row.impact_label)) {
    seen.add(sameText(row.impact_label));
  }
  const once = (value: string | null): string | null => {
    if (!isPresent(value) || seen.has(sameText(value))) {
      return null;
    }
    seen.add(sameText(value));
    return value.trim();
  };
  const summary = once(row.detail) ?? once(row.suggestion);
  return { summary, suggestion: once(row.suggestion), evidence: once(row.evidence) };
}

export function recommendationAction(
  row: Recommendation,
  canLaunch: boolean,
): RecommendationAction | null {
  if (isPresent(row.prompt)) {
    return canLaunch ? "launch" : "copy";
  }
  return row.action != null || row.suggestion != null ? "mark" : null;
}

const ACTION_COPY: Record<
  RecommendationAction,
  { icon: IconName; label: string; pendingLabel: string }
> = {
  launch: { icon: "bolt", label: "Run", pendingLabel: "Opening" },
  copy: { icon: "copy", label: "Copy setup prompt", pendingLabel: "Copying" },
  mark: { icon: "check", label: "Mark as done", pendingLabel: "Saving" },
};

export function RecommendationActions({
  agentLabel,
  canLaunch,
  copiedKey,
  onComplete,
  onCopy,
  pending,
  row,
}: RecommendationHandlers & { row: Recommendation }) {
  const action = recommendationAction(row, canLaunch);
  const busy = pending[row.key] ?? null;
  const copied = copiedKey === row.key;
  const copyLabel =
    busy === "copy" ? ACTION_COPY.copy.pendingLabel : copied ? "Copied" : ACTION_COPY.copy.label;
  return (
    <div className="flex flex-wrap gap-2">
      {action === "launch" ? (
        <Button
          disabled={busy != null}
          onClick={() => onComplete(row)}
          type="button"
        >
          <Icon name={ACTION_COPY.launch.icon} />
          {busy === "launch"
            ? ACTION_COPY.launch.pendingLabel
            : agentLabel != null
              ? `Run in ${agentLabel}`
              : ACTION_COPY.launch.label}
        </Button>
      ) : null}
      {action === "launch" || action === "copy" ? (
        <Button variant="outline"
          disabled={busy === "copy"}
          onClick={() => (action === "copy" ? onComplete(row) : onCopy(row))}
          type="button"
        >
          <Icon name={copied && busy == null ? "check" : ACTION_COPY.copy.icon} />
          {copyLabel}
        </Button>
      ) : null}
      {action === "mark" ? (
        <Button variant="outline"
          disabled={busy != null}
          onClick={() => onComplete(row)}
          type="button"
        >
          <Icon name={ACTION_COPY.mark.icon} />
          {busy === "mark" ? ACTION_COPY.mark.pendingLabel : ACTION_COPY.mark.label}
        </Button>
      ) : null}
      {row.url != null ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`More actions for ${row.title}`}><Icon name="ellipsis" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem asChild><a href={row.url} rel="noreferrer" target="_blank"><span>{row.link_label ?? "Docs"}</span><span aria-hidden="true">↗</span></a></DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

const MEMORY_LAYER_COPY: Record<string, string> = {
  hot: "Loaded in every session",
  procedural: "Loaded when a task calls for it",
  cold: "Looked up when it is needed",
  governance: "Kept as a team rule or an automated check",
};

export function memoryLayerCopy(layer: string): string {
  return MEMORY_LAYER_COPY[layer.trim().toLowerCase()] ?? layer;
}

export function PromotionPanel({
  compact = false,
  row,
}: {
  compact?: boolean;
  row: Recommendation;
}) {
  if (!hasPromotion(row)) {
    return null;
  }
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
      <span className="text-sm font-medium">Plan</span>
      {compact ? null : (
        <p className="text-sm text-muted-foreground">
          Where to record this so future agent sessions use it, and how to tell that it worked.
          {isPresent(row.prompt) ? " The prompt below includes this plan." : ""}
        </p>
      )}
      <dl>
        {isPresent(row.promotion_target) ? (
          <div className="grid gap-1 py-1 text-sm sm:grid-cols-3">
            <dt>Record it in</dt>
            <dd>{row.promotion_target}</dd>
          </div>
        ) : null}
        {isPresent(row.memory_layer) ? (
          <div className="grid gap-1 py-1 text-sm sm:grid-cols-3">
            <dt>How agents get it</dt>
            <dd>{memoryLayerCopy(row.memory_layer)}</dd>
          </div>
        ) : null}
        {!compact && isPresent(row.trigger) ? (
          <div className="grid gap-1 py-1 text-sm sm:grid-cols-3">
            <dt>When it applies</dt>
            <dd>{row.trigger}</dd>
          </div>
        ) : null}
        {!compact && isPresent(row.success_metric) ? (
          <div className="grid gap-1 py-1 text-sm sm:grid-cols-3">
            <dt>It worked when</dt>
            <dd>{row.success_metric}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

const LONG_PROMPT_LINES = 4;
const LONG_PROMPT_CHARS = 320;

export function isLongPrompt(prompt: string): boolean {
  return prompt.length > LONG_PROMPT_CHARS || prompt.split("\n").length > LONG_PROMPT_LINES;
}

export function PromptPreview({
  agentLabel,
  canLaunch,
  row,
}: {
  agentLabel: string | null;
  canLaunch: boolean;
  row: Recommendation;
}) {
  if (!isPresent(row.prompt)) {
    return null;
  }
  const prompt = handoffPrompt(row);
  const lines = prompt.split("\n").length;
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Prompt</span>
      <p className="text-sm text-muted-foreground">
        {canLaunch
          ? `Run opens ${agentLabel ?? "your coding agent"} in a terminal and sends it this prompt. Read it before you run it.`
          : "Copy setup prompt puts this text on your clipboard. Paste it into your coding agent."}
      </p>
      <Collapsible defaultOpen={!isLongPrompt(prompt)} className="rounded-md border p-3">
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
          <span>
            <Icon name="chevronRight" />
          </span>
          <span>Full prompt</span>
          <span className="text-muted-foreground">
            {formatInt(lines)} {lines === 1 ? "line" : "lines"}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap text-sm">{prompt}</pre>
        {canLaunch ? (
          <p className="text-sm text-muted-foreground">
            Run adds one last line that asks the agent to mark this insight done when it has
            verified the work:
            <code className="block">agent-benchmarks recommendations mark {row.key}</code>
          </p>
        ) : null}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function recommendationIcon(row: Recommendation): IconName {
  const icon = row.icon ?? "";
  if (icon.includes("cpu")) {
    return "cpu";
  }
  if (icon.includes("document") || icon.includes("book")) {
    return "file";
  }
  if (icon.includes("wrench")) {
    return "tools";
  }
  if (icon.includes("chart")) {
    return "chart";
  }
  return "lightbulb";
}

export function groupByCategory(rows: Recommendation[]): [string, Recommendation[]][] {
  const groups = new Map<string, Recommendation[]>();
  for (const row of rows) {
    const key = row.category ?? "Recommended";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()];
}

export function hasPromotion(row: Recommendation): boolean {
  return [row.memory_layer, row.promotion_target, row.trigger, row.success_metric].some(isPresent);
}

export function handoffPrompt(row: Recommendation): string {
  return [row.prompt ?? row.action ?? row.suggestion, promotionText(row)]
    .filter(isPresent)
    .join("\n\n");
}

export function promotionText(row: Recommendation): string {
  return [
    `# ${row.title}`,
    `Key: ${row.key}`,
    field("Layer", row.memory_layer),
    field("Promote to", row.promotion_target),
    field("Trigger", row.trigger),
    field("Evidence", row.evidence),
    field("Action", row.action),
    field("Done when", row.success_metric),
  ]
    .filter(isPresent)
    .join("\n");
}

export function InsightsView({
  firstSync = false,
  loading,
  loadFailed,
  rows,
  settingsInfo,
  onMarked,
}: {
  firstSync?: boolean;
  loading: boolean;
  loadFailed: boolean;
  rows: Recommendation[];
  settingsInfo: SettingsInfo | null;
  onMarked: () => void;
}) {
  const [pending, setPending] = useState<PendingActions>({});
  const [error, setError] = useState<unknown>(null);
  const [failedAction, setFailedAction] = useState<Recommendation | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{
    kind: "success" | "error";
    key: string;
    message: string;
  } | null>(null);
  const openRows = rows.filter((row) => row.status === "open");
  const implementedRows = rows
    .filter((row) => row.status === "implemented")
    .slice()
    .sort(
      (left, right) =>
        implementedTimestamp(right) - implementedTimestamp(left) || right.score - left.score,
    );
  const signals = openRows
    .filter((row) => row.kind === "signal")
    .slice()
    .sort((left, right) => right.score - left.score);
  const [hero, ...rest] = signals;
  const catalogGroups = groupByCategory(openRows.filter((row) => row.kind === "catalog"));
  const canLaunch = settingsInfo?.can_launch === true;
  const agentLabel =
    settingsInfo?.options.agents.find(([key]) => key === settingsInfo.settings.agent)?.[1] ?? null;
  const startAction = (row: Recommendation, action: RecommendationAction) => {
    setError(null);
    setFailedAction(null);
    setCopyFeedback(null);
    setPending((current) => ({ ...current, [row.key]: action }));
  };
  const finishAction = (row: Recommendation, action: RecommendationAction) => {
    setPending((current) => {
      if (current[row.key] !== action) {
        return current;
      }
      const { [row.key]: _finished, ...rest } = current;
      return rest;
    });
  };
  const copyPrompt = (row: Recommendation) => {
    const tracked = pending[row.key] == null;
    if (tracked) {
      startAction(row, "copy");
    } else {
      setCopyFeedback(null);
    }
    void copyTextToClipboard(handoffPrompt(row))
      .then(() => {
        setCopyFeedback({
          kind: "success",
          key: row.key,
          message: `Copied the setup prompt for “${row.title}”.`,
        });
      })
      .catch(() => {
        setCopyFeedback({
          kind: "error",
          key: row.key,
          message:
            "Could not copy the setup prompt. Open the full prompt in the row and copy it from there.",
        });
      })
      .finally(() => {
        if (tracked) {
          finishAction(row, "copy");
        }
      });
  };
  const completeRecommendation = (row: Recommendation) => {
    const action = recommendationAction(row, canLaunch && settingsInfo != null);
    if (action === "launch" && settingsInfo != null) {
      startAction(row, "launch");
      void getJson<{ ok: boolean }>("/api/launch/agent", {
        method: "POST",
        body: JSON.stringify({
          agent: settingsInfo.settings.agent,
          prompt: handoffPrompt(row),
          key: row.key,
        }),
      })
        .then(() => onMarked())
        .catch((err: unknown) => {
          setError(err);
          setFailedAction(row);
        })
        .finally(() => finishAction(row, "launch"));
      return;
    }
    if (action === "copy") {
      copyPrompt(row);
      return;
    }
    startAction(row, "mark");
    void getJson<{ ok: boolean }>("/api/recommendations/mark", {
      method: "POST",
      body: JSON.stringify({ key: row.key, source: "ui" }),
    })
      .then(onMarked)
      .catch((err: unknown) => {
        setError(err);
        setFailedAction(row);
      })
      .finally(() => finishAction(row, "mark"));
  };
  const handlers = {
    agentLabel,
    canLaunch,
    copiedKey: copyFeedback?.kind === "success" ? copyFeedback.key : null,
    onComplete: completeRecommendation,
    onCopy: copyPrompt,
    pending,
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted-foreground">
          Agent Benchmarks finds recurring patterns in your local sessions, ranks the ones worth acting on,
          and suggests durable improvements for future agent runs.
        </p>
      </header>

      {error != null ? (
        <ApiFailureState
          error={error}
          onRetry={failedAction == null ? undefined : () => completeRecommendation(failedAction)}
        />
      ) : null}
      {copyFeedback != null ? (
        <div
          className={copyFeedback.kind === "error" ? "rounded-md border border-destructive p-4 text-sm text-destructive" : "rounded-md border p-4 text-sm"}
          role={copyFeedback.kind === "error" ? "alert" : "status"}
        >
          {copyFeedback.message}
        </div>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:text-sm [&_p]:text-muted-foreground">
          <div>
            <span className="text-sm text-muted-foreground">Detected in your session logs</span>
            <h2>Patterns worth acting on</h2>
            <p>Evidence-backed signals from your own sessions, ranked by expected impact.</p>
          </div>
          {signals.length > 0 ? (
            <span className="text-sm text-muted-foreground">{formatInt(signals.length)} active</span>
          ) : null}
        </div>

        {loading && signals.length === 0 ? <InsightsSignalsSkeleton /> : null}

        {!loading && !loadFailed && signals.length === 0 ? (
          <EmptyState
            icon="lightbulb"
            message={
              firstSync
                ? "Agent Benchmarks looks for patterns once the first sync has read your session logs."
                : "More session history will surface patterns."
            }
            title={firstSync ? "Signals appear when the first sync finishes" : "No signals yet"}
          />
        ) : null}

        {hero != null ? <RecommendationHero row={hero} {...handlers} /> : null}

        {rest.length > 0 ? (
          <div className="grid gap-3">
            {rest.map((row) => (
              <RecommendationRow key={row.key} row={row} {...handlers} />
            ))}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:text-sm [&_p]:text-muted-foreground">
          <div>
            <span className="text-sm text-muted-foreground">Not from your session logs</span>
            <h2>Setup ideas</h2>
            <p>
              General suggestions that apply to any project. Agent Benchmarks did not derive them from your
              archive.
            </p>
          </div>
        </div>
        {catalogGroups.map(([category, items]) => (
          <div className="grid gap-3" key={category}>
            <div className="flex items-center justify-between text-sm font-medium">
              <h3>{category}</h3>
              <span>
                {formatInt(items.length)} {items.length === 1 ? "idea" : "ideas"}
              </span>
            </div>
            <div className="grid gap-3">
              {items.map((row) => (
                <RecommendationRow key={row.key} row={row} {...handlers} />
              ))}
            </div>
          </div>
        ))}
      </section>

      {implementedRows.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:text-sm [&_p]:text-muted-foreground">
            <div>
              <span className="text-sm text-muted-foreground">History</span>
              <h2>Already implemented</h2>
              <p>Improvements you have already marked complete.</p>
            </div>
            <span className="text-sm text-muted-foreground">{formatInt(implementedRows.length)} saved</span>
          </div>
          <div className="grid gap-3">
            {implementedRows.map((row) => (
              <ImplementedRecommendationCard key={row.key} row={row} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function InsightsSignalsSkeleton() {
  return (
    <div aria-label="Loading insights" className="grid gap-3" role="status">
      {["primary", "secondary", "tertiary"].map((key) => (
        <div className="space-y-3 rounded-xl border p-6" key={key}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}


export function ImplementedRecommendationCard({ row }: { row: Recommendation }) {
  const implementedLabel =
    row.implemented_at == null ? "Implemented" : `Implemented ${shortDate(row.implemented_at)}`;
  return (
    <article className="space-y-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-muted p-2">
          <Icon name={recommendationIcon(row)} />
        </span>
        <h4>{row.title}</h4>
      </div>
      <p className="text-sm text-muted-foreground">
        {implementedLabel}
        {isPresent(row.note) ? `: ${row.note}` : ""}
      </p>
      {row.detail != null ? <p>{row.detail}</p> : null}
      {row.suggestion != null ? <p>{row.suggestion}</p> : null}
      <PromotionPanel compact row={row} />
    </article>
  );
}

export function implementedTimestamp(row: Recommendation): number {
  const time = Date.parse(row.implemented_at ?? "");
  return Number.isFinite(time) ? time : 0;
}
