import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AugmentId, EvalConfigMode, EvalSetup } from "./types.ts";

const GROUP_KEY = /^(?:current|default|clean)(?:\+[a-z][a-z-]*)*$/;
const CONFIG_ORDER: EvalConfigMode[] = ["current", "default", "clean"];

export interface RunGroupId {
  key: string;
  config: EvalConfigMode;
  augments: AugmentId[];
}

/** Setups that share a config and augment set run as one `ach trial` group. */
export function groupId(config: EvalConfigMode, augments: readonly AugmentId[]): RunGroupId {
  return {
    key: augments.length === 0 ? config : `${config}+${augments.join("+")}`,
    config,
    augments: [...augments],
  };
}

/** Groups in the order their first setup was requested, which is also the order they run in. */
export function setupGroups<T extends EvalSetup>(
  setups: readonly T[],
): (RunGroupId & { setups: T[] })[] {
  const groups = new Map<string, RunGroupId & { setups: T[] }>();
  for (const setup of setups) {
    const id = groupId(setup.config, setup.augments);
    const group = groups.get(id.key) ?? { ...id, setups: [] };
    group.setups.push(setup);
    groups.set(id.key, group);
  }
  return [...groups.values()];
}

export function sortGroups<T extends { key: string; config: EvalConfigMode }>(groups: T[]): T[] {
  return groups.sort(
    (a, b) =>
      CONFIG_ORDER.indexOf(a.config) - CONFIG_ORDER.indexOf(b.config) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

export function isGroupKey(value: string): boolean {
  return GROUP_KEY.test(value);
}

export function configOfGroup(key: string): EvalConfigMode {
  return key.split("+", 1)[0] as EvalConfigMode;
}

export function ledgerFile(key: string): string {
  return key === "current" ? "ledger.jsonl" : `ledger.${key}.jsonl`;
}

export function planFile(key: string): string {
  return key === "current" ? "plan.json" : `plan.${key}.json`;
}

/** Group keys that have a `ledger*.jsonl` or `plan*.json` file in the run directory. */
export function groupKeysOnDisk(runDir: string, kind: "ledger" | "plan"): string[] {
  if (!existsSync(runDir)) return [];
  const extension = kind === "ledger" ? "jsonl" : "json";
  const pattern = new RegExp(`^${kind}(?:\\.(.+))?\\.${extension}$`);
  const keys = readdirSync(runDir).flatMap((name) => {
    const key = pattern.exec(name)?.[1] ?? (name === `${kind}.${extension}` ? "current" : null);
    return key != null && isGroupKey(key) ? [key] : [];
  });
  return sortGroups(keys.map((key) => ({ key, config: configOfGroup(key) }))).map(
    (group) => group.key,
  );
}

export function safeCellDir(achCellId: string): string {
  const hash = createHash("sha256").update(achCellId).digest("hex").slice(0, 8);
  return `${achCellId.replace(/[^A-Za-z0-9._-]/g, "_")}-${hash}`;
}

export function artifactDir(runDir: string, groupKey: string, achCellId: string): string {
  return join(runDir, "cells", groupKey, safeCellDir(achCellId));
}

export function apiCellId(groupKey: string, achCellId: string): string {
  return `${groupKey}/${achCellId}`;
}

export function parseApiCellId(id: string): { groupKey: string; achCellId: string } | null {
  const slash = id.indexOf("/");
  const groupKey = id.slice(0, slash);
  const achCellId = id.slice(slash + 1);
  if (slash < 0 || !isGroupKey(groupKey) || achCellId === "") return null;
  return { groupKey, achCellId };
}

export function augmentsDir(runDir: string): string {
  return join(runDir, "augments");
}

export function repoProfilesPath(dbPath: string): string {
  return join(dirname(dbPath), "evals", "repo-profiles.json");
}
