import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { resolveAgentBenchmarksVersion } from "../src/version.ts";

describe("version resolution", () => {
  test("prefers the build version over checkout metadata", () => {
    expect(
      resolveAgentBenchmarksVersion({
        env: { AGENT_BENCHMARKS_BUILD_VERSION: "1.2.3" },
        describe: () => "v1.0.0-2-gabcdef",
      }),
    ).toBe("1.2.3");
  });

  test("uses checkout metadata for source runs", () => {
    expect(
      resolveAgentBenchmarksVersion({
        env: {},
        checkoutDir: "/tmp/agent-benchmarks",
        describe: (dir) => (dir === "/tmp/agent-benchmarks" ? "v1.0.0-2-gabcdef" : null),
      }),
    ).toBe("v1.0.0-2-gabcdef");
  });

  test("falls back to the package version outside a checkout", () => {
    expect(resolveAgentBenchmarksVersion({ env: {}, describe: () => null })).toBe(
      packageJson.version,
    );
  });

  test("ignores a parent repository's tags when installed inside another project", () => {
    const project = mkdtempSync(join(tmpdir(), "agent-benchmarks-host-"));
    try {
      const git = (...args: string[]) => spawnSync("git", args, { cwd: project, stdio: "ignore" });
      git("init", "-q");
      git(
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.test",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "host",
      );
      git("tag", "v9.9.9");
      const installed = join(project, "node_modules", "agent-benchmarks");
      mkdirSync(installed, { recursive: true });
      expect(resolveAgentBenchmarksVersion({ env: {}, checkoutDir: installed })).toBe(
        packageJson.version,
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
