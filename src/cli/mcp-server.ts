// Cyclic with src/cli.ts, but runCli is only called after both modules have loaded. A dynamic
// import would deadlock: the entry module is still awaiting runCli when serve runs.
import { runCli } from "../cli.ts";
import { DIMENSIONS } from "../stats.ts";
import { AGENT_BENCHMARKS_VERSION } from "../version.ts";

interface InputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: InputSchema;
  command: string[];
  positional?: string;
}

const str = (description: string) => ({ type: "string", description });
const int = (description: string, minimum: number) => ({ type: "integer", minimum, description });
const day = (description: string) => str(`${description} (YYYY-MM-DD, UTC)`);
const schema = (properties: Record<string, unknown>, required: string[] = []): InputSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const TOOLS: McpTool[] = [
  {
    name: "search_sessions",
    description:
      "Full-text search across archived agent sessions. Returns matching session ids with snippets.",
    inputSchema: schema(
      {
        query: str("FTS query"),
        tool: str("only this source tool, e.g. claude_code or codex"),
        project: str("only this project directory"),
        repo: str("only this repository and its worktrees: a path, remote, or name"),
        since: day("only sessions started on or after this day"),
        until: day("only sessions started on or before this day"),
        limit: int("max rows", 1),
        offset: int("skip this many rows", 0),
      },
      ["query"],
    ),
    command: ["search"],
    positional: "query",
  },
  {
    name: "list_sessions",
    description: "List archived agent sessions, newest first, with their ids, tools, and models.",
    inputSchema: schema({
      tool: str("only this source tool, e.g. claude_code or codex"),
      model: str("only this model"),
      project: str("only this project directory"),
      repo: str("only this repository and its worktrees: a path, remote, or name"),
      since: day("only sessions started on or after this day"),
      until: day("only sessions started on or before this day"),
      include_subagents: { type: "boolean", description: "include nested subagent sessions" },
      limit: int("max rows", 1),
      offset: int("skip this many rows", 0),
    }),
    command: ["ls"],
  },
  {
    name: "show_session",
    description:
      "Show one session's transcript. Transcripts can be huge: call with outline=true first to see each message's role, size, and tools, then read pages with limit, offset, and max_chars.",
    inputSchema: schema(
      {
        id: str("archive session id, or the source tool's own session id"),
        outline: { type: "boolean", description: "list message roles, sizes, and tool names only" },
        limit: int("messages to show", 1),
        offset: int("messages to skip before the first one shown", 0),
        max_chars: int("truncate each text block to this many characters", 1),
      },
      ["id"],
    ),
    command: ["show"],
    positional: "id",
  },
  {
    name: "usage_stats",
    description: "Session, token, and cost totals for the archive, or rolled up by one dimension.",
    inputSchema: schema({ by: { type: "string", enum: [...DIMENSIONS], description: "group by" } }),
    command: ["stats"],
  },
];

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type Json = Record<string, unknown>;
type Reply = { result: unknown } | { error: { code: number; message: string } };

export interface McpServerOptions {
  db?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string | null;
}

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rpcError = (code: number, message: string): Reply => ({ error: { code, message } });

function toArgv(tool: McpTool, args: Json, db: string | undefined): string[] {
  const flags: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (
      key === tool.positional ||
      !Object.hasOwn(tool.inputSchema.properties, key) ||
      value == null ||
      value === false
    ) {
      continue;
    }
    const flag = `--${key.replaceAll("_", "-")}`;
    flags.push(...(value === true ? [flag] : [flag, String(value)]));
  }
  const positional = tool.positional == null ? undefined : args[tool.positional];
  return [
    "--json",
    "--no-sync",
    ...(db == null ? [] : ["--db", db]),
    ...tool.command,
    ...flags,
    ...(positional == null ? [] : ["--", String(positional)]),
  ];
}

async function callTool(params: unknown, options: McpServerOptions): Promise<Reply> {
  const tool = isObject(params) ? TOOLS.find((item) => item.name === params.name) : undefined;
  if (!isObject(params) || tool == null) {
    return rpcError(-32602, "unknown tool name");
  }
  const args = params.arguments ?? {};
  if (!isObject(args)) {
    return rpcError(-32602, "arguments must be an object");
  }
  const result = await runCli(toArgv(tool, args, options.db), {
    env: options.env,
    homeDir: options.homeDir,
  });
  if (result.code === 0) {
    return { result: { content: [{ type: "text", text: result.stdout }], isError: false } };
  }
  const stderr = result.stderr.trimEnd();
  const text = stderr.split("\n").at(-1) || stderr;
  return { result: { content: [{ type: "text", text }], isError: true } };
}

async function handle(message: unknown, options: McpServerOptions): Promise<Json | null> {
  if (!isObject(message)) {
    return { jsonrpc: "2.0", id: null, ...rpcError(-32600, "invalid request") };
  }
  if (!("id" in message)) {
    return null;
  }
  const reply = await dispatch(message.method, message.params, options);
  return { jsonrpc: "2.0", id: message.id, ...reply };
}

async function dispatch(
  method: unknown,
  params: unknown,
  options: McpServerOptions,
): Promise<Reply> {
  switch (method) {
    case "initialize": {
      const requested = isObject(params) ? params.protocolVersion : undefined;
      return {
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested as string)
            ? requested
            : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "agent-benchmarks", version: AGENT_BENCHMARKS_VERSION },
        },
      };
    }
    case "ping":
      return { result: {} };
    case "tools/list":
      return {
        result: {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        },
      };
    case "tools/call":
      return callTool(params, options);
    default:
      return rpcError(-32601, `method not found: ${String(method)}`);
  }
}

async function handleLine(line: string, options: McpServerOptions): Promise<Json | null> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return { jsonrpc: "2.0", id: null, ...rpcError(-32700, "parse error") };
  }
  return handle(message, options);
}

export async function serveMcp(options: McpServerOptions): Promise<void> {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  const processLine = async (line: string): Promise<void> => {
    if (line.trim() === "") {
      return;
    }
    const reply = await handleLine(line, options);
    if (reply != null) {
      process.stdout.write(`${JSON.stringify(reply)}\n`);
    }
  };
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await processLine(line);
      newline = buffer.indexOf("\n");
    }
  }
  await processLine(buffer);
}
