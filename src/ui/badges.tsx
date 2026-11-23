import type { ReactNode } from "react";
import type { Tool } from "../model.ts";
import { badgeVariants } from "./components/ui/badge.tsx";
import { effortDisplayLabel, effortTooltip } from "./effort.ts";
import { capitalize, formatInt } from "./format.ts";
import { BrandMark } from "./icons.tsx";
import { cn } from "./lib/utils.ts";
import { stripMarkupTags } from "./session-title.ts";
import type { BadgeTone, BrandIconName } from "./types.ts";

export function Badge({
  children,
  className,
  mono = false,
  title,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  mono?: boolean;
  title?: string;
  tone?: BadgeTone;
}) {
  const toneClasses: Record<BadgeTone, string> = {
    neutral: "",
    accent:
      "border-violet-500/30 bg-violet-500/10 [&>svg]:text-violet-600 dark:[&>svg]:text-violet-400",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
    claude:
      "border-orange-500/30 bg-orange-500/10 [&>svg]:text-orange-600 dark:[&>svg]:text-orange-400",
    openai: "border-teal-500/30 bg-teal-500/10 [&>svg]:text-teal-600 dark:[&>svg]:text-teal-400",
    gemini: "border-blue-500/30 bg-blue-500/10 [&>svg]:text-blue-600 dark:[&>svg]:text-blue-400",
    opencode: "border-zinc-500/30 bg-zinc-500/10 [&>svg]:text-zinc-700 dark:[&>svg]:text-zinc-300",
    zai: "border-indigo-500/30 bg-indigo-500/10 [&>svg]:text-indigo-600 dark:[&>svg]:text-indigo-400",
    meta: "border-sky-500/30 bg-sky-500/10 [&>svg]:text-sky-600 dark:[&>svg]:text-sky-400",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  };

  return (
    <span
      className={cn(
        badgeVariants({ variant: "outline" }),
        "gap-1 font-normal",
        mono && "font-mono",
        toneClasses[tone],
        className,
      )}
      data-slot="badge"
      title={title}
    >
      {children}
    </span>
  );
}

const TOOL_LABELS: Record<Tool, string> = {
  claude_code: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  cursor: "Cursor",
  copilot: "Copilot",
  vscode_copilot: "Copilot Chat",
  atif: "ATIF",
  hermes: "Hermes",
  pi: "Pi",
  omp: "Oh My Pi",
  droid: "Droid",
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool as Tool] ?? tool;
}

export function ToolBadge({ tool }: { tool: string | null | undefined }) {
  if (tool === "claude_code") {
    return (
      <Badge tone="claude">
        <BrandMark name="claude" />
        {toolLabel(tool)}
      </Badge>
    );
  }
  if (tool === "codex") {
    return (
      <Badge tone="openai">
        <BrandMark name="openai" />
        {toolLabel(tool)}
      </Badge>
    );
  }
  if (tool === "gemini") {
    return (
      <Badge tone="gemini">
        <BrandMark name="gemini" />
        {toolLabel(tool)}
      </Badge>
    );
  }
  if (tool === "opencode") {
    return (
      <Badge tone="opencode">
        <BrandMark name="opencode" />
        {toolLabel(tool)}
      </Badge>
    );
  }
  if (tool === "cursor") {
    return (
      <Badge tone="accent">
        <BrandMark name="cursor" />
        {toolLabel(tool)}
      </Badge>
    );
  }
  if (tool === "copilot") {
    return (
      <Badge tone="accent">
        <BrandMark name="copilot" />
        {toolLabel(tool)}
      </Badge>
    );
  }
  if (tool === "vscode_copilot") {
    return (
      <Badge tone="accent">
        <BrandMark name="copilot" />
        {toolLabel(tool)}
      </Badge>
    );
  }
  if (tool === "atif") {
    return <Badge tone="info">{toolLabel(tool)}</Badge>;
  }
  // No brand mark: Agent Benchmarks ships only marks published under an open license.
  if (tool === "hermes" || tool === "pi" || tool === "omp" || tool === "droid") {
    return <Badge tone="accent">{toolLabel(tool)}</Badge>;
  }
  return <Badge>{tool ?? "-"}</Badge>;
}

export function ModelBadge({ model }: { model: string | null | undefined }) {
  const label = displayModelLabel(model);
  if (label == null) {
    return <span className="text-muted-foreground">-</span>;
  }
  const tone = brandTone(label);
  const theme = modelTheme(label);
  const icon = theme == null ? modelBrandIcon(label, tone) : null;
  return (
    <Badge
      mono
      title={model?.trim() ?? label}
      tone={tone}
      className={
        theme == null
          ? undefined
          : {
              astra: "border-chart-4/30 text-chart-4",
              sol: "border-chart-1/30 text-chart-1",
              luna: "border-chart-3/30 text-chart-3",
            }[theme]
      }
    >
      {icon == null ? null : <BrandMark name={icon} />}
      <span className="min-w-0 truncate">{label}</span>
    </Badge>
  );
}

export type ModelTheme = "astra" | "sol" | "luna";

export function modelTheme(model: string): ModelTheme | null {
  const tier = /(?:^|[/:])gpt-(?:5\.6|6(?:\.1)?)-(astra|sol|luna)$/i.exec(model)?.[1];
  return tier == null ? null : (tier.toLowerCase() as ModelTheme);
}

