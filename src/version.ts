import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };

// This direct access is intentionally kept at module scope so `bun build
// --compile --env=AGENT_BENCHMARKS_BUILD_VERSION*` can replace it in release binaries.
const INLINED_BUILD_VERSION = process.env.AGENT_BENCHMARKS_BUILD_VERSION;

export interface VersionResolutionOptions {
  env?: Record<string, string | undefined>;
  checkoutDir?: string;
  describe?: (checkoutDir: string) => string | null;
}

function describeCheckout(checkoutDir: string): string | null {
  if (!existsSync(join(checkoutDir, ".git"))) return null;
  try {
    const result = spawnSync("git", ["describe", "--tags", "--always", "--dirty"], {
      cwd: checkoutDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const version = result.status === 0 ? result.stdout.trim() : "";
    return version === "" ? null : version;
  } catch {
    return null;
  }
}

export function resolveAgentBenchmarksVersion(options: VersionResolutionOptions = {}): string {
  const builtVersion = (
    options.env == null ? INLINED_BUILD_VERSION : options.env.AGENT_BENCHMARKS_BUILD_VERSION
  )?.trim();
  if (builtVersion != null && builtVersion !== "") {
    return builtVersion;
  }

  const checkoutDir = options.checkoutDir ?? resolve(import.meta.dir, "..");
  return (options.describe ?? describeCheckout)(checkoutDir) ?? packageJson.version;
}

export const AGENT_BENCHMARKS_VERSION = resolveAgentBenchmarksVersion();
