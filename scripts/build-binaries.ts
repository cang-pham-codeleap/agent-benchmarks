#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const targets = [
  { key: "darwin-arm64", bunTarget: "bun-darwin-arm64" },
  { key: "darwin-x64", bunTarget: "bun-darwin-x64" },
  { key: "linux-arm64", bunTarget: "bun-linux-arm64" },
  { key: "linux-x64", bunTarget: "bun-linux-x64" },
] as const;

const args = process.argv.slice(2);
const value = (flag: string, fallback: string): string => {
  const index = args.indexOf(flag);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};
const selector = value("--target", "all");
const outDir = value("--out-dir", "dist/bin");
const version = value("--version", "");
const selected =
  selector === "all"
    ? targets
    : selector === "native"
      ? targets.filter((target) => target.key === `${process.platform}-${process.arch}`)
      : targets.filter((target) => target.key === selector);
if (selected.length === 0) throw new Error(`unsupported target: ${selector}`);

for (const target of selected) {
  const outPath = resolve(join(outDir, target.key, "agent-benchmarks"));
  mkdirSync(dirname(outPath), { recursive: true });
  const buildArgs = [
    "build",
    "--compile",
    "--minify",
    "--splitting",
    "--define",
    'process.env.NODE_ENV="production"',
    "--target",
    target.bunTarget,
    ...(version === "" ? [] : ["--env=AGENT_BENCHMARKS_BUILD_VERSION*"]),
    "src/cli.ts",
    "src/sync-worker.ts",
    "src/stats-worker.ts",
    "src/read-worker.ts",
    "--outfile",
    outPath,
  ];
  const result = spawnSync("bun", buildArgs, {
    cwd: resolve(import.meta.dir, ".."),
    env: version === "" ? process.env : { ...process.env, AGENT_BENCHMARKS_BUILD_VERSION: version },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  chmodSync(outPath, 0o755);
  process.stdout.write(`built ${target.key}: ${outPath}\n`);
}
