import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const TLA_TOOLS_VERSION = "1.7.4";
const TLA_TOOLS_URL = `https://github.com/tlaplus/tlaplus/releases/download/v${TLA_TOOLS_VERSION}/tla2tools.jar`;
const TLA_TOOLS_SHA256 = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const MODEL_DIR = join(import.meta.dir, "..", "models", "sync-protocol");
const SPEC = "SyncProtocol.tla";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function tlaTools(): Promise<string> {
  const cacheDir = join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
    "agent-benchmarks",
  );
  const jar = join(cacheDir, `tla2tools-${TLA_TOOLS_VERSION}.jar`);
  const cached = Bun.file(jar);
  if (await cached.exists()) {
    const digest = sha256(new Uint8Array(await cached.arrayBuffer()));
    if (digest !== TLA_TOOLS_SHA256) {
      throw new Error(`${jar} has sha256 ${digest}, expected ${TLA_TOOLS_SHA256}. Delete it.`);
    }
    return jar;
  }
  const response = await fetch(TLA_TOOLS_URL);
  if (!response.ok) {
    throw new Error(`download ${TLA_TOOLS_URL} failed: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== TLA_TOOLS_SHA256) {
    throw new Error(`${TLA_TOOLS_URL} has sha256 ${digest}, expected ${TLA_TOOLS_SHA256}`);
  }
  mkdirSync(cacheDir, { recursive: true });
  await Bun.write(`${jar}.partial`, bytes);
  renameSync(`${jar}.partial`, jar);
  return jar;
}

function expectation(config: string): string {
  const expected = /^\\\* expect: (\w+)$/m.exec(readFileSync(join(MODEL_DIR, config), "utf8"));
  if (expected?.[1] == null) {
    throw new Error(`${config} needs a first line "\\* expect: pass" or "\\* expect: <Invariant>"`);
  }
  return expected[1];
}

function outcome(output: string, exitCode: number): string {
  const violated = /Invariant (\w+) is violated/.exec(output);
  if (violated?.[1] != null) return violated[1];
  if (exitCode === 0 && output.includes("Model checking completed. No error has been found.")) {
    return "pass";
  }
  return "error";
}

const jar = await tlaTools();
const java = process.env.JAVA ?? "java";
const selected = process.argv.slice(2);
const configs = readdirSync(MODEL_DIR)
  .filter((name) => name.endsWith(".cfg"))
  .filter((name) => selected.length === 0 || selected.includes(name))
  .sort();
let failed = false;
for (const config of configs) {
  const expected = expectation(config);
  const metadir = mkdtempSync(join(tmpdir(), "tlc-"));
  const run = Bun.spawnSync(
    [
      java,
      "-XX:+UseParallelGC",
      "-cp",
      jar,
      "tlc2.TLC",
      "-config",
      config,
      "-workers",
      "auto",
      "-metadir",
      metadir,
      SPEC,
    ],
    { cwd: MODEL_DIR, stdout: "pipe", stderr: "pipe" },
  );
  rmSync(metadir, { recursive: true, force: true });
  const output = `${run.stdout.toString()}${run.stderr.toString()}`;
  const actual = outcome(output, run.exitCode ?? 1);
  const states = [...output.matchAll(/(\d[\d,]*) distinct states found/g)].at(-1)?.[1] ?? "?";
  if (actual === expected) {
    console.log(`ok   ${config}: ${actual} (${states} distinct states)`);
    continue;
  }
  failed = true;
  console.log(`FAIL ${config}: expected ${expected}, TLC reported ${actual}\n${output}`);
}
if (configs.length === 0) {
  console.log(`no config matched ${selected.join(", ")} in ${MODEL_DIR}`);
  failed = true;
}
process.exit(failed ? 1 : 0);
