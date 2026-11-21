import { useEffect, useId, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ApiRetryPolicy, getJson } from "../api.ts";
import {
  type BackgroundPhase,
  backgroundNote,
  waitForBackgroundService,
} from "../background-service.ts";
import { errorMessage, versionLabel } from "../format.ts";
import type { BackgroundStatus, ConfigView, SettingsInfo, UserSettings } from "../types.ts";

export function SettingsView({
  config,
  onSaved,
  settingsInfo,
}: {
  config: ConfigView | null;
  onSaved: () => void;
  settingsInfo: SettingsInfo | null;
}) {
  const [settings, setSettings] = useState<UserSettings | null>(settingsInfo?.settings ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSettings(settingsInfo?.settings ?? null);
    setSaveError(null);
  }, [settingsInfo]);

  const save = (patch: Partial<UserSettings>) => {
    const base = settings ?? settingsInfo?.settings;
    if (base == null) return;
    const previous = settings;
    const next = { ...base, ...patch };
    setSettings(next);
    setSaveError(null);
    void getJson<SettingsInfo>("/api/settings", {
      method: "POST",
      body: JSON.stringify(next),
    })
      .then((response) => {
        setSettings(response.settings);
        onSaved();
      })
      .catch((err: unknown) => {
        setSettings(previous ?? base);
        setSaveError(errorMessage(err));
      });
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          How Agent Benchmarks opens things on your machine. We start from what we detect and
          remember your choices.
        </p>
      </header>

      <Card>
        <CardContent className="divide-y">
          <SettingSelect
            help="The agent the Run button opens first across Insights."
            label="Preferred agent"
            options={settingsInfo?.options.agents ?? []}
            value={settings?.agent ?? "claude"}
            onChange={(agent) => save({ agent })}
          />
          <SettingSelect
            help="Where a session opens when you run an agent."
            label="Terminal"
            options={settingsInfo?.options.terminals ?? []}
            value={settings?.terminal ?? "terminal"}
            onChange={(terminal) => save({ terminal })}
          />
          <SettingSelect
            help="Which editor Open in editor uses for a session's project."
            label="Editor"
            options={settingsInfo?.options.ides ?? []}
            value={settings?.ide ?? "vscode"}
            onChange={(ide) => save({ ide })}
          />
        </CardContent>
        {saveError != null ? (
          <Alert variant="destructive">
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}
      </Card>

      <Card>
        <CardContent className="divide-y">
          <BackgroundSetting />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="space-y-2">
            <CardTitle>About Agent Benchmarks</CardTitle>
            <p className="text-sm text-muted-foreground">
              See where your coding agents spend tokens, money, and time: a local-first, searchable
              archive for models, harnesses, and agentic workflows.
            </p>
            <p className="text-sm text-muted-foreground">Based on Decant by Dosu (Apache-2.0)</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Version {versionLabel(config?.version)}</p>
          <p>
            Agent Benchmarks makes no outbound network calls. Your session logs stay on this
            machine.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

const NO_RETRY: ApiRetryPolicy = { delaysMs: [], wait: async () => undefined };

function BackgroundSetting() {
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [phase, setPhase] = useState<BackgroundPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getJson<BackgroundStatus>("/api/background")
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch((err: unknown) => {
        if (live) setError(errorMessage(err));
      });
    return () => {
      live = false;
    };
  }, []);

  const toggle = (enabled: boolean) => {
    setPhase("saving");
    setError(null);
    void getJson<BackgroundStatus>("/api/background", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    })
      .then(async (next) => {
        setStatus(next);
        if (next.stopping) {
          setPhase("stopped");
          return;
        }
        if (!next.handoff) {
          setPhase("idle");
          return;
        }
        setPhase("handoff");
        const ready = await waitForBackgroundService(() =>
          getJson<BackgroundStatus>("/api/background", undefined, fetch, NO_RETRY),
        );
        if (ready) {
          window.location.reload();
          return;
        }
        setPhase("stopped");
        setError(
          "The background service did not answer within 30 seconds. Run agent-benchmarks service status to see why.",
        );
      })
      .catch((err: unknown) => {
        setPhase("idle");
        setError(errorMessage(err));
      });
  };

  const busy = phase !== "idle";
  return (
    <>
      <SettingSwitch
        checked={phase === "handoff" || (status?.installed ?? false)}
        disabled={busy || status == null || !status.supported}
        help="Start Agent Benchmarks when you log in and keep syncing sessions with no terminal open. The UI stays at this address."
        label="Run in the background"
        onChange={toggle}
        status={backgroundNote(status, phase)}
      />
      {error != null ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

export function SettingSelect({
  help,
  label,
  options,
  value,
  onChange,
}: {
  help: string;
  label: string;
  options: [string, string][];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <strong id={`${id}-label`} className="text-sm font-medium">
          {label}
        </strong>
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-help`}
          className="w-full sm:w-56"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([key, name]) => (
            <SelectItem key={key} value={key}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SettingSwitch({
  checked,
  disabled = false,
  help,
  label,
  onChange,
  status,
}: {
  checked: boolean;
  disabled?: boolean;
  help: string;
  label: string;
  onChange: (checked: boolean) => void;
  status?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <strong id={`${id}-label`} className="text-sm font-medium">
          {label}
        </strong>
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
        {status != null ? (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {status}
          </p>
        ) : null}
      </div>
      <button
        aria-checked={checked}
        aria-describedby={`${id}-help`}
        aria-labelledby={`${id}-label`}
        className="inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent bg-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-checked:bg-primary"
        disabled={disabled}
        id={id}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={`block size-5 rounded-full bg-background shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
        />
      </button>
    </div>
  );
}
