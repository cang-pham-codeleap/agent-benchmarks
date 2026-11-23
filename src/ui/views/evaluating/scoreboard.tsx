import { Fragment, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CellOutcome, SetupSummary } from "../../../eval/types.ts";
import { Badge as ToneBadge, ToolBadge } from "../../badges.tsx";
import { Bar } from "../../common.tsx";
import { durationPrecise, money } from "../../format.ts";
import { harnessTool, OUTCOME_TONE } from "./tones.ts";

export const percent = (value: number | null) =>
  value == null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
export const duration = (value: number | null) =>
  value == null ? "Unavailable" : durationPrecise(value);

export function Help({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cursor-help underline decoration-dotted underline-offset-4"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

interface Metric {
  label: string;
  value: (summary: SetupSummary) => number | null;
  format: (value: number) => string;
  better: "higher" | "lower";
  /** Pass rate is already a share; the others scale to the column's largest value. */
  absolute?: boolean;
}

const METRICS: Metric[] = [
  {
    label: "Pass rate",
    value: (s) => s.passRate,
    format: (v) => `${Math.round(v * 100)}%`,
    better: "higher",
    absolute: true,
  },
  { label: "Spend", value: (s) => s.spendUsd, format: money, better: "lower" },
  { label: "Agent p50", value: (s) => s.agentP50Ms, format: durationPrecise, better: "lower" },
];

/** Setups that differ only in effort share a family; the first one listed is its reference. */
const familyOf = ({ setup }: SetupSummary) =>
  JSON.stringify([setup.harness, setup.model, setup.config, setup.augments]);

/** The value that alone leads its column, or null on a tie or with fewer than two values. */
function leaderOf(metric: Metric, setups: readonly SetupSummary[]): number | null {
  const values = setups.map(metric.value).filter((v): v is number => v != null);
  if (values.length < 2) return null;
  const best = metric.better === "higher" ? Math.max(...values) : Math.min(...values);
  return values.filter((v) => v === best).length === 1 ? best : null;
}

const variantText = ({ setup }: SetupSummary) =>
  [
    setup.effort ?? "default effort",
    ...(setup.config === "current" ? [] : [setup.config]),
    ...setup.augments.map((id) => `+${id}`),
  ].join(" · ");

function SetupName({ summary }: { summary: SetupSummary }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <ToolBadge tool={harnessTool(summary.setup.harness)} />
      <span className="font-medium">{summary.setup.model}</span>
      <span className="rounded border px-1.5 text-xs text-muted-foreground">
        {variantText(summary)}
      </span>
    </span>
  );
}

export function Leaders({ setups }: { setups: readonly SetupSummary[] }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3">
      {METRICS.map((metric) => {
        const best = leaderOf(metric, setups);
        const leader = best == null ? null : setups.find((s) => metric.value(s) === best);
        return (
          <div key={metric.label} className="bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">
              {metric.better === "higher" ? "Highest" : "Lowest"} {metric.label.toLowerCase()}
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {leader && best != null ? metric.format(best) : "Tied"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {leader ? `${leader.setup.model} · ${variantText(leader)}` : "No single setup leads"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Delta({ metric, value, reference }: { metric: Metric; value: number; reference: number }) {
  if (value === reference) return null;
  const worse = metric.better === "higher" ? value < reference : value > reference;
  const ratio = reference > 0 && !metric.absolute ? ` ×${(value / reference).toFixed(1)}` : "";
  return (
    <span
      className={`text-xs tabular-nums ${worse ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
    >
      {value > reference ? "+" : "−"}
      {metric.format(Math.abs(value - reference))}
      {ratio}
    </span>
  );
}

function Details({ summary }: { summary: SetupSummary }) {
  const kReason = summary.kUnavailableReason || "Not enough graded trials.";
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
      <dt className="text-muted-foreground">Pass rate</dt>
      <dd>
        {percent(summary.passRate)}
        {summary.passRateCi &&
          ` · 95% CI ${percent(summary.passRateCi.lo)}–${percent(summary.passRateCi.hi)}, fixed suite of ${summary.eligibleTasks} tasks`}
      </dd>
      <dt className="text-muted-foreground">Graded / planned</dt>
      <dd>
        {summary.graded}/{summary.planned}
      </dd>
      <dt className="text-muted-foreground">pass@k</dt>
      <dd>
        {summary.passAtK == null ? (
          <Help text={kReason}>Unavailable</Help>
        ) : (
          `${percent(summary.passAtK)} (k=${summary.k})`
        )}
      </dd>
      <dt className="text-muted-foreground">pass^k</dt>
      <dd>
        {summary.passHatK == null ? (
          <Help text={kReason}>Unavailable</Help>
        ) : (
          `${percent(summary.passHatK)} (k=${summary.k})`
        )}
      </dd>
      <dt className="text-muted-foreground">Spend</dt>
      <dd>
        {summary.spendUsd == null
          ? summary.priced.priced
            ? `Priced subtotal ${money(summary.pricedSubtotalUsd)}, ${summary.priced.priced}/${summary.priced.total} cells`
            : `Unavailable, 0/${summary.priced.total} cells priced`
          : money(summary.spendUsd)}
      </dd>
      <dt className="text-muted-foreground">Cost / solved</dt>
      <dd>
        {summary.costPerSolvedUsd == null
          ? summary.passed === 0 && summary.graded > 0
            ? "No solved tasks"
            : "Unavailable"
          : money(summary.costPerSolvedUsd)}
      </dd>
      <dt className="text-muted-foreground">Agent p50 / p95</dt>
      <dd>
        {duration(summary.agentP50Ms)} / {duration(summary.agentP95Ms)}
      </dd>
      <dt className="text-muted-foreground">Time / solved</dt>
      <dd>{duration(summary.timePerSolvedMs)}</dd>
    </dl>
  );
}

export function Scoreboard({ setups }: { setups: readonly SetupSummary[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const columns = METRICS.map((metric) => {
    const values = setups.map(metric.value).filter((v): v is number => v != null);
    return { metric, leader: leaderOf(metric, setups), max: Math.max(0, ...values) };
  });
  const references = new Map<string, SetupSummary>();
  for (const summary of setups) {
    if (!references.has(familyOf(summary))) references.set(familyOf(summary), summary);
  }
  return (
    <section
      className="overflow-x-auto rounded-md border"
      aria-label="Evaluation summary"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable scroll container so keyboard users can scroll the table
      tabIndex={0}
    >
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Setup</th>
            {METRICS.map((metric) => (
              <th key={metric.label} className="w-[19%] px-3 py-2 font-medium">
                {metric.label}
              </th>
            ))}
            <th className="px-3 py-2 font-medium">Outcomes</th>
          </tr>
        </thead>
        <tbody>
          {setups.map((summary) => {
            const reference = references.get(familyOf(summary));
            const expanded = open === summary.setupKey;
            return (
              <Fragment key={summary.setupKey}>
                <tr className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`Details for ${summary.setup.model} ${variantText(summary)}`}
                      className="flex items-center gap-2 text-left"
                      onClick={() => setOpen(expanded ? null : summary.setupKey)}
                    >
                      <span className="text-muted-foreground">{expanded ? "▾" : "▸"}</span>
                      <SetupName summary={summary} />
                    </button>
                  </td>
                  {columns.map(({ metric, leader, max }) => {
                    const value = metric.value(summary);
                    if (value == null)
                      return (
                        <td key={metric.label} className="px-3 py-2 text-muted-foreground">
                          —
                        </td>
                      );
                    const leads = value === leader;
                    const base =
                      reference === summary ? null : reference && metric.value(reference);
                    return (
                      <td key={metric.label} className="px-3 py-2">
                        <span className="grid grid-cols-[1fr_auto] items-center gap-2">
                          <Bar
                            fraction={metric.absolute ? value : max > 0 ? value / max : 0}
                            tone={leads ? "success" : "accent"}
                          />
                          <span
                            className={`tabular-nums ${leads ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""}`}
                          >
                            {metric.format(value)}
                          </span>
                        </span>
                        {base != null && <Delta metric={metric} value={value} reference={base} />}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {Object.entries(summary.outcomes)
                        .filter(([, count]) => count > 0)
                        .map(([outcome, count]) => (
                          <ToneBadge key={outcome} tone={OUTCOME_TONE[outcome as CellOutcome]}>
                            {outcome} {count}
                          </ToneBadge>
                        ))}
                    </span>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b bg-muted/30 last:border-0">
                    <td colSpan={METRICS.length + 2} className="px-3 py-3">
                      <Details summary={summary} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const WIDTH = 720;
const HEIGHT = 360;
const PAD = { left: 64, right: 24, top: 20, bottom: 44 };
const TIME_TICKS = [5e3, 10e3, 30e3, 60e3, 180e3, 600e3, 1800e3, 3600e3];
const SPEND_TICKS = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10];

function logScale(values: number[], from: number, to: number) {
  const logs = values.map(Math.log10);
  const lo = Math.min(...logs) - 0.15;
  const hi = Math.max(...logs) + 0.15;
  return {
    at: (v: number) => from + ((Math.log10(v) - lo) / (hi - lo)) * (to - from),
    holds: (v: number) => Math.log10(v) >= lo && Math.log10(v) <= hi,
  };
}

const passFill = (rate: number | null) =>
  rate == null
    ? "fill-muted-foreground"
    : rate === 1
      ? "fill-emerald-500"
      : rate === 0
        ? "fill-red-500"
        : "fill-amber-500";

export function CostTimeScatter({ setups }: { setups: readonly SetupSummary[] }) {
  const points = setups.filter(
    (s): s is SetupSummary & { spendUsd: number; agentP50Ms: number } =>
      s.spendUsd != null && s.spendUsd > 0 && s.agentP50Ms != null && s.agentP50Ms > 0,
  );
  const missing = setups.filter((s) => !points.includes(s as (typeof points)[number]));
  if (points.length === 0)
    return (
      <p className="text-sm text-muted-foreground">No setup has both a spend and an agent time.</p>
    );
  const x = logScale(
    points.map((p) => p.agentP50Ms),
    PAD.left,
    WIDTH - PAD.right,
  );
  const y = logScale(
    points.map((p) => p.spendUsd),
    HEIGHT - PAD.bottom,
    PAD.top,
  );
  const families = Map.groupBy(points, (p) => familyOf(p));
  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full max-w-4xl text-[11px]"
        role="img"
        aria-label="Spend against agent p50 time per setup"
      >
        <defs>
          <marker
            id="effort-arrow"
            viewBox="0 0 10 10"
            refX="16"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0L10 5L0 10z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {TIME_TICKS.filter(x.holds).map((t) => (
          <g key={t}>
            <line
              x1={x.at(t)}
              x2={x.at(t)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              className="stroke-border"
            />
            <text
              x={x.at(t)}
              y={HEIGHT - PAD.bottom + 16}
              textAnchor="middle"
              className="fill-muted-foreground"
            >
              {durationPrecise(t)}
            </text>
          </g>
        ))}
        {SPEND_TICKS.filter(y.holds).map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y.at(t)}
              y2={y.at(t)}
              className="stroke-border"
            />
            <text
              x={PAD.left - 8}
              y={y.at(t) + 4}
              textAnchor="end"
              className="fill-muted-foreground"
            >
              {money(t)}
            </text>
          </g>
        ))}
        <text
          x={(PAD.left + WIDTH - PAD.right) / 2}
          y={HEIGHT - 6}
          textAnchor="middle"
          className="fill-muted-foreground"
        >
          Agent p50, log scale
        </text>
        <text
          x={14}
          y={HEIGHT / 2}
          transform={`rotate(-90 14 ${HEIGHT / 2})`}
          textAnchor="middle"
          className="fill-muted-foreground"
        >
          Spend, log scale
        </text>
        {[...families.values()].flatMap((family) =>
          family
            .slice(1)
            .map((p, i) => (
              <line
                key={p.setupKey}
                x1={x.at(family[i]!.agentP50Ms)}
                y1={y.at(family[i]!.spendUsd)}
                x2={x.at(p.agentP50Ms)}
                y2={y.at(p.spendUsd)}
                strokeDasharray="4 3"
                markerEnd="url(#effort-arrow)"
                className="stroke-muted-foreground"
              />
            )),
        )}
        {points.map((p) => {
          const cx = x.at(p.agentP50Ms);
          const cy = y.at(p.spendUsd);
          const right = cx > WIDTH * 0.65;
          return (
            <g key={p.setupKey}>
              <circle cx={cx} cy={cy} r={6} className={`${passFill(p.passRate)} stroke-card`}>
                <title>
                  {`${p.setup.harness} ${p.setup.model} · ${variantText(p)}: ${percent(p.passRate)} pass, ${money(p.spendUsd)}, ${durationPrecise(p.agentP50Ms)}`}
                </title>
              </circle>
              <text
                x={cx + (right ? -10 : 10)}
                y={cy + (families.get(familyOf(p))?.[0] === p ? 16 : -9)}
                textAnchor={right ? "end" : "start"}
                className="fill-foreground"
              >
                {p.setup.model.split("/").pop()} · {p.setup.effort ?? "default"}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        Lower left is cheaper and faster. Green passed every graded trial, red none. Arrows join
        efforts of one model.
        {missing.length > 0 &&
          ` Not plotted, no spend or time: ${missing.map((s) => `${s.setup.model} · ${variantText(s)}`).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
