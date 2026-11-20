import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
import type { EvalCatalog, EvalHarnessInfo, EvalRunInput, EvalSetup } from "../../../eval/types.ts";
import { evaluationRunCount, evaluationStartReason, presetAfterEdit } from "../evaluating-form.ts";

function ModelPicker({
  info,
  model,
  onChange,
  index,
}: {
  info: EvalHarnessInfo | undefined;
  model: string;
  onChange: (model: string) => void;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pick = (value: string) => {
    onChange(value);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setSearch(model);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`Model for setup ${index + 1}`}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{model || "Choose or enter a model"}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Search or enter a model"
            placeholder="Search or enter a model"
            value={search}
            onValueChange={setSearch}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                search.trim() &&
                !info?.knownModels.includes(search.trim())
              ) {
                event.preventDefault();
                pick(search.trim());
              }
            }}
          />
          <CommandList>
            {info?.knownModels
              .filter((option) => option.toLowerCase().includes(search.toLowerCase()))
              .map((option) => (
                <CommandItem key={option} value={option} onSelect={() => pick(option)}>
                  <Check
                    className={`mr-2 size-4 ${model === option ? "opacity-100" : "opacity-0"}`}
                  />
                  {option}
                </CommandItem>
              ))}
            {search.trim() && !info?.knownModels.includes(search.trim()) && (
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

export function EvalForm({
  catalog,
  input,
  onChange,
  onStart,
  busy,
}: {
  catalog: EvalCatalog;
  input: EvalRunInput;
  onChange: (input: EvalRunInput) => void;
  onStart: () => void;
  busy: boolean;
}) {
  const installed = catalog.harnesses.filter((harness) => harness.installed);
  const reason = evaluationStartReason(input, catalog, busy);
  const languages = [...new Set(catalog.tasks.map((task) => task.language))].sort();
  function updateSetup(index: number, patch: Partial<EvalSetup>) {
    onChange({
      ...input,
      setups: input.setups.map((setup, i) => (i === index ? { ...setup, ...patch } : setup)),
    });
  }
  function updateTasks(taskIds: string[]) {
    onChange({ ...input, taskIds, preset: presetAfterEdit(input.preset, "tasks") });
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
        <section className="space-y-3">
          <div>
            <h3 className="font-semibold">Setups</h3>
            <p className="text-sm text-muted-foreground">
              Compare an installed harness and model for each setup.
            </p>
          </div>
          {input.setups.map((setup, index) => {
            const info = catalog.harnesses.find((harness) => harness.harness === setup.harness);
            return (
              <div key={index} className="flex flex-wrap items-end gap-3 rounded-md border p-3">
                <label className="grid min-w-48 flex-1 gap-2 text-sm">
                  Harness
                  <Select
                    value={setup.harness}
                    onValueChange={(harness) =>
                      updateSetup(index, { harness: harness as EvalSetup["harness"], model: "" })
                    }
                  >
                    <SelectTrigger aria-label={`Harness for setup ${index + 1}`}>
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
                <div className="grid min-w-48 flex-1 gap-2 text-sm">
                  <span>Model</span>
                  <ModelPicker
                    index={index}
                    info={info}
                    model={setup.model}
                    onChange={(model) => updateSetup(index, { model })}
                  />
                </div>
                <div className="flex items-center gap-2 pb-1">
                  {info?.version && (
                    <span className="text-xs text-muted-foreground">{info.version}</span>
                  )}
                  {info && !info.metered && <Badge variant="secondary">unmetered</Badge>}
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
                </div>
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
                setups: [...input.setups, { harness: installed[0]!.harness, model: "" }],
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
            {languages.map((language) => {
              const tasks = catalog.tasks.filter((task) => task.language === language);
              const selected = tasks.filter((task) => input.taskIds.includes(task.id)).length;
              return (
                <div key={language} className="space-y-2 rounded-md border p-3">
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
                    {language}{" "}
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
                          <span className="block font-medium">{task.id}</span>
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
        {reason && (
          <p className="text-sm text-muted-foreground" role="status">
            {reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
