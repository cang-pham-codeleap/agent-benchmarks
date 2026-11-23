#!/usr/bin/env bun
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import tailwind from "bun-plugin-tailwind";

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

const root = resolve(import.meta.dir, "..");
for (const target of selected) {
  const outPath = resolve(join(outDir, target.key, "agent-benchmarks"));
  mkdirSync(dirname(outPath), { recursive: true });
  // The CLI `bun build --compile` cannot load plugins; without tailwind the embedded UI CSS ships unprocessed.
  const result = await Bun.build({
    entrypoints: [
      "src/cli.ts",
      "src/sync-worker.ts",
      "src/stats-worker.ts",
      "src/read-worker.ts",
    ].map((entry) => join(root, entry)),
    compile: { target: target.bunTarget, outfile: outPath },
    minify: true,
    splitting: true,
    define: {
      "process.env.NODE_ENV": '"production"',
      ...(version === ""
        ? {}
        : { "process.env.AGENT_BENCHMARKS_BUILD_VERSION": JSON.stringify(version) }),
    },
    plugins: [tailwind],
    throw: false,
  });
  for (const log of result.logs) console.error(log);
  if (!result.success) process.exit(1);
  chmodSync(outPath, 0o755);
  process.stdout.write(`built ${target.key}: ${outPath}\n`);
}
