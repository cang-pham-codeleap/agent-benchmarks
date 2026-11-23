import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { EVAL_ID_PATTERN } from "./augments.ts";
import { EvalRequestError } from "./errors.ts";
import type {
  BenchmarkRunInput,
  EvalCombo,
  EvalComboInfo,
  EvalConfigMode,
  EvalHarness,
} from "./types.ts";

/** The rules for starting a benchmark run: throws EvalRequestError, or returns the normalized input. */
export type ComboCheck = (raw: unknown) => BenchmarkRunInput;

const ID_MESSAGE = "id must be 1-64 lowercase letters, digits, or hyphens";

export function readCombos(evalDir: string, check: ComboCheck): EvalComboInfo[] {
  const dir = join(evalDir, "combos");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const id = name.slice(0, -".json".length);
      const path = join(dir, name);
      try {
        if (!EVAL_ID_PATTERN.test(id)) throw new EvalRequestError(`file name: ${ID_MESSAGE}`);
        const combo = parseCombo(id, JSON.parse(readFileSync(path, "utf8")));
        try {
          check(runInput(combo));
          return { ...combo, problem: null };
        } catch (error) {
          if (!(error instanceof EvalRequestError)) throw error;
          return { ...combo, problem: error.message };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          id,
          label: id,
          setups: [],
          taskIds: [],
          trials: 0,
          wallMs: 0,
          problem: `${path}: ${message}`,
        };
      }
    });
}

/** Writes `<evalDir>/combos/<id>.json` atomically once the combo passes the run-start rules. */
export function saveCombo(evalDir: string, body: unknown, check: ComboCheck): EvalComboInfo {
  if (body == null || typeof body !== "object" || Array.isArray(body))
    throw new EvalRequestError("body must be an object");
  const { id, overwrite, ...fields } = body as Record<string, unknown>;
  if (typeof id !== "string" || !EVAL_ID_PATTERN.test(id)) throw new EvalRequestError(ID_MESSAGE);
  if (overwrite !== undefined && typeof overwrite !== "boolean")
    throw new EvalRequestError("overwrite must be a boolean");
  const parsed = parseCombo(id, fields);
  const input = check(runInput(parsed));
  const dir = join(evalDir, "combos");
  const path = join(dir, `${id}.json`);
  if (overwrite !== true && existsSync(path))
    throw new EvalRequestError(`a combo named ${id} already exists`, 409, "combo_exists");
  const { setups, taskIds, trials, wallMs } = input;
  const file = { label: parsed.label, setups, taskIds, trials, wallMs };
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
  return { id, ...file, problem: null };
}

function runInput(combo: EvalCombo): BenchmarkRunInput {
  const { label, setups, taskIds, trials, wallMs } = combo;
  return { kind: "benchmark", name: label, setups, taskIds, trials, wallMs, preset: "custom" };
}

function parseCombo(id: string, raw: unknown): EvalCombo {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw))
    throw new EvalRequestError("combo must be an object");
  const value = raw as Record<string, unknown>;
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (label === "" || label.length > 120)
    throw new EvalRequestError("label is required and must be at most 120 characters");
  if (!Array.isArray(value.setups)) throw new EvalRequestError("setups must be a list");
  const setups = value.setups.map((setup: Record<string, unknown> | null) => {
    if (
      setup == null ||
      typeof setup !== "object" ||
      typeof setup.harness !== "string" ||
      typeof setup.model !== "string"
    )
      throw new EvalRequestError("each setup requires harness and model");
    const config = setup.config ?? "current";
    if (config !== "current" && config !== "default" && config !== "clean")
      throw new EvalRequestError("setup config must be current, default, or clean");
    const augments = setup.augments ?? [];
    if (!Array.isArray(augments) || augments.some((augment) => typeof augment !== "string"))
      throw new EvalRequestError("setup augments must be a list of augment ids");
    return {
      harness: setup.harness as EvalHarness,
      model: setup.model,
      config: config as EvalConfigMode,
      augments: augments as string[],
    };
  });
  if (!Array.isArray(value.taskIds) || value.taskIds.some((task) => typeof task !== "string"))
    throw new EvalRequestError("taskIds must be a list of task ids");
  if (typeof value.trials !== "number" || typeof value.wallMs !== "number")
    throw new EvalRequestError("trials and wallMs must be numbers");
  return { id, label, setups, taskIds: value.taskIds, trials: value.trials, wallMs: value.wallMs };
}
