import { describe, expect, test } from "bun:test";
import { isDosuServer } from "../src/dosu.ts";

describe("Dosu MCP evidence", () => {
  test("accepts the confirmed normalized server IDs", () => {
    expect(isDosuServer("dosu")).toBe(true);
    expect(isDosuServer("claude_ai_Dosu")).toBe(true);
  });

  test("does not accept broad name matches or missing server evidence", () => {
    expect(isDosuServer("my-dosu-proxy")).toBe(false);
    expect(isDosuServer("Dosu")).toBe(false);
    expect(isDosuServer(null)).toBe(false);
  });
});
