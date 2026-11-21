import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { linkageIssues } from "../diagnostics.ts";
import { asInteger, asString, get, isObject } from "../json.ts";
import {
  emptyUsage,
  type Json,
  type NormalizedBlock,
  type NormalizedMessage,
  type ParsedSession,
  recordedReasoningEffort,
} from "../model.ts";
import { preview } from "../tools.ts";
import {
  block,
  contentText,
  countUnknown,
  parseJsonLine,
  parseSourceJson,
  type UnknownTypes,
  unknownTypeIssues,
} from "./shared.ts";

export function parseDroidSession(
  fallbackId: string,
  content: string,
  settingsContent: string | null,
  globalSettingsContent?: string | null,
): ParsedSession {
  const issues: ParsedSession["issues"] = [];
  const unknown: UnknownTypes = new Map();
  const messages: NormalizedMessage[] = [];
  let settings: Json = null;
  if (settingsContent != null) {
    try {
      settings = parseSourceJson(settingsContent);
    } catch {
      issues.push({
        code: "unparsed_line",
        lineNo: null,
        error: "Droid settings are not valid JSON",
        rawLine: null,
      });
    }
  }
  const model = asString(get(settings, "model"));
  let provider: string | null = null;
  if (model?.startsWith("custom:")) {
    try {
      const globalSettings = parseSourceJson(
        globalSettingsContent === undefined
          ? readFileSync(join(homedir(), ".factory", "settings.json"), "utf8")
          : (globalSettingsContent ?? "null"),
      );
      const customModels = get(globalSettings, "customModels");
      if (Array.isArray(customModels)) {
        const matches = customModels.filter((item) => asString(get(item, "id")) === model);
        if (matches.length === 1) {
          provider = asString(get(matches[0], "provider"))?.trim().toLowerCase() || null;
        }
      }
    } catch {}
  }
  const effort = recordedReasoningEffort(get(settings, "reasoningEffort"));
  const usage = get(settings, "tokenUsage");
  const number = (key: string) => Math.max(0, asInteger(get(usage, key)) ?? 0);
  const totals = {
    ...emptyUsage(),
    input: number("inputTokens"),
    output: number("outputTokens"),
    cacheRead: number("cacheReadTokens"),
    cacheCreation: number("cacheCreationTokens"),
    reasoning: number("thinkingTokens"),
  };
  let sourceSessionId = fallbackId;
  let cwd: string | null = null;
  let title: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let header: Json = null;
  for (const [index, line] of content.split(/\n/).entries()) {
    const entry = parseJsonLine(line, index + 1, issues);
    if (entry === undefined) continue;
    if (!isObject(entry)) {
      countUnknown(unknown, "entry.non_object", index + 1);
      continue;
    }
    const typ = asString(entry.type);
    if (typ === "session_start") {
      header = entry;
      sourceSessionId = asString(entry.id) ?? fallbackId;
      cwd = asString(entry.cwd);
      title = asString(entry.title);
      continue;
    }
    if (typ === "todo_state" || typ === "session_end") continue;
    if (typ !== "message" || !isObject(entry.message)) {
      countUnknown(unknown, typ ?? "entry.untyped", index + 1);
      continue;
    }
    const message = entry.message;
    const timestamp = asString(entry.timestamp);
    if (timestamp != null) {
      if (startedAt == null || timestamp < startedAt) startedAt = timestamp;
      if (endedAt == null || timestamp > endedAt) endedAt = timestamp;
    }
    const role =
      message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : "other";
    const blocks: NormalizedBlock[] = [];
    const contentItems: Json[] = Array.isArray(message.content)
      ? message.content
      : typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : [];
    for (const item of contentItems) {
      if (!isObject(item)) continue;
      if (item.type === "text" || item.type === "thinking") {
        blocks.push(
          block(blocks.length, item.type === "text" ? "text" : "thinking", {
            text: asString(item.text) ?? asString(item.thinking),
          }),
        );
      } else if (item.type === "tool_use") {
        blocks.push(
          block(blocks.length, "tool_use", {
            toolName: asString(item.name),
            toolUseId: asString(item.id),
            toolInput: item.input,
          }),
        );
      } else if (item.type === "tool_result") {
        blocks.push(
          block(blocks.length, "tool_result", {
            toolUseId: asString(item.tool_use_id),
            toolResult: contentText(item.content),
            isError: item.is_error === true,
          }),
        );
      }
    }
    if (title == null && role === "user") {
      const text = blocks.find((item) => item.blockType === "text")?.text;
      if (text) title = preview(text.trim(), 120);
    }
    messages.push({
      seq: messages.length,
      sourceUuid: asString(entry.id),
      parentSourceUuid: asString(entry.parentId),
      role,
      model: role === "assistant" ? (asString(message.modelId) ?? model) : null,
      stopReason: null,
      timestamp,
      usage: null,
      raw: entry,
      blocks,
    });
  }
  issues.push(...unknownTypeIssues(unknown, "ignored"));
  const session: ParsedSession["session"] = {
    tool: "droid",
    sourceSessionId,
    projectPath: cwd,
    title,
    cwd,
    gitBranch: null,
    model,
    provider,
    reasoningEffort: effort,
    reasoningEffortLevels: effort == null ? [] : [effort],
    cliVersion: null,
    startedAt,
    endedAt,
    isArchived: false,
    isSubagent: false,
    rootSourceSessionId: null,
    spawnToolUseId: null,
    agentId: null,
    agentType: null,
    spawnDepth: null,
    rawMeta: { header, settings, modelAlias: model?.startsWith("custom:") === true },
    totals,
    estReasoningTokens: 0,
    reasoningSource: totals.reasoning > 0 ? "reported" : "none",
    messages,
  };
  issues.push(...linkageIssues(session));
  return { session, issues };
}
