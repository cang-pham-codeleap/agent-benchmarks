import type { CellOutcome, EvalHarness, EvalRunStatus } from "../../../eval/types.ts";
import type { BadgeTone } from "../../types.ts";

export const OUTCOME_TONE: Record<CellOutcome, BadgeTone> = {
  passed: "success",
  "verify-failed": "danger",
  timeout: "warning",
  "budget-stop": "warning",
  "agent-error": "danger",
  "setup-error": "danger",
  "verifier-error": "danger",
  "provider-limit": "warning",
  unavailable: "neutral",
  pending: "neutral",
};

export const RUN_STATUS_TONE: Record<EvalRunStatus, BadgeTone> = {
  running: "info",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
  "cancel-incomplete": "warning",
  interrupted: "warning",
};

export const harnessTool = (harness: EvalHarness): string =>
  harness === "claude" ? "claude_code" : harness;
