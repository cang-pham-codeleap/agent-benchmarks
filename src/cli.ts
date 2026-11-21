#!/usr/bin/env bun
import { Command } from "commander";
import { registerCompletionCommand } from "./cli/commands/completion.ts";
import { registerDbCommands } from "./cli/commands/db.ts";
import { registerDistillCommands } from "./cli/commands/distill.ts";
import { registerDoctorCommand } from "./cli/commands/doctor.ts";
import { registerExportCommand } from "./cli/commands/export.ts";
import { registerProjectCommands } from "./cli/commands/project.ts";
import { registerRecommendationsCommands } from "./cli/commands/recommendations.ts";
import { registerServiceCommands } from "./cli/commands/service.ts";
import { registerSessionCommands } from "./cli/commands/session.ts";
import { registerStatsCommands } from "./cli/commands/stats.ts";
import { registerSyncCommands } from "./cli/commands/sync.ts";
import { type CliResult, type CliRunOptions, createContext, type Io } from "./cli/context.ts";
import {
  argvRequestsJson,
  CliError,
  fromCommanderError,
  toCliError,
  usageError,
} from "./cli/errors.ts";
import { installHelp } from "./cli/help.ts";
import { assertFormatSupported, installValueValidation, parseOutputFormat } from "./cli/parse.ts";
import { configureLogging } from "./logging.ts";
import { AGENT_BENCHMARKS_VERSION } from "./version.ts";

export type { CliResult, CliRunOptions };

export function defaultArgv(argv: string[]): string[] {
  return argv.length === 0 ? ["serve"] : argv;
}

export async function runCli(argv: string[], options: CliRunOptions = {}): Promise<CliResult> {
  const streamOutput = options.liveOutput === true;
  const io: Io = {
    stdout: "",
    stderr: "",
    writeOut(value) {
      if (streamOutput) {
        (options.writeStdout ?? ((chunk) => process.stdout.write(chunk)))(value);
      } else {
        this.stdout += value;
      }
    },
    writeErr(value) {
      if (streamOutput) {
        (options.writeStderr ?? ((chunk) => process.stderr.write(chunk)))(value);
      } else {
        this.stderr += value;
      }
    },
  };
  let code = 0;
  const setCode = (value: number): void => {
    if (code === 0 || value !== 0) {
      code = value;
    }
  };

  const program = new Command();
  program
    .name("agent-benchmarks")
    .description(
      "analyze Claude Code, Codex, Gemini CLI, OpenCode, Cursor CLI, GitHub Copilot CLI, Copilot Chat in VS Code, Hermes Agent, and Pi sessions: tokens, context windows, and cost",
    )
    .version(AGENT_BENCHMARKS_VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (value) => io.writeOut(value),
      writeErr: (value) => io.writeErr(value),
      // Commander's errors are printed below, where --json can reshape them.
      outputError: () => undefined,
    })
    .option(
      "--db <path>",
      "path to the Agent Benchmarks SQLite database (read commands never create it)",
    )
    .option("--json", "emit machine-readable JSON")
    .option(
      "--format <format>",
      "output format (table | json | md); md only where a command prints Markdown",
      parseOutputFormat,
    )
    .option("-q, --quiet", "suppress non-essential output")
    .option("--no-color", "disable ANSI color")
    .option("--no-sync", "skip sync-on-read, and serve without the source watcher");

  const ctx = createContext(program, io, options, setCode);
  registerSyncCommands(ctx);
  registerSessionCommands(ctx);
  registerProjectCommands(ctx);
  registerDbCommands(ctx);
  registerDistillCommands(ctx);
  registerRecommendationsCommands(ctx);
  registerCompletionCommand(ctx);
  registerStatsCommands(ctx);
  registerExportCommand(ctx);

  registerDoctorCommand(ctx);
  registerServiceCommands(ctx);
  installValueValidation(program);
  installHelp(program);

  program.hook("preAction", (_root, actionCommand) => {
    assertFormatSupported(commandPath(actionCommand), ctx.globals().format);
  });

  try {
    await program.parseAsync(defaultArgv(argv), { from: "user" });
  } catch (error) {
    const json = ctx.isJson() || argvRequestsJson(argv);
    if (error instanceof CliError || !isCommanderExit(error)) {
      setCode(ctx.fail(toCliError(error), json));
    } else if (HELP_EXITS.has(error.code ?? "")) {
      const exitCode = commanderExitCode(error);
      if (exitCode !== 0 && json) {
        ctx.fail(usageError("usage_error", "a subcommand is required; see the help above"), json);
      }
      setCode(exitCode);
    } else {
      ctx.fail(fromCommanderError(error), json);
      setCode(commanderExitCode(error));
    }
  }
  return { code, stdout: io.stdout, stderr: io.stderr };
}

interface CommanderExit {
  exitCode: number;
  code?: string;
  message?: string;
}

// Commander has already written the help or version text for these.
const HELP_EXITS = new Set(["commander.help", "commander.helpDisplayed", "commander.version"]);

function isCommanderExit(error: unknown): error is CommanderExit {
  return typeof error === "object" && error !== null && "exitCode" in error;
}

function commandPath(command: Command): string {
  const names: string[] = [];
  for (let current = command; current.parent != null; current = current.parent) {
    names.unshift(current.name());
  }
  return names.join(" ");
}

function commanderExitCode(error: { exitCode: number; code?: string }): number {
  if (error.exitCode === 1 && error.code?.startsWith("commander.") === true) {
    return 2;
  }
  return Number(error.exitCode);
}

if (import.meta.main) {
  configureLogging({ level: process.env.AGENT_BENCHMARKS_LOG_LEVEL });
  const result = await runCli(process.argv.slice(2), { liveOutput: true });
  process.exitCode = result.code;
}
