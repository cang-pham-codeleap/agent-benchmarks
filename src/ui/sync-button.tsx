import { Button } from "./components/ui/button.tsx";
import { Icon } from "./icons.tsx";
import { cn } from "./lib/utils.ts";

export interface SyncButtonProps {
  ariaLabel: string;
  busy: boolean;
  label: string;
  labels?: readonly string[];
  onClick: () => void;
  tone?: "primary" | "secondary";
  update?: boolean;
}

export function SyncButton({
  ariaLabel,
  busy,
  label,
  labels = [label],
  onClick,
  tone = "secondary",
  update = false,
}: SyncButtonProps) {
  return (
    <Button
      aria-busy={busy}
      aria-label={ariaLabel}
      className={cn(
        busy && "motion-safe:[&_svg]:animate-spin",
        update && "border-primary/30 bg-accent text-accent-foreground",
      )}
      disabled={busy}
      onClick={onClick}
      type="button"
      variant={tone === "primary" ? "default" : "outline"}
    >
      <Icon name="refresh" />
      <span aria-hidden="true" className="inline-grid justify-items-center" data-sync-label>
        {labels.map((option) => (
          <span
            className="col-start-1 row-start-1 data-[active=false]:invisible"
            data-active={option === label}
            key={option}
          >
            {option}
          </span>
        ))}
      </span>
    </Button>
  );
}
