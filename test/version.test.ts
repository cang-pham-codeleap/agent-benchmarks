import { describe, expect, test } from "bun:test";
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
});
