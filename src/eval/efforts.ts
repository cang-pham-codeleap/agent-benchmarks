import { COPILOT_FUSION_MODEL } from "../sources/copilot.ts";
import type { EvalHarness, EvalSetup } from "./types.ts";

/** The levels each CLI's own effort flag accepts; which ones a model supports is the CLI's call. */
const EFFORT_LEVELS: Record<EvalHarness, readonly string[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["none", "minimal", "low", "medium", "high", "xhigh"],
  copilot: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
  opencode: ["minimal", "low", "medium", "high", "xhigh", "max"],
  omp: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  droid: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
};

/** Copilot Fusion picks its models itself; its effort is the Fusion tier. */
const COPILOT_FUSION_TIERS = ["standard", "high", "max"] as const;

export function effortLevels(harness: string, model: string): readonly string[] {
  if (harness === "copilot" && model === COPILOT_FUSION_MODEL) return COPILOT_FUSION_TIERS;
  return EFFORT_LEVELS[harness as EvalHarness] ?? [];
}

/** The model ach runs and labels cells with: `<model>#<effort>`, the form OpenCode takes natively. */
export function achModel(setup: Pick<EvalSetup, "model" | "effort">): string {
  return setup.effort ? `${setup.model}#${setup.effort}` : setup.model;
}
