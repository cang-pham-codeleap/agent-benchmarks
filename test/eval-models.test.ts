import { describe, expect, test } from "bun:test";
import {
  parseCopilotConfigHelp,
  parseDroidExecHelp,
  parseOmpModels,
  parseOpencodeModels,
} from "../src/eval/models.ts";

describe("harness model listings", () => {
  test("copilot reads only the model entry of its config help, plus Fusion", () => {
    const help = [
      "  `logLevel`: log level for CLI",
      '    - "all"',
      "",
      "  `model`: AI model to use for Copilot CLI",
      '    - "claude-sonnet-5"',
      '    - "gpt-6-luna"',
      "",
      "  `contextTier`: context window tier",
      '    - "default"',
    ].join("\n");
    expect(parseCopilotConfigHelp(help)).toEqual([
      "copilot-fusion",
      "claude-sonnet-5",
      "gpt-6-luna",
    ]);
    expect(parseCopilotConfigHelp("  `logLevel`: log level\n")).toEqual([]);
  });

  test("droid reads built-in and custom model tables, not option flags", () => {
    const help = [
      "Options:",
      "  -m, --model <id>            Model ID to use",
      "",
      "Available Models:",
      "  auto                         Auto Model",
      "  claude-opus-4-8              Claude Opus 4.8 (default)",
      "",
      "Custom Models:",
      "  custom:gpt-5.5-0             GPT-5.5",
      "",
      "Model details:",
      "  - Auto Model: supports reasoning: No",
    ].join("\n");
    expect(parseDroidExecHelp(help)).toEqual(["auto", "claude-opus-4-8", "custom:gpt-5.5-0"]);
  });

  test("opencode keeps provider-qualified lines only", () => {
    expect(parseOpencodeModels("Loading...\nanthropic/claude-opus-5\n\nopenai/gpt-5.5\n")).toEqual([
      "anthropic/claude-opus-5",
      "openai/gpt-5.5",
    ]);
  });

  test("omp keeps chat model selectors", () => {
    const json = JSON.stringify({
      models: [
        { kind: "chat", selector: "anthropic/claude-fable-5" },
        { kind: "embedding", selector: "openai/text-embedding-3" },
      ],
    });
    expect(parseOmpModels(json)).toEqual(["anthropic/claude-fable-5"]);
  });
});
