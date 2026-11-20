import { basename, dirname, isAbsolute, resolve } from "node:path";
import { asString, isObject } from "../json.ts";
import type { ParsedSession } from "../model.ts";
import { parsePiSession } from "./pi.ts";
import { parseSourceJson } from "./shared.ts";

export function parseOmpSession(fallbackId: string, content: string, sourcePath: string): ParsedSession {
  let parentPath: string | null = null;
  for (const line of content.split("\n")) {
    try {
      const header = parseSourceJson(line);
      if (isObject(header) && header.type === "session") {
        parentPath = asString(header.parentSession);
        break;
      }
    } catch {}
  }
  const layoutParent = `${dirname(sourcePath)}.jsonl`;
  const headerParent = parentPath != null && isAbsolute(parentPath) && parentPath.endsWith(".jsonl")
    ? resolve(parentPath)
    : null;
  const isSubagent =
    headerParent === resolve(layoutParent) ||
    dirname(sourcePath).split(/[\\/]/).some((part) => /^\d{4}-.*_/.test(part));
  const parsed = parsePiSession(fallbackId, content, { omp: true, isSubagent });
  parsed.session.tool = "omp";
  if (isSubagent) {
    const agentId = basename(sourcePath, ".jsonl");
    parsed.session.isSubagent = true;
    parsed.session.agentId = agentId;
    parsed.session.agentType = agentId === "__advisor" || agentId.startsWith("__advisor.") ? "advisor" : "subagent";
    parsed.session.rawMeta = {
      ...(isObject(parsed.session.rawMeta) ? parsed.session.rawMeta : {}),
      parentSessionPath: headerParent ?? resolve(layoutParent),
    };
  }
  return parsed;
}
