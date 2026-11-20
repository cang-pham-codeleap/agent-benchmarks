import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import type {
  EvalCatalog,
  EvalHarness,
  EvalSetup,
  RealRunInput,
  RepoInspection,
} from "../../../eval/types.ts";
import { getJson } from "../../api.ts";
import { realStartReason } from "../evaluating-form.ts";
import { ModelPicker } from "./form.tsx";

interface Combo {
  id: number;
  harness: EvalHarness;
  model: string;
  current: boolean;
  default: boolean;
}

let nextComboId = 0;

const textareaClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

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

  const setups: EvalSetup[] = combos.flatMap((combo) => [
    ...(combo.current
      ? [{ harness: combo.harness, model: combo.model, config: "current" as const }]
      : []),
    ...(combo.default
      ? [{ harness: combo.harness, model: combo.model, config: "default" as const }]
      : []),
  ]);
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
          <label
            htmlFor={fieldId("name")}
            className="grid min-w-64 flex-1 gap-2 text-sm font-medium"
          >
            Name
            <Input
              id={fieldId("name")}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label
            htmlFor={fieldId("repo")}
            className="grid min-w-64 flex-[2] gap-2 text-sm font-medium"
          >
            Repository path
            <Input
              id={fieldId("repo")}
              value={repoPath}
              placeholder="/absolute/path/to/repo"
              onChange={(event) => setRepoPath(event.target.value)}
              onBlur={() => void inspect(repoPath, null)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void inspect(repoPath, null);
              }}
            />
          </label>
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
            value={type}
            onValueChange={(value) => value && setType(value as "prompt" | "replay")}
          >
            <ToggleGroupItem value="prompt">Prompt</ToggleGroupItem>
            <ToggleGroupItem value="replay">Replay commit</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {type === "prompt" ? (
          <label htmlFor={fieldId("base")} className="grid max-w-md gap-2 text-sm font-medium">
            Base ref
            <Input
              id={fieldId("base")}
              value={baseRef}
              onChange={(event) => setBaseRef(event.target.value)}
            />
          </label>
        ) : (
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
                <SelectTrigger aria-label="Recent commit">
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
            <label
              htmlFor={fieldId("sha")}
              className="grid min-w-48 flex-1 gap-2 text-sm font-medium"
            >
              Commit SHA
              <Input
                id={fieldId("sha")}
                value={sha}
                onChange={(event) => setSha(event.target.value)}
                onBlur={() => sha.trim() && void inspect(repoPath, sha.trim())}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && sha.trim()) void inspect(repoPath, sha.trim());
                }}
              />
            </label>
          </div>
        )}
        <label htmlFor={fieldId("prompt")} className="grid gap-2 text-sm font-medium">
          Prompt
          <textarea
            id={fieldId("prompt")}
            className={textareaClass}
            rows={6}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        {commit && commit.files.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Hidden paths</legend>
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
          <label htmlFor={fieldId("setup")} className="grid gap-2 text-sm font-medium">
            Setup command
            <Input
              id={fieldId("setup")}
              value={setupCommand}
              onChange={(event) => setSetupCommand(event.target.value)}
            />
          </label>
          {type === "replay" && (
            <label htmlFor={fieldId("hidden-test")} className="grid gap-2 text-sm font-medium">
              Hidden-test command
              <Input
                id={fieldId("hidden-test")}
                value={hiddenTestCommand}
                placeholder="bun test {file}"
                onChange={(event) => setHiddenTestCommand(event.target.value)}
              />
            </label>
          )}
          <label
            htmlFor={fieldId("checks")}
            className="grid gap-2 text-sm font-medium md:col-span-2"
          >
            Checks (one per line)
            <textarea
              id={fieldId("checks")}
              className={textareaClass}
              rows={3}
              value={checks}
              onChange={(event) => setChecks(event.target.value)}
            />
          </label>
        </div>
        <fieldset className="space-y-3">
          <legend className="font-semibold">Harness and model</legend>
          <TooltipProvider>
            {combos.map((combo, index) => {
              const info = catalog.harnesses.find((harness) => harness.harness === combo.harness);
              const problem = info?.defaultConfigProblem ?? null;
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
                    <ModelPicker
                      index={index}
                      label={`Model for row ${index + 1}`}
                      info={info}
                      model={combo.model}
                      onChange={(model) => updateCombo(index, { model })}
                    />
                  </div>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove row ${index + 1}`}
                    onClick={() => setCombos(combos.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </Button>
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
                },
              ])
            }
          >
            <Plus /> Add row
          </Button>
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <label htmlFor={fieldId("trials")} className="grid gap-2 text-sm font-medium">
            Trials
            <Input
              id={fieldId("trials")}
              className="w-32"
              type="number"
              min="1"
              max={catalog.limits.maxTrials}
              step="1"
              value={trials || ""}
              onChange={(event) => setTrials(Number(event.target.value))}
            />
          </label>
          <label htmlFor={fieldId("wall")} className="grid gap-2 text-sm font-medium">
            Timeout per cell (minutes)
            <Input
              id={fieldId("wall")}
              className="w-44"
              type="number"
              min="0"
              max={catalog.limits.maxWallMs / 60000}
              step="any"
              defaultValue={wallMs / 60000}
              onChange={(event) => setWallMs(Math.round(Number(event.target.value) * 60000))}
            />
          </label>
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