export function EffortBadge({
  effort,
  labeled = false,
  levels = [],
}: {
  effort: string | null | undefined;
  labeled?: boolean;
  levels?: string[];
}) {
  const label = effort?.trim().toLowerCase();
  const displayLabel = effortDisplayLabel(effort, labeled);
  if (label == null || label === "") {
    return (
      <span className="text-muted-foreground" title={effortTooltip(effort, levels)}>
        {displayLabel}
      </span>
    );
  }
  return (
    <Badge
      mono
      title={effortTooltip(effort, levels) ?? effortDisplayLabel(effort)}
      tone={label === "mixed" ? "warning" : "info"}
    >
      {displayLabel}
    </Badge>
  );
}

export function ThinkingBadge({ tokens, source }: { tokens: number; source: string | null }) {
  const observed =
    source === "inferred"
      ? `Reasoning estimated from output: ~${formatInt(tokens)} tokens`
      : `Extended thinking observed: ${formatInt(tokens)} reported reasoning tokens`;
  return (
    <Badge
      mono
      title={`${observed}. This source does not record a discrete effort level.`}
      tone="info"
    >
      thinking on
    </Badge>
  );
}

export function ReasoningBadge({
  effort,
  levels,
  totalReasoningTokens,
  reasoningSource,
  labeled = false,
}: {
  effort: string | null | undefined;
  levels: string[];
  totalReasoningTokens: number;
  reasoningSource: string | null;
  labeled?: boolean;
}) {
  if ((effort ?? "").trim() === "" && totalReasoningTokens > 0) {
    return <ThinkingBadge tokens={totalReasoningTokens} source={reasoningSource} />;
  }
  return <EffortBadge effort={effort} labeled={labeled} levels={levels} />;
}

export function displayModelLabel(model: string | null | undefined): string | null {
  if (model == null) {
    return null;
  }
  const trimmed = model.trim();
  if (trimmed === "") {
    return null;
  }
  const tagOnly = trimmed.match(/^<([a-z][a-z0-9_-]*)>$/i);
  if (tagOnly != null) {
    return capitalize((tagOnly[1] ?? "").replace(/[-_]+/g, " "));
  }
  const stripped = stripMarkupTags(trimmed);
  return stripped === "" ? null : stripped;
}

export function modelBrandIcon(model: string, tone: BadgeTone): BrandIconName | null {
  if (tone === "openai") {
    return "openai";
  }
  if (tone === "claude") {
    return model.toLowerCase().includes("anthropic") && !model.toLowerCase().includes("claude")
      ? "anthropic"
      : "claude";
  }
  if (tone === "gemini") {
    return "gemini";
  }
  if (tone === "zai") {
    return "zai";
  }
  if (tone === "meta") {
    return "meta";
  }
  return null;
}

export function brandTone(model: string | null | undefined): BadgeTone {
  const normalized = (model ?? "").toLowerCase();
  if (
    normalized.includes("claude") ||
    normalized.includes("anthropic") ||
    normalized.includes("opus") ||
    normalized.includes("sonnet") ||
    normalized.includes("haiku")
  ) {
    return "claude";
  }
  if (
    normalized.includes("gpt") ||
    normalized.includes("openai") ||
    normalized.includes("codex") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3")
  ) {
    return "openai";
  }
  if (normalized.includes("gemini") || normalized.includes("gemma")) {
    return "gemini";
  }
  if (/(?:^|\/)glm-/.test(normalized)) {
    return "zai";
  }
  if (/(?:^|\/)muse-/.test(normalized)) {
    return "meta";
  }
  return "neutral";
}

export function toneName(tone: string | null | undefined): BadgeTone {
  return tone === "success" ||
    tone === "warning" ||
    tone === "danger" ||
    tone === "info" ||
    tone === "accent"
    ? tone
    : "neutral";
}

export function providerIdentity(tool: string): {
  key: "assistant" | "claude" | "openai" | "gemini" | "opencode";
  label: string;
  tone: BadgeTone;
  icon: BrandIconName | null;
} {
  if (tool === "claude_code") {
    return { key: "claude", label: "Claude", tone: "claude", icon: "claude" };
  }
  if (tool === "codex") {
    return { key: "openai", label: "Codex", tone: "openai", icon: "openai" };
  }
  if (tool === "gemini") {
    return { key: "gemini", label: "Gemini", tone: "gemini", icon: "gemini" };
  }
  if (tool === "opencode") {
    return { key: "opencode", label: "OpenCode", tone: "opencode", icon: "opencode" };
  }
  if (tool === "cursor") {
    return { key: "assistant", label: "Cursor", tone: "accent", icon: "cursor" };
  }
  if (tool === "copilot") {
    return { key: "assistant", label: "Copilot", tone: "accent", icon: "copilot" };
  }
  if (tool === "vscode_copilot") {
    return { key: "assistant", label: "Copilot Chat", tone: "accent", icon: "copilot" };
  }
  if (tool === "atif") {
    return { key: "assistant", label: "Agent", tone: "info", icon: null };
  }
  if (tool === "hermes") {
    return { key: "assistant", label: "Hermes", tone: "accent", icon: null };
  }
  if (tool === "pi") {
    return { key: "assistant", label: "Pi", tone: "accent", icon: null };
  }
  if (tool === "omp" || tool === "droid") {
    return { key: "assistant", label: toolLabel(tool), tone: "accent", icon: null };
  }
  return { key: "assistant", label: "Assistant", tone: "accent", icon: null };
}
