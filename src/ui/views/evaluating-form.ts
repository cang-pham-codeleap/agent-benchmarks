import type {
  AugmentId,
  BenchmarkRunInput,
  EvalAugmentInfo,
  EvalCatalog,
  EvalComboInfo,
  EvalPresetId,
  EvalSetup,
  RealRunInput,
} from "../../eval/types.ts";

export function setupText(setup: EvalSetup): string {
  const { augments } = setup;
  return [
    setup.harness,
    setup.model,
    setup.config,
    ...(augments.length ? [`+${augments.join(" +")}`] : []),
  ].join(" · ");
}

export function evaluationRunCount(input: BenchmarkRunInput): number {
  return input.setups.length * input.taskIds.length * input.trials;
}

const setupIdentity = (setup: EvalSetup) =>
  JSON.stringify([setup.harness, setup.model, setup.config, setup.augments]);

/** Augments the harness has a recipe for; empty unless the config is clean or default. */
export function augmentChoices(
  catalog: EvalCatalog,
  harness: EvalSetup["harness"],
  config: EvalSetup["config"],
): EvalAugmentInfo[] {
  return config === "current" ? [] : catalog.augments.filter((a) => a.harnesses.includes(harness));
}

export function toggleAugment(augments: AugmentId[], id: AugmentId, on: boolean): AugmentId[] {
  const rest = augments.filter((existing) => existing !== id);
  return on ? [...rest, id].sort() : rest;
}

/** A clean baseline plus one setup per available augment, replacing `setups[index]`, within the setup limit. */
export function augmentSweep(
  setups: EvalSetup[],
  index: number,
  catalog: EvalCatalog,
): EvalSetup[] {
  const source = setups[index];
  if (!source) return setups;
  const config = source.config === "default" ? "default" : "clean";
  const base = { harness: source.harness, model: source.model, config } as const;
  const sweep: EvalSetup[] = [
    { ...base, augments: [] },
    ...augmentChoices(catalog, source.harness, config)
      .filter((augment) => augment.available)
      .map((augment) => ({ ...base, augments: [augment.id] })),
  ];
  const others = setups.filter((_, i) => i !== index);
  const seen = new Set(others.map(setupIdentity));
  const fresh = sweep.filter((setup) => !seen.has(setupIdentity(setup)));
  return [
    ...setups.slice(0, index),
    ...fresh.slice(0, Math.max(0, catalog.limits.maxSetups - others.length)),
    ...setups.slice(index + 1),
  ];
}

/** The combo as a custom benchmark input, without what this machine lacks; `dropped` says what was left out. */
export function applyCombo(
  combo: EvalComboInfo,
  catalog: EvalCatalog,
): { input: BenchmarkRunInput; dropped: string[] } {
  const dropped = new Set<string>();
  const seen = new Set<string>();
  const setups = combo.setups.flatMap((setup) => {
    if (!catalog.harnesses.some((h) => h.harness === setup.harness && h.installed)) {
      dropped.add(`Setup ${setupText(setup)}: ${setup.harness} is not installed`);
      return [];
    }
    const augments = setup.augments.filter((id) => {
      const known = catalog.augments.some((augment) => augment.id === id);
      if (!known) dropped.add(`Augment ${id}: not in the catalog`);
      return known;
    });
    const next = { ...setup, augments };
    if (seen.has(setupIdentity(next))) {
      dropped.add(`Setup ${setupText(next)}: duplicate after dropping augments`);
      return [];
    }
    seen.add(setupIdentity(next));
    return [next];
  });
  const taskIds = combo.taskIds.filter((id) => {
    const known = catalog.tasks.some((task) => task.id === id);
    if (!known) dropped.add(`Task ${id}: not in the catalog`);
    return known;
  });
  return {
    input: {
      kind: "benchmark",
      name: combo.label,
      setups,
      taskIds,
      trials: combo.trials,
      wallMs: combo.wallMs,
      preset: "custom",
    },
    dropped: [...dropped],
  };
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
  if (new Set(input.setups.map(setupIdentity)).size !== input.setups.length)
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
