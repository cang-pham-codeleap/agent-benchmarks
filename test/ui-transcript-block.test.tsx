import { describe, expect, test } from "bun:test";
import { TranscriptBlock } from "../src/ui/transcript.tsx";
import type { TranscriptBlockData } from "../src/ui/types.ts";
import { setupDom } from "./ui-dom.ts";

const dom = setupDom();

function block(fields: Partial<TranscriptBlockData>): TranscriptBlockData {
  return {
    ordinal: 0,
    block_type: "text",
    text: null,
    tool_name: null,
    tool_use_id: null,
    tool_input: null,
    tool_result: null,
    ...fields,
  };
}

const longResult = Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n");

describe("transcript blocks", () => {
  test("Dosu tool results stay expanded while other long results collapse", async () => {
    const dosu = await dom.render(
      <TranscriptBlock
        block={block({
          block_type: "tool_result",
          tool_name: "mcp__dosu__read_knowledge",
          tool_result: longResult,
        })}
      />,
    );
    expect(dosu.container.querySelector("details")?.open).toBe(true);
    expect(dosu.container.textContent).toContain("line 199");

    const other = await dom.render(
      <TranscriptBlock
        block={block({ block_type: "tool_result", tool_name: "Bash", tool_result: longResult })}
      />,
    );
    expect(other.container.querySelector("details")?.open).toBe(false);
    expect(other.container.textContent).not.toContain("line 199");
  });

  test("Dosu tool call arguments stay expanded while other long arguments collapse", async () => {
    const toolInput = JSON.stringify({ query: "x".repeat(300) });
    const dosu = await dom.render(
      <TranscriptBlock
        block={block({
          block_type: "tool_use",
          tool_name: "mcp__dosu__search",
          tool_input: toolInput,
        })}
      />,
    );
    expect(dosu.container.querySelector("details")?.open).toBe(true);

    const other = await dom.render(
      <TranscriptBlock
        block={block({
          block_type: "tool_use",
          tool_name: "mcp__linear__search",
          tool_input: toolInput,
        })}
      />,
    );
    expect(other.container.querySelector("details")?.open).toBe(false);
  });

  test("an embedded image payload is summarized, never printed", async () => {
    const data =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { container } = await dom.render(
      <TranscriptBlock
        block={block({
          block_type: "other",
          text: JSON.stringify({
            type: "image",
            source: { type: "base64", media_type: "image/png", data },
          }),
        })}
      />,
    );
    expect(container.textContent).toContain("Embedded image");
    expect(container.textContent).toContain("PNG · 70 B");
    expect(container.textContent).toContain("Payload preserved in the local session log");
    expect(container.textContent).not.toContain(data.slice(0, 20));
  });
});
