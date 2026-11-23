import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cellBranch } from "../../../eval/cell-branch.ts";
import type {
  AugmentId,
  EvalCatalog,
  EvalHarness,
  EvalSetup,
  RealRunInput,
  RealSetup,
  RepoInspection,
} from "../../../eval/types.ts";
import { getJson } from "../../api.ts";
import {
  augmentChoices,
  augmentSweep,
  realStartReason,
  toggleAugment,
} from "../evaluating-form.ts";
import { EffortPicker, keptEffort, ValuePicker } from "./form.tsx";

interface Combo {
  id: number;
  harness: EvalHarness;
  model: string;
  current: boolean;
  default: boolean;
  clean: boolean;
  augments: AugmentId[];
  effort?: string;
  /** Empty means the row's placeholder prefix. */
  branchPrefix: string;
}

let nextComboId = 0;

/** Augments ride on the default and clean setups only; `current` already carries the user's own configuration. */
function comboSetups(combo: Combo): EvalSetup[] {
  const { harness, model, augments, effort } = combo;
  const base = { harness, model, ...(effort ? { effort } : {}) };
  return [
    ...(combo.current ? [{ ...base, config: "current" as const, augments: [] }] : []),
    ...(combo.default ? [{ ...base, config: "default" as const, augments }] : []),
    ...(combo.clean ? [{ ...base, config: "clean" as const, augments }] : []),
  ];
}

const textareaClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const PREVIEW_BRANCHES = 4;

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs font-normal text-muted-foreground">
      {children}
    </p>
  );
}

