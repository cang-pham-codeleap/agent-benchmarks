import { Check, ChevronsUpDown, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { effortLevels } from "../../../eval/efforts.ts";
import {
  type BenchmarkRunInput,
  EVAL_DIFFICULTIES,
  type EvalCatalog,
  type EvalComboInfo,
  type EvalDifficulty,
  type EvalHarnessInfo,
  type EvalSetup,
} from "../../../eval/types.ts";
import { ApiError, getJson } from "../../api.ts";
import {
  applyCombo,
  augmentChoices,
  augmentSweep,
  evaluationRunCount,
  evaluationStartReason,
  presetAfterEdit,
  setupText,
  toggleAugment,
} from "../evaluating-form.ts";

const COMBO_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function ComboRow({
  combos,
  onLoad,
}: {
  combos: EvalComboInfo[];
  onLoad: (combo: EvalComboInfo) => void;
}) {
  if (combos.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">Combos</h3>
        <p className="text-sm text-muted-foreground">
          Saved comparisons. Loading one replaces the setups, tasks, trials, and timeout.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {combos.map((combo) => (
          <button
            key={combo.id}
            type="button"
            onClick={() => onLoad(combo)}
            aria-describedby={combo.problem ? `combo-${combo.id}-problem` : undefined}
            className="flex flex-col gap-1 rounded-md border p-3 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="font-medium">{combo.label}</span>
            <span className="text-muted-foreground">
              {combo.setups.length} setups · {combo.taskIds.length} tasks × {combo.trials}{" "}
              {combo.trials === 1 ? "trial" : "trials"}
            </span>
            {combo.setups.map((setup) => (
              <span key={setupText(setup)} className="text-xs text-muted-foreground">
                {setupText(setup)}
              </span>
            ))}
            {combo.problem && (
              <span
                id={`combo-${combo.id}-problem`}
                className="flex items-start gap-1 text-destructive"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {combo.problem}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

function SaveComboDialog({
  input,
  evalDir,
  disabled,
  onSaved,
}: {
  input: BenchmarkRunInput;
  evalDir: string;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [exists, setExists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const idValid = COMBO_ID.test(id);
  async function save(overwrite: boolean) {
    setSaving(true);
    setError(null);
    try {
      const { setups, taskIds, trials, wallMs } = input;
      await getJson<EvalComboInfo>("/api/evals/combos", {
        method: "POST",
        body: JSON.stringify({ id, label, setups, taskIds, trials, wallMs, overwrite }),
      });
      setOpen(false);
      onSaved();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "combo_exists") setExists(true);
      else setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setLabel(input.name);
        setExists(false);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          Save as combo…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as combo</DialogTitle>
          <DialogDescription>
            Saves the setups, tasks, trials, and timeout to {evalDir}/combos/{id || "<id>"}.json.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <label className="grid gap-2 text-sm font-medium">
            Id
            <Input
              value={id}
              aria-invalid={id !== "" && !idValid}
              aria-describedby="combo-id-help"
              onChange={(event) => {
                setId(event.target.value);
                setExists(false);
              }}
            />
            <span
              id="combo-id-help"
              className={`text-xs font-normal ${id !== "" && !idValid ? "text-destructive" : "text-muted-foreground"}`}
            >
              1–64 lowercase letters, digits, or hyphens, starting with a letter or digit.
            </span>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Label
            <Input
              value={label}
              maxLength={120}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          {exists && (
            <Alert>
              <TriangleAlert />
              <AlertTitle>A combo named {id} already exists.</AlertTitle>
              <AlertDescription>Overwrite it with the current form?</AlertDescription>
            </Alert>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            {exists ? (
              <Button
                type="button"
                variant="destructive"
                disabled={saving}
                onClick={() => void save(true)}
              >
                Overwrite
              </Button>
            ) : (
              <Button type="submit" disabled={saving || !idValid || label.trim() === ""}>
                Save
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ValuePicker({
  options,
  value,
  onChange,
  label,
  placeholder,
  describedBy,
}: {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          aria-describedby={describedBy}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            aria-label={placeholder}
            placeholder={placeholder}
            value={search}
            onValueChange={setSearch}
            onKeyDown={(event) => {
              if (event.key === "Enter" && search.trim() && !options.includes(search.trim())) {
                event.preventDefault();
                pick(search.trim());
              }
            }}
          />
          <CommandList>
            {options
              .filter((option) => option.toLowerCase().includes(search.toLowerCase()))
              .map((option) => (
                <CommandItem key={option} value={option} onSelect={() => pick(option)}>
                  <Check
                    className={`mr-2 size-4 ${value === option ? "opacity-100" : "opacity-0"}`}
                  />
                  {option}
                </CommandItem>
              ))}
            {search.trim() && !options.includes(search.trim()) && (
              <CommandItem value={search.trim()} onSelect={() => pick(search.trim())}>
                Use “{search.trim()}”
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const DEFAULT_EFFORT = "default";

/** The setup's effort, or none when the harness and model take no such level. */
export function keptEffort(harness: string, model: string, effort: string | undefined) {
  return effort && effortLevels(harness, model).includes(effort) ? effort : undefined;
}

export function EffortPicker({
  harness,
  model,
  value,
  onChange,
  label,
  className,
}: {
  harness: string;
  model: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  label: string;
  className?: string;
}) {
  const levels = effortLevels(harness, model);
  return (
    <Select
      value={value ?? DEFAULT_EFFORT}
      disabled={levels.length === 0}
      onValueChange={(next) => onChange(next === DEFAULT_EFFORT ? undefined : next)}
    >
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_EFFORT}>Default</SelectItem>
        {levels.map((level) => (
          <SelectItem key={level} value={level}>
            {level}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EvalForm({
  catalog,
  input,
  onChange,
  onStart,
  onCombosChange,
  busy,
}: {
  catalog: EvalCatalog;
  input: BenchmarkRunInput;
  onChange: (input: BenchmarkRunInput) => void;
  onStart: () => void;
  onCombosChange: () => void;
  busy: boolean;
}) {
  const [dropped, setDropped] = useState<string[]>([]);
  // The timeout input is uncontrolled; remounting it shows a loaded combo's value.
  const [loads, setLoads] = useState(0);
  const installed = catalog.harnesses.filter((harness) => harness.installed);
  const reason = evaluationStartReason(input, catalog, busy);
  const categories = [...new Set(catalog.tasks.map((task) => task.category))].sort();
  function updateSetup(index: number, patch: Partial<EvalSetup>) {
    onChange({
      ...input,
      setups: input.setups.map((setup, i) => (i === index ? { ...setup, ...patch } : setup)),
    });
  }
  function updateTasks(taskIds: string[]) {
    onChange({ ...input, taskIds, preset: presetAfterEdit(input.preset, "tasks") });
  }
  function loadCombo(combo: EvalComboInfo) {
    const loaded = applyCombo(combo, catalog);
    onChange(loaded.input);
    setDropped(loaded.dropped);
    setLoads((value) => value + 1);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>New evaluation</CardTitle>
        <CardDescription>
          Choose the same tasks and trials for each setup. Runs execute sequentially.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <label className="grid max-w-md gap-2 text-sm font-medium">
          Name
          <Input
            value={input.name}
            onChange={(event) => onChange({ ...input, name: event.target.value })}
          />
        </label>
        <ComboRow combos={catalog.combos} onLoad={loadCombo} />
        {dropped.length > 0 && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>Left out of the loaded combo</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {dropped.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <section className="space-y-3">
          <div>
            <h3 className="font-semibold">Setups</h3>
            <p className="text-sm text-muted-foreground">
              Compare an installed harness, model, and effort for each setup.
            </p>
          </div>
          {input.setups.map((setup, index) => {
            const info = catalog.harnesses.find((harness) => harness.harness === setup.harness);
            const choices = augmentChoices(catalog, setup.harness, setup.config);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: setups have no id and are edited by position
                key={index}
                className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_minmax(0,1fr)_auto]"
              >
                <label className="grid gap-2 text-sm">
                  <span className="flex h-5 items-center gap-2">
                    Harness
                    {info && !info.metered && (
                      <Badge variant="secondary" className="py-0">
                        unmetered
                      </Badge>
                    )}
                  </span>
                  <Select
                    value={setup.harness}
                    onValueChange={(harness) =>
                      updateSetup(index, {
                        harness: harness as EvalSetup["harness"],
                        model: "",
                        config:
                          setup.config === "clean" &&
                          installed.find((next) => next.harness === harness)?.cleanConfigProblem !=
                            null
                            ? "current"
                            : setup.config,
                        augments: [],
                        effort: undefined,
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-full min-w-0"
                      aria-label={`Harness for setup ${index + 1}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {installed.map((harness) => (
                        <SelectItem key={harness.harness} value={harness.harness}>
                          {harness.label}
                          {harness.version ? ` (${harness.version})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <div className="grid gap-2 text-sm">
                  <span>Model</span>
                  <ValuePicker
                    options={info?.knownModels ?? []}
                    label={`Model for setup ${index + 1}`}
                    placeholder="Choose or enter a model"
                    value={setup.model}
                    onChange={(model) =>
                      updateSetup(index, {
                        model,
                        effort: keptEffort(setup.harness, model, setup.effort),
                      })
                    }
                  />
                </div>
                <div className="grid gap-2 text-sm">
                  <span>Effort</span>
                  <EffortPicker
                    harness={setup.harness}
                    model={setup.model}
                    value={setup.effort}
                    onChange={(effort) => updateSetup(index, { effort })}
                    label={`Effort for setup ${index + 1}`}
                    className="w-full"
                  />
                </div>
                <label className="grid gap-2 text-sm">
                  Configuration
                  <Select
                    value={setup.config}
                    onValueChange={(config) =>
                      updateSetup(index, {
                        config: config as EvalSetup["config"],
                        augments: config === "current" ? [] : setup.augments,
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={`Configuration for setup ${index + 1}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">Current (your own configuration)</SelectItem>
                      <SelectItem value="default" disabled={info?.defaultConfigProblem != null}>
                        Default (no user configuration)
                      </SelectItem>
                      <SelectItem value="clean" disabled={info?.cleanConfigProblem != null}>
                        Clean (your login, no plugins or hooks)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove setup ${index + 1}`}
                  onClick={() =>
                    onChange({ ...input, setups: input.setups.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 />
                </Button>
                {choices.length > 0 && (
                  <fieldset className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-2">
                    <legend className="sr-only">Augments for setup {index + 1}</legend>
                    {choices.map((augment) => {
                      const id = `augment-${index}-${augment.id}`;
                      return (
                        <label
                          key={augment.id}
                          htmlFor={id}
                          className={`flex items-center gap-2 text-sm ${augment.available ? "" : "opacity-50"}`}
                        >
                          <Checkbox
                            id={id}
                            checked={setup.augments.includes(augment.id)}
                            disabled={!augment.available}
                            aria-describedby={augment.problem ? `${id}-problem` : undefined}
                            onCheckedChange={(checked) =>
                              updateSetup(index, {
                                augments: toggleAugment(
                                  setup.augments,
                                  augment.id,
                                  checked === true,
                                ),
                              })
                            }
                          />
                          {augment.label}
                          {augment.source === "user" && <Badge variant="outline">user</Badge>}
                          {augment.problem && (
                            <span id={`${id}-problem`} className="sr-only">
                              {augment.problem}
                            </span>
                          )}
                          {!augment.available && augment.sourceUrl && (
                            <a
                              href={augment.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={augment.problem ?? undefined}
                              className="underline"
                            >
                              Install
                            </a>
                          )}
                        </label>
                      );
                    })}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onChange({ ...input, setups: augmentSweep(input.setups, index, catalog) })
                      }
                    >
                      Sweep augments
                    </Button>
                  </fieldset>
                )}
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            disabled={!installed.length || input.setups.length >= catalog.limits.maxSetups}
            onClick={() =>
              onChange({
                ...input,
                setups: [
                  ...input.setups,
                  { harness: installed[0]!.harness, model: "", config: "current", augments: [] },
                ],
              })
            }
          >
            <Plus /> Add setup
          </Button>
          {!installed.length && (
            <p className="text-sm text-muted-foreground">No supported harnesses are installed.</p>
          )}
        </section>
        <fieldset className="space-y-3">
          <legend className="font-semibold">Preset</legend>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {catalog.presets.map((preset) => (
              <label
                key={preset.id}
                className={`flex cursor-pointer gap-3 rounded-md border p-3 ${input.preset === preset.id ? "border-primary bg-accent" : ""}`}
              >
                <input
                  className="mt-1 accent-primary"
                  type="radio"
                  name="eval-preset"
                  value={preset.id}
                  checked={input.preset === preset.id}
                  onChange={() =>
                    onChange({
                      ...input,
                      preset: preset.id,
                      taskIds: [...preset.taskIds],
                      trials: preset.trials,
                    })
                  }
                />
                <span>
                  <span className="block font-medium">{preset.label}</span>
                  <span className="block text-sm text-muted-foreground">
                    {preset.taskIds.length} tasks × {preset.trials}{" "}
                    {preset.trials === 1 ? "trial" : "trials"}
                  </span>
                  <span className="mt-1 block text-sm">{preset.claim}</span>
                </span>
              </label>
            ))}
            <label
              className={`flex cursor-pointer gap-3 rounded-md border p-3 ${input.preset === "custom" ? "border-primary bg-accent" : ""}`}
            >
              <input
                className="mt-1 accent-primary"
                type="radio"
                name="eval-preset"
                value="custom"
                checked={input.preset === "custom"}
                onChange={() => onChange({ ...input, preset: "custom" })}
              />
              <span>
                <span className="block font-medium">Custom</span>
                <span className="block text-sm text-muted-foreground">
                  Choose tasks and trials.
                </span>
              </span>
            </label>
          </div>
          <p className="text-sm text-muted-foreground">
            A broad decision preset needs more tasks than this catalog currently contains.
          </p>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="font-semibold">Tasks</legend>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {categories.map((category) => {
              const tasks = catalog.tasks
                .filter((task) => task.category === category)
                .sort(
                  (a, b) =>
                    EVAL_DIFFICULTIES.indexOf(a.difficulty as EvalDifficulty) -
                    EVAL_DIFFICULTIES.indexOf(b.difficulty as EvalDifficulty),
                );
              const selected = tasks.filter((task) => input.taskIds.includes(task.id)).length;
              return (
                <div key={category} className="space-y-2 rounded-md border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={
                        selected === tasks.length ? true : selected ? "indeterminate" : false
                      }
                      onCheckedChange={(checked) =>
                        updateTasks(
                          checked === true
                            ? [...new Set([...input.taskIds, ...tasks.map((task) => task.id)])]
                            : input.taskIds.filter((id) => !tasks.some((task) => task.id === id)),
                        )
                      }
                    />
                    {category}{" "}
                    <span className="text-muted-foreground">
                      ({selected}/{tasks.length})
                    </span>
                  </label>
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <label key={task.id} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          className="mt-0.5"
                          checked={input.taskIds.includes(task.id)}
                          onCheckedChange={(checked) =>
                            updateTasks(
                              checked === true
                                ? [...input.taskIds, task.id]
                                : input.taskIds.filter((id) => id !== task.id),
                            )
                          }
                        />
                        <span>
                          <span className="block font-medium">
                            {task.id}
                            {task.difficulty && (
                              <Badge variant="outline" className="ml-2 font-normal">
                                {task.difficulty}
                              </Badge>
                            )}
                          </span>
                          <span className="block text-muted-foreground">{task.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <label className="grid gap-2 text-sm font-medium">
            Trials
            <Input
              className="w-32"
              type="number"
              min="1"
              max={catalog.limits.maxTrials}
              step="1"
              value={input.trials || ""}
              onChange={(event) =>
                onChange({
                  ...input,
                  trials: Number(event.target.value),
                  preset: presetAfterEdit(input.preset, "trials"),
                })
              }
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Timeout per cell (minutes)
            <Input
              key={loads}
              className="w-44"
              type="number"
              min="0"
              max={catalog.limits.maxWallMs / 60000}
              step="any"
              defaultValue={input.wallMs / 60000}
              onChange={(event) =>
                onChange({ ...input, wallMs: Math.round(Number(event.target.value) * 60000) })
              }
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
          <div>
            <p className="font-medium">
              {input.setups.length} setups × {input.taskIds.length} tasks × {input.trials || 0}{" "}
              trials = {evaluationRunCount(input)} runs
            </p>
            <p className="text-sm text-muted-foreground">Estimated cost: unknown</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveComboDialog
              input={input}
              evalDir={catalog.evalDir}
              disabled={busy || input.setups.length === 0}
              onSaved={onCombosChange}
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={reason ? 0 : undefined}>
                    <Button type="button" disabled={reason != null} onClick={onStart}>
                      Start evaluation
                    </Button>
                  </span>
                </TooltipTrigger>
                {reason && <TooltipContent>{reason}</TooltipContent>}
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        {reason && (
          <p className="text-sm text-muted-foreground" role="status">
            {reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
