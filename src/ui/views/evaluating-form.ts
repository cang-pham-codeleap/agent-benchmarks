import type {
  BenchmarkRunInput,
  EvalCatalog,
  EvalPresetId,
  RealRunInput,
} from "../../eval/types.ts";

export function evaluationRunCount(input: BenchmarkRunInput): number {
  return input.setups.length * input.taskIds.length * input.trials;
}

export function presetAfterEdit(
  preset: EvalPresetId,
  field: "tasks" | "trials" | "setup",
): EvalPresetId {
  return field === "tasks" || field === "trials" ? "custom" : preset;
}

function setupsReason(
  input: BenchmarkRunInput | RealRunInput,
  catalog: EvalCatalog,
  busy: boolean,
): string | null {
  if (busy) return "An operation is in progress.";
  if (catalog.activeRunId) return "An evaluation is already active.";
  if (!catalog.ach.ok) return catalog.ach.problem || "Configure the ach checkout in Settings.";
  if (!input.name.trim()) return "Enter a name for the evaluation.";
  if (!input.setups.length || input.setups.length > catalog.limits.maxSetups)
    return `Choose between 1 and ${catalog.limits.maxSetups} setups.`;
  if (
    input.setups.some(
      (setup) => !catalog.harnesses.some((h) => h.harness === setup.harness && h.installed),
    )
  )
    return "Choose an installed harness for every setup.";
  if (input.setups.some((setup) => !/^[\w.:/@-]{1,128}$/.test(setup.model)))
    return "Enter a valid model for every setup.";
  if (
    new Set(input.setups.map((setup) => JSON.stringify([setup.harness, setup.model, setup.config])))
      .size !== input.setups.length
  )
    return "Each setup must be unique.";
  return null;
}

function limitsReason(input: BenchmarkRunInput | RealRunInput, catalog: EvalCatalog) {
  if (
    !Number.isInteger(input.trials) ||
    input.trials < 1 ||
    input.trials > catalog.limits.maxTrials
  )
    return `Choose between 1 and ${catalog.limits.maxTrials} trials.`;
  if (
    !Number.isSafeInteger(input.wallMs) ||
    input.wallMs <= 0 ||
    input.wallMs > catalog.limits.maxWallMs
  )
    return `Choose a timeout between 0 and ${catalog.limits.maxWallMs / 60000} minutes.`;
  return null;
}

export function realStartReason(
  input: RealRunInput,
  catalog: EvalCatalog,
  busy: boolean,
): string | null {
  const setups = setupsReason(input, catalog, busy);
  if (setups) return setups;
  if (!input.repoPath.startsWith("/")) return "Enter the absolute path of a git repository.";
  if (input.task.type === "replay" && !input.task.sha.trim()) return "Choose a commit to replay.";
  if (!input.task.prompt.trim()) return "Enter a prompt.";
  return limitsReason(input, catalog);
}

export function evaluationStartReason(
  input: BenchmarkRunInput,
  catalog: EvalCatalog,
  busy: boolean,
): string | null {
  const setups = setupsReason(input, catalog, busy);
  if (setups) return setups;
  if (
    !input.taskIds.length ||
    input.taskIds.some((id) => !catalog.tasks.some((task) => task.id === id))
  )
    return "Choose at least one valid task.";
  return limitsReason(input, catalog);
}
