import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("falls back to dev outside a checkout", () => {
    expect(resolveAgentBenchmarksVersion({ env: {}, describe: () => null })).toBe("dev");
  });

  test("a compiled binary reports the version inlined at build time", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-benchmarks-version-"));
    try {
      const entry = join(dir, "entry.ts");
      const binary = join(dir, "agent-benchmarks");
      writeFileSync(
        entry,
        `import { AGENT_BENCHMARKS_VERSION } from ${JSON.stringify(join(import.meta.dir, "..", "src", "version.ts"))};\nconsole.log(AGENT_BENCHMARKS_VERSION);\n`,
      );
      const build = Bun.spawnSync(
        [
          "bun",
          "build",
          "--compile",
          "--env=AGENT_BENCHMARKS_BUILD_VERSION*",
          entry,
          "--outfile",
          binary,
        ],
        { env: { ...process.env, AGENT_BENCHMARKS_BUILD_VERSION: "9.8.7-test" } },
      );
      expect(build.exitCode).toBe(0);
      const { AGENT_BENCHMARKS_BUILD_VERSION: _unset, ...runEnv } = process.env;
      const run = Bun.spawnSync([binary], { env: runEnv });
      expect(run.stdout.toString().trim()).toBe("9.8.7-test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
