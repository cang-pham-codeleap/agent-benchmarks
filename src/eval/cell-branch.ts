import type { EvalSetup } from "./types.ts";

export function cellBranch(
  prefix: string,
  setup: Pick<EvalSetup, "config" | "augments">,
  trial: number,
): string {
  return `${prefix}/${[setup.config, ...setup.augments].join("+")}-t${trial}`;
}
