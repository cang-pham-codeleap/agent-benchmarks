import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { clampNumber, costDisplay } from "./format.ts";
import { Icon } from "./icons.tsx";
import { cn } from "./lib/utils.ts";
import type { BadgeTone, IconName } from "./types.ts";
export function PrivacyReviewLists({
  className,
  excluded,
  excludedLabel,
  included,
  includedLabel,
}: {
  className: string;
  excluded: readonly string[];
  excludedLabel: string;
  included: readonly string[];
  includedLabel: string;
}) {
  return (
    <div className={className}>
      <div>
        <h3>{includedLabel}</h3>
        <ul>
          {included.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3>{excludedLabel}</h3>
        <ul>
          {excluded.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export type TooltipTriggerProps = {
  ref: (node: HTMLElement | null) => void;
  onBlur: () => void;
  onFocus: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  tabIndex: number;
  "aria-describedby"?: string;
};

export function Tooltip({
  children,
  content,
}: {
  children: (props: TooltipTriggerProps) => ReactNode;
  content: ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openTooltip = () => {
    clearCloseTimer();
    setOpen(true);
  };

  const closeTooltip = () => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => setOpen(false), 80);
  };

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger == null) {
      return;
    }
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltipRef.current?.getBoundingClientRect();
    const width = tooltipRect?.width ?? 320;
    const height = tooltipRect?.height ?? 44;
    const padding = 12;
    const maxLeft = Math.max(padding, window.innerWidth - width - padding);
    const left = clampNumber(
      triggerRect.left + triggerRect.width / 2 - width / 2,
      padding,
      maxLeft,
    );
    let top = triggerRect.top - height - 8;
    if (top < padding) {
      top = triggerRect.bottom + 8;
    }
    top = clampNumber(top, padding, Math.max(padding, window.innerHeight - height - padding));
    setPosition((current) =>
      current != null && current.left === left && current.top === top ? current : { left, top },
    );
  }, []);

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const onScrollOrResize = () => updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (triggerRef.current?.contains(target) === true || tooltipRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, updatePosition]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    [clearCloseTimer],
  );

  const triggerProps: TooltipTriggerProps = {
    ref: (node) => {
      triggerRef.current = node;
    },
    onBlur: closeTooltip,
    onFocus: openTooltip,
    onKeyDown: (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    },
    onMouseEnter: openTooltip,
    onMouseLeave: closeTooltip,
    tabIndex: 0,
    "aria-describedby": open ? id : undefined,
  };

  return (
    <>
      {children(triggerProps)}
      {open
        ? createPortal(
            <div
              className="fixed z-[1000] w-max max-w-[min(28rem,calc(100vw-24px))] rounded-md border bg-popover px-2.5 py-2 text-xs leading-normal text-popover-foreground shadow-lg"
              id={id}
              onMouseEnter={openTooltip}
              onMouseLeave={closeTooltip}
              ref={tooltipRef}
              role="tooltip"
              style={
                position == null
                  ? { left: 0, top: 0, visibility: "hidden" }
                  : { left: position.left, top: position.top }
              }
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function Sparkline({ tone = "accent", values }: { tone?: BadgeTone; values: number[] }) {
  const points = sparkPoints(values);
  if (points == null) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  return (
    <svg
      aria-hidden="true"
      className={cn(
        "h-6 w-28",
        {
          neutral: "text-muted-foreground",
          accent: "text-primary",
          success: "text-emerald-500",
          warning: "text-amber-500",
          danger: "text-destructive",
          info: "text-chart-3",
          claude: "text-chart-1",
          openai: "text-muted-foreground",
          gemini: "text-chart-3",
          opencode: "text-chart-5",
          zai: "text-chart-2",
          meta: "text-chart-4",
        }[tone],
      )}
      preserveAspectRatio="none"
      viewBox="0 0 100 24"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function sparkPoints(values: number[]): string | null {
  const cleanValues = values.map((value) => Math.max(0, value));
  if (cleanValues.length < 2) {
    return null;
  }
  const max = Math.max(1, ...cleanValues);
  return cleanValues
    .map((value, index) => {
      const x = (index / (cleanValues.length - 1)) * 100;
      const y = 23 - (value / max) * 22;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function CostValue({
  cost,
  dense = false,
  sessions,
  usageSessions,
}: {
  cost: number;
  dense?: boolean;
  sessions: number;
  usageSessions: number;
}) {
  const { text, title } = costDisplay(cost, sessions, usageSessions, dense);
  return (
    <span
      className={sessions > 0 && usageSessions === 0 ? "text-muted-foreground" : undefined}
      title={title}
    >
      {text}
    </span>
  );
}

export function StatCard({
  alert = false,
  detail,
  detailTitle,
  icon,
  label,
  loading = false,
  updating = false,
  value,
  valueTitle,
}: {
  alert?: boolean;
  detail?: string | null;
  detailTitle?: string;
  icon: IconName;
  label: string;
  loading?: boolean;
  updating?: boolean;
  value: string;
  valueTitle?: string;
}) {
  return (
    <div
      aria-busy={loading || updating ? true : undefined}
      className="flex min-w-0 items-start justify-between gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow-sm [&>div]:grid [&>div]:gap-1"
      data-alert={alert ? "true" : undefined}
      data-slot="card"
      data-updating={updating ? "true" : undefined}
    >
      <div>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {loading ? (
          <strong>
            <i
              aria-label="Loading"
              className="inline-block h-6 w-20 animate-pulse rounded-md bg-accent"
              role="img"
            />
          </strong>
        ) : (
          <strong className="text-xl font-semibold tracking-tight" title={valueTitle}>
            {value}
          </strong>
        )}
        {detail != null && !loading ? (
          <small className="text-xs text-muted-foreground" title={detailTitle}>
            {detail}
          </small>
        ) : null}
      </div>
      <span className="text-muted-foreground [&_svg]:size-4">
        <Icon name={icon} />
      </span>
    </div>
  );
}

export function EmptyState({
  action,
  icon,
  message,
  title,
}: {
  action?: ReactNode;
  icon: IconName;
  message: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 p-8 text-center text-card-foreground",
      )}
      data-slot="card"
    >
      <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name={icon} />
      </span>
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm">{message}</p>
      {action != null ? <div className="mt-4 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  action,
  detail,
  icon = "info",
  secondaryAction,
  title,
}: {
  action?: ReactNode;
  detail: string;
  icon?: IconName;
  secondaryAction?: ReactNode;
  title: string;
}) {
  return (
    <div
      className={cn(
        "relative grid w-full grid-cols-[auto_1fr] items-start gap-3 rounded-lg border border-destructive/50 bg-card p-4 text-card-foreground shadow-xs",
      )}
      data-slot="alert"
      role="alert"
    >
      <span className="text-destructive mt-0.5">
        <Icon name={icon} />
      </span>
      <div>
        <h3 className="font-medium tracking-tight text-destructive">{title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{detail}</p>
        {action != null || secondaryAction != null ? (
          <div className="mt-3 flex items-center gap-2">
            {action}
            {secondaryAction}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Bar({ fraction, tone }: { fraction: number; tone: BadgeTone }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 100;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <span
        className={cn(
          "block h-full rounded-full",
          {
            neutral: "bg-primary",
            accent: "bg-primary",
            success: "bg-emerald-500",
            warning: "bg-amber-500",
            danger: "bg-destructive",
            info: "bg-chart-3",
            claude: "bg-chart-1",
            openai: "bg-primary",
            gemini: "bg-chart-3",
            opencode: "bg-chart-5",
            zai: "bg-chart-2",
            meta: "bg-chart-4",
          }[tone],
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function OverflowMenu({ children, label }: { children: ReactNode; label: string }) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  return (
    <details
      className="relative inline-block"
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          event.currentTarget.open = false;
        }
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("a, button") != null &&
          menuRef.current != null
        ) {
          menuRef.current.open = false;
          menuRef.current.querySelector("summary")?.focus();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        if (menuRef.current != null) {
          menuRef.current.open = false;
          menuRef.current.querySelector("summary")?.focus();
        }
      }}
      ref={menuRef}
    >
      <summary
        aria-label={label}
        className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent [&_svg]:size-4"
        title="More actions"
      >
        <Icon name="ellipsis" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        {children}
      </div>
    </details>
  );
}
