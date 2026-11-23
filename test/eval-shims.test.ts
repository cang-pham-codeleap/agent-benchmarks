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
for (const name of ["claude", "codex", "copilot"]) {
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
    const bin = writeHarnessShims(join(root, "run-a"), current, ["copilot"], false, installed, {});
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
    const bin = writeHarnessShims(join(root, "run-f"), current, ["copilot"], false, installed, {});
    expect(
      argsThroughShim(bin, "copilot", ["--model", "copilot-fusion", "--prompt=copilot-fusion"]),
    ).toEqual(["--model", "auto", "--prompt=copilot-fusion"]);
    expect(argsThroughShim(bin, "copilot", ["--model=copilot-fusion"])).toEqual(["--model=auto"]);
  });

  test("codex exec gets a writable sandbox in real tasks only", () => {
    const bin = writeHarnessShims(join(root, "run-b"), current, ["codex"], true, installed, {});
    expect(argsThroughShim(bin, "codex", ["exec", "--json", "do it"])).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "--json",
      "do it",
    ]);
    expect(
      writeHarnessShims(join(root, "run-c"), current, ["codex"], false, installed, {}),
    ).toBeNull();
  });

  test("an effort leaves the model and reaches each CLI as its own flag, next to the model", () => {
    const bin = writeHarnessShims(
      join(root, "run-e"),
      current,
      ["claude", "codex", "copilot"],
      false,
      installed,
      {},
      new Set(["claude", "codex", "copilot"]),
    );
    expect(argsThroughShim(bin, "claude", ["-p", "--model=opus#max", "fix #1"])).toEqual([
      "-p",
      "--model=opus",
      "--effort",
      "max",
      "fix #1",
    ]);
    expect(argsThroughShim(bin, "codex", ["exec", "-m", "gpt-5.5#xhigh", "do it"])).toEqual([
      "exec",
      "-m",
      "gpt-5.5",
      "-c",
      "model_reasoning_effort=xhigh",
      "do it",
    ]);
    expect(argsThroughShim(bin, "copilot", ["--model", "gpt-5.5#high", "-p", "x"])).toEqual([
      "--model",
      "gpt-5.5",
      "--reasoning-effort",
      "high",
      "-p",
      "x",
    ]);
    expect(argsThroughShim(bin, "copilot", ["--model", "copilot-fusion#max"])).toEqual([
      "--model",
      "auto",
      "--fusion-tier",
      "max",
    ]);
  });

  test("a group without an effort gets no effort shim", () => {
    expect(
      writeHarnessShims(join(root, "run-g"), current, ["claude"], false, installed, {}),
    ).toBeNull();
  });
});
