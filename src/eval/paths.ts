import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { EvalConfigMode } from "./types.ts";

export const ledgerFile: Record<EvalConfigMode, string> = {
  current: "ledger.jsonl",
  default: "ledger.default.jsonl",
};

export const planFile: Record<EvalConfigMode, string> = {
  current: "plan.json",
  default: "plan.default.json",
};

export function safeCellDir(achCellId: string): string {
  const hash = createHash("sha256").update(achCellId).digest("hex").slice(0, 8);
  return `${achCellId.replace(/[^A-Za-z0-9._-]/g, "_")}-${hash}`;
}

export function artifactDir(runDir: string, config: EvalConfigMode, achCellId: string): string {
  return join(runDir, "cells", config, safeCellDir(achCellId));
}

export function apiCellId(config: EvalConfigMode, achCellId: string): string {
  return `${config}/${achCellId}`;
}

export function parseApiCellId(id: string): { config: EvalConfigMode; achCellId: string } | null {
  const slash = id.indexOf("/");
  const config = id.slice(0, slash);
  const achCellId = id.slice(slash + 1);
  if (slash < 0 || (config !== "current" && config !== "default") || achCellId === "") return null;
  return { config, achCellId };
}

export function repoProfilesPath(dbPath: string): string {
  return join(dirname(dbPath), "evals", "repo-profiles.json");
}