function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function RealTaskForm({
  catalog,
  busy,
  onStart,
}: {
  catalog: EvalCatalog;
  busy: boolean;
  onStart: (input: RealRunInput) => Promise<void>;
}) {
  const installed = catalog.harnesses.filter((harness) => harness.installed);
  const uid = useId();
  const fieldId = (field: string) => `${uid}-${field}`;
  const hintId = (field: string) => `${uid}-${field}-hint`;
  const [stamp] = useState(() => timestamp(new Date()));
  const [name, setName] = useState(`Real task ${new Date().toLocaleDateString()}`);
  const [repoPath, setRepoPath] = useState("");
  const [repo, setRepo] = useState<RepoInspection | null>(null);
  const [type, setType] = useState<"prompt" | "replay">("prompt");
  const [baseRef, setBaseRef] = useState("HEAD");
  const [sha, setSha] = useState("");
  const [prompt, setPrompt] = useState("");
  const [hiddenPaths, setHiddenPaths] = useState<string[]>([]);
  const [setupCommand, setSetupCommand] = useState("");
  const [checks, setChecks] = useState("");
  const [hiddenTestCommand, setHiddenTestCommand] = useState("");
  const [combos, setCombos] = useState<Combo[]>(() =>
    installed[0]
      ? [
          {
            id: nextComboId++,
            harness: installed[0].harness,
            model: "",
            current: true,
            default: false,
            clean: false,
            augments: [],
            branchPrefix: "",
          },
        ]
      : [],
  );
  const [trials, setTrials] = useState(1);
  const [wallMs, setWallMs] = useState(catalog.limits.realDefaultWallMs);
  const [error, setError] = useState<string | null>(null);

  async function inspect(path: string, commit: string | null) {
    if (!path.trim()) return;
    setError(null);
    try {
      const query = new URLSearchParams({ path: path.trim() });
      if (commit) query.set("sha", commit);
      const next = await getJson<RepoInspection>(`/api/evals/repo?${query}`);
      if (next.path !== repo?.path) {
        setBaseRef(next.branch ?? next.head);
        setSetupCommand(next.profile.setupCommand ?? "");
        setChecks(next.profile.checks.join("\n"));
        setHiddenTestCommand(next.profile.hiddenTestCommand ?? "");
      }
      if (next.commit) {
        setSha(next.commit.sha);
        setPrompt([next.commit.subject, next.commit.body].filter(Boolean).join("\n\n").trim());
        setHiddenPaths(next.commit.suggestedHidden);
      }
      setRepo(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function pickRepo() {
    setError(null);
    try {
      const { path } = await getJson<{ path: string | null }>("/api/evals/repo/pick", {
        method: "POST",
        body: JSON.stringify(repoPath.trim().startsWith("/") ? { startPath: repoPath.trim() } : {}),
      });
      if (path == null) return;
      setRepoPath(path);
      await inspect(path, type === "replay" && sha.trim() ? sha.trim() : null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  const prefixOf = (combo: Combo, index: number) =>
    combo.branchPrefix.trim() || `eval/${stamp}/${combo.harness}-${index + 1}`;
  const setups: RealSetup[] = combos.flatMap((combo, index) =>
    comboSetups(combo).map((setup) => ({ ...setup, branchPrefix: prefixOf(combo, index) })),
  );
  const input: RealRunInput = {
    kind: "real",
    name,
    setups,
    trials,
    wallMs,
    repoPath: repoPath.trim(),
    task:
      type === "prompt"
        ? { type, prompt, baseRef: baseRef.trim() || "HEAD" }
        : { type, sha: sha.trim(), prompt, hiddenPaths },
    profile: {
      setupCommand: setupCommand.trim() || null,
      checks: checks
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      hiddenTestCommand: hiddenTestCommand.trim() || null,
    },
  };
  const reason = realStartReason(input, catalog, busy);
  const commit = type === "replay" && repo?.commit?.sha === sha ? repo.commit : null;
  const updateCombo = (index: number, patch: Partial<Combo>) =>
    setCombos(combos.map((combo, i) => (i === index ? { ...combo, ...patch } : combo)));
  function sweep(index: number) {
    const combo = combos[index];
    if (!combo) return;
    const others = combos.flatMap((other, i) => (i === index ? [] : comboSetups(other)));
    const source: EvalSetup = {
      harness: combo.harness,
      model: combo.model,
      config: combo.default ? "default" : "clean",
      augments: [],
      ...(combo.effort ? { effort: combo.effort } : {}),
    };
    const fresh = augmentSweep([...others, source], others.length, catalog).slice(others.length);
    setCombos([
      ...combos.slice(0, index),
      ...fresh.map((setup) => ({
        id: nextComboId++,
        harness: setup.harness,
        model: setup.model,
        current: false,
        default: setup.config === "default",
        clean: setup.config === "clean",
        augments: setup.augments,
        effort: setup.effort,
        branchPrefix: "",
      })),
      ...combos.slice(index + 1),
    ]);
  }

  async function start() {
    setError(null);
    try {
      await onStart(input);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New real-task evaluation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-4">
          <div className="grid min-w-64 flex-1 content-start gap-2 text-sm font-medium">
            <label htmlFor={fieldId("name")}>Name</label>
            <Input
              id={fieldId("name")}
              aria-describedby={hintId("name")}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Hint id={hintId("name")}>Shown in the run list and the report.</Hint>
          </div>
          <div className="grid min-w-64 flex-[2] content-start gap-2 text-sm font-medium">
            <label htmlFor={fieldId("repo")}>Repository</label>
            <div className="flex gap-2">
              <Input
                id={fieldId("repo")}
                aria-describedby={hintId("repo")}
                value={repoPath}
                placeholder="/absolute/path/to/repo"
                onChange={(event) => setRepoPath(event.target.value)}
                onBlur={() => void inspect(repoPath, null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void inspect(repoPath, null);
                }}
              />
              {catalog.canPickFolder && (
                <Button type="button" variant="outline" onClick={() => void pickRepo()}>
                  <FolderOpen /> Choose…
                </Button>
              )}
            </div>
            <Hint id={hintId("repo")}>
              The git repository the agents work on. Each run uses a private clone, so your
              uncommitted changes are left out and your checkout is never touched.
            </Hint>
          </div>
        </div>
        {repo?.dirty && (
          <Alert>
            <AlertDescription>
              The repository has uncommitted changes; they are not included in the run.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-2 text-sm font-medium">
          <span id="real-task-type">Task type</span>
          <ToggleGroup
            type="single"
            variant="outline"
            aria-labelledby="real-task-type"
            aria-describedby={hintId("type")}
            value={type}
            onValueChange={(value) => value && setType(value as "prompt" | "replay")}
          >
            <ToggleGroupItem value="prompt">Prompt</ToggleGroupItem>
            <ToggleGroupItem value="replay">Replay commit</ToggleGroupItem>
          </ToggleGroup>
          <Hint id={hintId("type")}>
            Prompt: the agents do a task you describe. Replay commit: the agents redo a commit from
            the history, starting at its parent, and its tests grade them.
          </Hint>
        </div>
        {type === "prompt" ? (
          <div className="grid max-w-md gap-2 text-sm font-medium">
            <span aria-hidden="true">Base ref</span>
            <ValuePicker
              options={repo?.branches ?? []}
              label="Base ref"
              placeholder={repo ? "Choose a branch or enter a ref" : "Choose a repository first"}
              describedBy={hintId("base")}
              value={baseRef}
              onChange={setBaseRef}
            />
            <Hint id={hintId("base")}>
              The branch, tag, or commit the agents start from. The list shows the repository's
              branches, newest first.
            </Hint>
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-4">
              <div className="grid min-w-64 flex-[2] gap-2 text-sm font-medium">
                <span aria-hidden="true">Recent commit</span>
                <Select
                  value={repo?.recentCommits.some((item) => item.sha === sha) ? sha : ""}
                  onValueChange={(value) => {
                    setSha(value);
                    void inspect(repoPath, value);
                  }}
                  disabled={!repo}
                >
                  <SelectTrigger aria-label="Recent commit" aria-describedby={hintId("commit")}>
                    <SelectValue placeholder="Choose a commit" />
                  </SelectTrigger>
                  <SelectContent>
                    {repo?.recentCommits.map((item) => (
                      <SelectItem key={item.sha} value={item.sha}>
                        {item.sha.slice(0, 8)} {item.subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid min-w-48 flex-1 gap-2 text-sm font-medium">
                <label htmlFor={fieldId("sha")}>Commit SHA</label>
                <Input
                  id={fieldId("sha")}
                  aria-describedby={hintId("commit")}
                  value={sha}
                  onChange={(event) => setSha(event.target.value)}
                  onBlur={() => sha.trim() && void inspect(repoPath, sha.trim())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && sha.trim()) void inspect(repoPath, sha.trim());
                  }}
                />
              </div>
            </div>
            <Hint id={hintId("commit")}>
              The commit to redo: pick a recent one or paste any SHA. The agents never see it.
            </Hint>
          </div>
        )}
        <div className="grid gap-2 text-sm font-medium">
          <label htmlFor={fieldId("prompt")}>Prompt</label>
          <textarea
            id={fieldId("prompt")}
            aria-describedby={hintId("prompt")}
            className={textareaClass}
            rows={6}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Hint id={hintId("prompt")}>
            {type === "prompt"
              ? "What every agent is asked to do, as you would write it in a chat."
              : "Filled from the commit message. Reword it like an issue so it states the problem without giving away the fix."}
          </Hint>
        </div>
        {commit && commit.files.length > 0 && (
          <fieldset className="space-y-2" aria-describedby={hintId("hidden")}>
            <legend className="text-sm font-medium">Hidden paths</legend>
            <Hint id={hintId("hidden")}>
              Files from the commit kept away from the agents and restored only for grading, usually
              its tests.
            </Hint>
            {commit.files.map((file) => (
              <label
                key={file}
                htmlFor={fieldId(`hidden-${file}`)}
                className="flex items-center gap-2 font-mono text-sm"
              >
                <Checkbox
                  id={fieldId(`hidden-${file}`)}
                  checked={hiddenPaths.includes(file)}
                  onCheckedChange={(checked) =>
                    setHiddenPaths(
                      checked === true
                        ? [...hiddenPaths, file]
                        : hiddenPaths.filter((path) => path !== file),
                    )
                  }
                />
                {file}
              </label>
            ))}
          </fieldset>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid content-start gap-2 text-sm font-medium">
            <label htmlFor={fieldId("setup")}>Setup command</label>
            <Input
              id={fieldId("setup")}
              aria-describedby={hintId("setup")}
              value={setupCommand}
              placeholder="bun install"
              onChange={(event) => setSetupCommand(event.target.value)}
            />
            <Hint id={hintId("setup")}>
              Runs in each agent's checkout before the agent starts, such as installing
              dependencies. Leave empty when nothing needs preparing.
            </Hint>
          </div>
          {type === "replay" && (
            <div className="grid content-start gap-2 text-sm font-medium">
              <label htmlFor={fieldId("hidden-test")}>Hidden-test command</label>
              <Input
                id={fieldId("hidden-test")}
                aria-describedby={hintId("hidden-test")}
                value={hiddenTestCommand}
                placeholder="bun test {file}"
                onChange={(event) => setHiddenTestCommand(event.target.value)}
              />
              <Hint id={hintId("hidden-test")}>
                Runs once per hidden test file after the agent finishes; {"{file}"} becomes the
                file's path. A passing run counts as solved.
              </Hint>
            </div>
          )}
          <div className="grid gap-2 text-sm font-medium md:col-span-2">
            <label htmlFor={fieldId("checks")}>Checks</label>
            <textarea
              id={fieldId("checks")}
              aria-describedby={hintId("checks")}
              className={textareaClass}
              rows={3}
              value={checks}
              placeholder={"bun test\nbunx tsc --noEmit"}
              onChange={(event) => setChecks(event.target.value)}
            />
            <Hint id={hintId("checks")}>
              One command per line, run in the agent's checkout after it finishes. Exit code 0
              passes. The repository's setup, checks, and hidden-test command are remembered for
              next time.
            </Hint>
          </div>
        </div>
        <fieldset className="space-y-3" aria-describedby={hintId("harness")}>
          <legend className="font-semibold">Harness and model</legend>
          <Hint id={hintId("harness")}>
            Each row runs one harness and model once per checked configuration. Current
            configuration is the harness as you use it daily; default drops your instructions,
            skills, tool servers, and settings.
          </Hint>
          <TooltipProvider>
            {combos.map((combo, index) => {
              const info = catalog.harnesses.find((harness) => harness.harness === combo.harness);
              const problem = info?.defaultConfigProblem ?? null;
              const cleanProblem = info?.cleanConfigProblem ?? null;
              const choices = augmentChoices(
                catalog,
                combo.harness,
                combo.default ? "default" : combo.clean ? "clean" : "current",
              );
              return (
                <div
                  key={combo.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                >
                  <Select
                    value={combo.harness}
                    onValueChange={(harness) =>
                      updateCombo(index, {
                        harness: harness as EvalHarness,
                        model: "",
                        default: false,
                        clean:
                          combo.clean &&
                          installed.find((next) => next.harness === harness)?.cleanConfigProblem ==
                            null,
                        augments: [],
                        effort: undefined,
                      })
                    }
                  >
                    <SelectTrigger className="w-48" aria-label={`Harness for row ${index + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {installed.map((harness) => (
                        <SelectItem key={harness.harness} value={harness.harness}>
                          {harness.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="min-w-48 flex-1">
                    <ValuePicker
                      options={info?.knownModels ?? []}
                      label={`Model for row ${index + 1}`}
                      placeholder="Choose or enter a model"
                      value={combo.model}
                      onChange={(model) =>
                        updateCombo(index, {
                          model,
                          effort: keptEffort(combo.harness, model, combo.effort),
                        })
                      }
                    />
                  </div>
                  <EffortPicker
                    harness={combo.harness}
                    model={combo.model}
                    value={combo.effort}
                    onChange={(effort) => updateCombo(index, { effort })}
                    label={`Effort for row ${index + 1}`}
                    className="w-36"
                  />
                  <label
                    htmlFor={fieldId(`current-${combo.id}`)}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={fieldId(`current-${combo.id}`)}
                      checked={combo.current}
                      onCheckedChange={(checked) =>
                        updateCombo(index, { current: checked === true })
                      }
                    />
                    current configuration
                  </label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label
                        htmlFor={fieldId(`default-${combo.id}`)}
                        className={`flex items-center gap-2 text-sm ${problem ? "opacity-50" : ""}`}
                        tabIndex={problem ? 0 : undefined}
                      >
                        <Checkbox
                          id={fieldId(`default-${combo.id}`)}
                          checked={combo.default}
                          disabled={problem != null}
                          onCheckedChange={(checked) =>
                            updateCombo(index, { default: checked === true })
                          }
                        />
                        default
                      </label>
                    </TooltipTrigger>
                    {problem && <TooltipContent>{problem}</TooltipContent>}
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label
                        htmlFor={fieldId(`clean-${combo.id}`)}
                        className={`flex items-center gap-2 text-sm ${cleanProblem ? "opacity-50" : ""}`}
                        tabIndex={cleanProblem ? 0 : undefined}
                      >
                        <Checkbox
                          id={fieldId(`clean-${combo.id}`)}
                          checked={combo.clean}
                          disabled={cleanProblem != null}
                          onCheckedChange={(checked) =>
                            updateCombo(index, { clean: checked === true })
                          }
                        />
                        Clean (your login, no plugins or hooks)
                      </label>
                    </TooltipTrigger>
                    {cleanProblem && <TooltipContent>{cleanProblem}</TooltipContent>}
                  </Tooltip>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove row ${index + 1}`}
                    onClick={() => setCombos(combos.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </Button>
                  <div className="grid basis-full gap-1 text-sm">
                    <label htmlFor={fieldId(`branch-${combo.id}`)} className="font-medium">
                      Worktree branch
                    </label>
                    <Input
                      id={fieldId(`branch-${combo.id}`)}
                      aria-describedby={hintId(`branch-${combo.id}`)}
                      className="max-w-md font-mono"
                      value={combo.branchPrefix}
                      placeholder={prefixOf({ ...combo, branchPrefix: "" }, index)}
                      onChange={(event) => updateCombo(index, { branchPrefix: event.target.value })}
                    />
                    <Hint id={hintId(`branch-${combo.id}`)}>
                      {(() => {
                        const branches = comboSetups(combo).flatMap((setup) =>
                          Array.from({ length: Math.max(trials, 1) }, (_, trial) =>
                            cellBranch(prefixOf(combo, index), setup, trial + 1),
                          ),
                        );
                        if (branches.length === 0)
                          return "Check a configuration to see its branches.";
                        const extra = branches.length - PREVIEW_BRANCHES;
                        return (
                          <>
                            Each run's changes land in your repository as{" "}
                            {branches.slice(0, PREVIEW_BRANCHES).map((branch, i) => (
                              <span key={branch}>
                                {i > 0 && ", "}
                                <code className="font-mono text-foreground">{branch}</code>
                              </span>
                            ))}
                            {extra > 0 && ` and ${extra} more`}. Check one out, or run{" "}
                            <code className="font-mono">git worktree add</code> on it, to inspect
                            the work.
                          </>
                        );
                      })()}
                    </Hint>
                  </div>
                  {choices.length > 0 && (
                    <fieldset className="flex basis-full flex-wrap items-center gap-x-4 gap-y-2">
                      <legend className="sr-only">Augments for row {index + 1}</legend>
                      {choices.map((augment) => {
                        const id = fieldId(`augment-${combo.id}-${augment.id}`);
                        return (
                          <label
                            key={augment.id}
                            htmlFor={id}
                            className={`flex items-center gap-2 text-sm ${augment.available ? "" : "opacity-50"}`}
                          >
                            <Checkbox
                              id={id}
                              checked={combo.augments.includes(augment.id)}
                              disabled={!augment.available}
                              aria-describedby={augment.problem ? `${id}-problem` : undefined}
                              onCheckedChange={(checked) =>
                                updateCombo(index, {
                                  augments: toggleAugment(
                                    combo.augments,
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
                        onClick={() => sweep(index)}
                      >
                        Sweep augments
                      </Button>
                    </fieldset>
                  )}
                </div>
              );
            })}
          </TooltipProvider>
          <Button
            type="button"
            variant="outline"
            disabled={!installed.length}
            onClick={() =>
              setCombos([
                ...combos,
                {
                  id: nextComboId++,
                  harness: installed[0]!.harness,
                  model: "",
                  current: true,
                  default: false,
                  clean: false,
                  augments: [],
                  branchPrefix: "",
                },
              ])
            }
          >
            <Plus /> Add row
          </Button>
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <div className="grid content-start gap-2 text-sm font-medium">
            <label htmlFor={fieldId("trials")}>Trials</label>
            <Input
              id={fieldId("trials")}
              aria-describedby={hintId("trials")}
              className="w-32"
              type="number"
              min="1"
              max={catalog.limits.maxTrials}
              step="1"
              value={trials || ""}
              onChange={(event) => setTrials(Number(event.target.value))}
            />
            <Hint id={hintId("trials")}>Runs per setup; more trials smooth out luck.</Hint>
          </div>
          <div className="grid content-start gap-2 text-sm font-medium">
            <label htmlFor={fieldId("wall")}>Timeout per cell (minutes)</label>
            <Input
              id={fieldId("wall")}
              aria-describedby={hintId("wall")}
              className="w-44"
              type="number"
              min="0"
              max={catalog.limits.maxWallMs / 60000}
              step="any"
              defaultValue={wallMs / 60000}
              onChange={(event) => setWallMs(Math.round(Number(event.target.value) * 60000))}
            />
            <Hint id={hintId("wall")}>How long one agent run may take before it is stopped.</Hint>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
          <p className="font-medium">
            {setups.length} setups × {trials || 0} trials = {setups.length * (trials || 0)} runs
          </p>
          <Button type="button" disabled={reason != null} onClick={() => void start()}>
            Start evaluation
          </Button>
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {reason && !error && (
          <p className="text-sm text-muted-foreground" role="status">
            {reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
