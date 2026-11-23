import { CircleQuestionMark } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function HelpIcon({ term, help }: { term: string; help: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`What is ${term}?`}
            className="cursor-help font-normal text-muted-foreground hover:text-foreground"
          >
            <CircleQuestionMark className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{help}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function HelpLabel({ label, help }: { label: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <HelpIcon term={label} help={help} />
    </span>
  );
}
