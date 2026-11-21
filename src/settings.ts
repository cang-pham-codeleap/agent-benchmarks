import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type AgentKey = "claude" | "codex";
export type TerminalKey =
  | "terminal"
  | "iterm"
  | "ghostty"
  | "warp"
  | "wezterm"
  | "kitty"
  | "alacritty";
export type IdeKey = "vscode" | "cursor" | "zed" | "sublime" | "intellij";

export interface UserSettings {
  agent: AgentKey;
  terminal: TerminalKey;
  ide: IdeKey;
  /** Added for evaluation; older persisted settings and fixtures may omit it. */
  achDir?: string;
}

export interface SettingsOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string | null;
  appExists?: (name: string) => boolean;
}

const validAgents = new Set<AgentKey>(["claude", "codex"]);
const validTerminals = new Set<TerminalKey>([
  "terminal",
  "iterm",
  "ghostty",
  "warp",
  "wezterm",
  "kitty",
  "alacritty",
]);
const validIdes = new Set<IdeKey>(["vscode", "cursor", "zed", "sublime", "intellij"]);

export const agentOptions: [AgentKey, string][] = [
  ["claude", "Claude"],
  ["codex", "Codex"],
];

export const terminalOptions: [TerminalKey, string][] = [
  ["terminal", "Terminal"],
  ["iterm", "iTerm"],
  ["ghostty", "Ghostty"],
  ["warp", "Warp"],
  ["wezterm", "WezTerm"],
  ["kitty", "kitty"],
  ["alacritty", "Alacritty"],
];

export const ideOptions: [IdeKey, string][] = [
  ["vscode", "VS Code"],
  ["cursor", "Cursor"],
  ["zed", "Zed"],
  ["sublime", "Sublime Text"],
  ["intellij", "IntelliJ IDEA"],
];

export function settingsPath(options: SettingsOptions = {}): string {
  const env = options.env ?? process.env;
  const home = (options.homeDir ?? homedir()) || ".";
  const dir = env.AGENT_BENCHMARKS_CONFIG_DIR ?? join(home, ".config", "agent-benchmarks");
  return resolve(join(dir, "settings.json"));
}

export function detectedSettings(options: SettingsOptions = {}): UserSettings {
  return {
    agent: "claude",
    terminal: detectTerminal(options.env ?? process.env),
    ide: detectIde(options.appExists ?? ((name) => existsSync(`/Applications/${name}.app`))),
  };
}

interface StoredSettings {
  values: Partial<UserSettings>;
  unparseable: boolean;
}

function readStoredSettings(options: SettingsOptions): StoredSettings {
  let body: string;
  try {
    body = readFileSync(settingsPath(options), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { values: {}, unparseable: false };
    }
    throw error;
  }
  if (body.trim() === "") {
    return { values: {}, unparseable: false };
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { values: {}, unparseable: true };
    }
    return { values: sanitize(parsed), unparseable: false };
  } catch {
    return { values: {}, unparseable: true };
  }
}

export function getSettings(options: SettingsOptions = {}): UserSettings {
  let values: Partial<UserSettings> = {};
  try {
    values = readStoredSettings(options).values;
  } catch {}
  return { ...detectedSettings(options), ...values };
}

export function getAchDir(options: SettingsOptions = {}): string {
  return (
    getSettings(options).achDir ??
    join(
      (options.homeDir ?? homedir()) || ".",
      "Documents",
      "sources",
      "_oss-study",
      "agentic-coding-harness",
    )
  );
}

export function saveSettings(
  attrs: Record<string, unknown>,
  options: SettingsOptions = {},
): UserSettings {
  const stored = readStoredSettings(options);
  const merged = { ...stored.values, ...sanitize(attrs) };
  const path = writeTarget(settingsPath(options));
  mkdirSync(dirname(path), { recursive: true });
  if (stored.unparseable) {
    renameSync(path, `${path}.corrupt-${Date.now()}`);
  }
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return { ...detectedSettings(options), ...merged };
}

function writeTarget(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return path;
    throw error;
  }
}

function sanitize(attrs: unknown): Partial<UserSettings> {
  if (attrs == null || typeof attrs !== "object") {
    return {};
  }
  const raw = attrs as Record<string, unknown>;
  const out: Partial<UserSettings> = {};
  if (typeof raw.agent === "string" && validAgents.has(raw.agent as AgentKey)) {
    out.agent = raw.agent as AgentKey;
  }
  if (typeof raw.terminal === "string" && validTerminals.has(raw.terminal as TerminalKey)) {
    out.terminal = raw.terminal as TerminalKey;
  }
  if (typeof raw.ide === "string" && validIdes.has(raw.ide as IdeKey)) {
    out.ide = raw.ide as IdeKey;
  }
  if (typeof raw.achDir === "string" && raw.achDir.trim() !== "" && isAbsolute(raw.achDir)) {
    out.achDir = resolve(raw.achDir);
  }
  return out;
}

function detectTerminal(env: Record<string, string | undefined>): TerminalKey {
  switch (env.TERM_PROGRAM) {
    case "iTerm.app":
      return "iterm";
    case "ghostty":
      return "ghostty";
    case "WarpTerminal":
      return "warp";
    case "WezTerm":
      return "wezterm";
    case "Apple_Terminal":
      return "terminal";
    default:
      return env.TERM === "xterm-kitty" ? "kitty" : "terminal";
  }
}

function detectIde(appExists: (name: string) => boolean): IdeKey {
  for (const [app, key] of [
    ["Cursor", "cursor"],
    ["Visual Studio Code", "vscode"],
    ["Zed", "zed"],
    ["Sublime Text", "sublime"],
    ["IntelliJ IDEA", "intellij"],
  ] as const) {
    if (appExists(app)) {
      return key;
    }
  }
  return "vscode";
}
