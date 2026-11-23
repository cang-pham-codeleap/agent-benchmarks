import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("every file the AGENTS.md rule table names as an enforcer exists", () => {
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  const table = agents.split("## Rules and what enforces them")[1]?.split("\n## ")[0] ?? "";
  const paths = [...table.matchAll(/`([\w./-]+\/[\w.-]+\.\w+)`/g)].map((match) => match[1] ?? "");
  expect(paths.length).toBeGreaterThan(5);
  expect(paths.filter((path) => !existsSync(join(root, path)))).toEqual([]);
});
