import {
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useId,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ALL_DATE_RANGE,
  applyDatePreset,
  checkCustomRange,
  dateRangeLabel,
  dateRangePresetLabel,
  RANGE_PRESETS,
  REVERSED_RANGE_MESSAGE,
  refreshTodayRange,
  scheduleUtcDayRollover,
} from "./date-range.ts";
import { Icon } from "./icons.tsx";
import type { DateBounds, DateRangeSelection, RangePreset } from "./types.ts";

// Safari doesn't focus a clicked button, and clicking a field label blurs before
// the label hands focus to its input, so both blur with no relatedTarget.
// Closing on that hid the popover mid-click, which dropped Safari preset
// presses and crashed Chromium on label clicks; outside presses close it instead.
export function focusLeftMenu(menu: Pick<Node, "contains">, next: EventTarget | null): boolean {
  return next != null && "nodeType" in next && !menu.contains(next as Node);
}

export function useTodayRollover(
  todaySelected: boolean,
  setRange: Dispatch<SetStateAction<DateRangeSelection>>,
) {
  useEffect(() => {
    if (!todaySelected) {
      return;
    }
    const refresh = () => setRange((range) => refreshTodayRange(range));
    // Background tabs throttle timers, so a tab shown again re-checks the date.
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    const stop = scheduleUtcDayRollover(refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [todaySelected, setRange]);
}

// A date input reports a partly typed date as bad input with an empty value.
function dateInputValue(event: ChangeEvent<HTMLInputElement>): string | null {
  return event.target.validity.badInput ? null : event.target.value;
}

export function DateRangeControl({
  bounds,
  range,
  onChange,
}: {
  bounds: DateBounds | null;
  range: DateRangeSelection;
  onChange: (range: DateRangeSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from: string | null; to: string | null } | null>(null);
  const errorId = useId();
  const bounded = range.from != null && range.to != null;
  const fields = draft ?? { from: range.from ?? "", to: range.to ?? "" };
  const check = checkCustomRange(fields.from, fields.to);
  const reversed = check.status === "reversed";
  const editCustomRange = (next: { from: string | null; to: string | null }) => {
    const result = checkCustomRange(next.from, next.to);
    if (result.status === "valid") {
      setDraft(null);
      onChange(result.range);
    } else {
      setDraft(next);
    }
  };

  const choosePreset = (value: Exclude<RangePreset, "custom">) => {
    setDraft(null);
    if (value === "all") {
      onChange(ALL_DATE_RANGE);
      setOpen(false);
      return;
    }
    onChange(applyDatePreset(value, bounds));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setDraft(null); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label={`Time range: ${dateRangePresetLabel(range)}`}>
          <Icon name="clock" />
          <span>{dateRangePresetLabel(range)}</span>
          <Icon name="chevronDown" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
            <fieldset className="grid gap-1">
              <legend className="sr-only">Time range presets</legend>
              <Button variant="ghost" className="justify-between" size="sm"
                aria-pressed={range.preset === "all"}
                onClick={() => choosePreset("all")}
                type="button"
              >
                <span>All time</span>
                {range.preset === "all" ? <Icon name="check" /> : null}
              </Button>
              {RANGE_PRESETS.map((preset) => (
                <Button variant="ghost" className="justify-between" size="sm"
                  aria-pressed={range.preset === preset.key}
                  key={preset.key}
                  onClick={() => choosePreset(preset.key)}
                  type="button"
                >
                  <span>{preset.label}</span>
                  {range.preset === preset.key ? <Icon name="check" /> : null}
                </Button>
              ))}
            </fieldset>
            <div className="space-y-2 border-t pt-4">
              <div className="flex justify-between text-sm font-medium">
                <span>Custom range</span>
                {range.preset === "custom" && bounded ? (
                  <small>{dateRangeLabel(range)}</small>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-sm">
                  <span>From</span>
                  <Input
                    aria-describedby={reversed ? errorId : undefined}
                    aria-invalid={
                      reversed || (check.status === "incomplete" && check.field === "from")
                    }
                    aria-label="From date"
                    max={fields.to || undefined}
                    onChange={(event) =>
                      editCustomRange({ ...fields, from: dateInputValue(event) })
                    }
                    type="date"
                    value={fields.from ?? ""}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>To</span>
                  <Input
                    aria-describedby={reversed ? errorId : undefined}
                    aria-invalid={
                      reversed || (check.status === "incomplete" && check.field === "to")
                    }
                    aria-label="To date"
                    min={fields.from || undefined}
                    onChange={(event) => editCustomRange({ ...fields, to: dateInputValue(event) })}
                    type="date"
                    value={fields.to ?? ""}
                  />
                </label>
              </div>
              <div aria-live="polite">
                {reversed ? (
                  <p className="text-sm text-destructive" id={errorId}>
                    {REVERSED_RANGE_MESSAGE}
                  </p>
                ) : null}
              </div>
            </div>
      </PopoverContent>
    </Popover>
  );
}
