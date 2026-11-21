import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groupId } from "../src/eval/paths.ts";
import { writeHarnessShims } from "../src/eval/runner.ts";

const current = groupId("current", []);

const root = mkdtempSync(join(tmpdir(), "ab-shims-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const installed = join(root, "installed");
mkdirSync(installed);
for (const name of ["codex", "copilot"]) {
  writeFileSync(join(installed, name), `#!/bin/sh\nfor arg do printf '%s\\n' "$arg"; done\n`);
  chmodSync(join(installed, name), 0o755);
}

function argsThroughShim(bin: string | null, name: string, args: string[]): string[] {
  if (bin == null) throw new Error("no shim written");
  const run = Bun.spawnSync([join(bin, name), ...args], { stdout: "pipe" });
  return run.stdout.toString().trimEnd().split("\n");
}

describe("harness shims", () => {
  test("copilot loses the flags the installed CLI rejects or that pin an older CLI", () => {
    const bin = writeHarnessShims(join(root, "run-a"), current, ["copilot"], false, installed);
    expect(
      argsThroughShim(bin, "copilot", [
        "--prompt=fix it; keep spaces",
        "--no-auto-update",
        "--usage-output-file",
        "/tmp/usage.json",
        "--model",
        "claude-sonnet-5.5",
        "--usage-output-file=/tmp/u2.json",
      ]),
    ).toEqual(["--prompt=fix it; keep spaces", "--model", "claude-sonnet-5.5"]);
  });

  test("copilot-fusion reaches the CLI as its auto model, in both flag forms", () => {
    const bin = writeHarnessShims(join(root, "run-f"), current, ["copilot"], false, installed);
    expect(
      argsThroughShim(bin, "copilot", ["--model", "copilot-fusion", "--prompt=copilot-fusion"]),
    ).toEqual(["--model", "auto", "--prompt=copilot-fusion"]);
    expect(argsThroughShim(bin, "copilot", ["--model=copilot-fusion"])).toEqual(["--model=auto"]);
  });

  test("codex exec gets a writable sandbox in real tasks only", () => {
    const bin = writeHarnessShims(join(root, "run-b"), current, ["codex"], true, installed);
    expect(argsThroughShim(bin, "codex", ["exec", "--json", "do it"])).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "--json",
      "do it",
    ]);
    expect(writeHarnessShims(join(root, "run-c"), current, ["codex"], false, installed)).toBeNull();
  });
});
