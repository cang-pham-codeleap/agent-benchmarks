import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/ui/api.ts";
import { ApiFailureState } from "../src/ui/api-failure.tsx";
import { copyTextToClipboard } from "../src/ui/clipboard.ts";
import { byText, click, flush, setupDom } from "./ui-dom.ts";

const dom = setupDom();
const RAW = "SqliteError: database disk image is malformed at /Users/dev/.agent-benchmarks";

function failure(status: number, code: string, extras: Record<string, unknown> = {}) {
  return new ApiError(status, code, RAW, extras);
}

async function renderFailure(error: unknown) {
  const calls = { retry: 0, sync: 0 };
  const { container } = await dom.render(
    <ApiFailureState
      error={error}
      onRetry={() => {
        calls.retry += 1;
      }}
      onSync={() => {
        calls.sync += 1;
      }}
    />,
  );
  return { calls, container };
}

describe("coded API failures", () => {
  test("every server code maps to recovery copy without the raw exception message", async () => {
    const titles: Record<string, string> = {
      session_not_found: "Session not found",
      schema_too_new: "Agent Benchmarks is out of date",
      schema_too_old: "Session log index rebuild required",
      launch_unsupported_platform: "Native launch is unavailable",
      launch_failed: "Launch failed",
      archive_locked: "Session logs are busy",
      internal_error: "Agent Benchmarks could not complete the request",
    };
    for (const [code, title] of Object.entries(titles)) {
      const { container } = await renderFailure(failure(500, code));
      const alert = container.querySelector('[role="alert"]');
      expect(alert?.querySelector("h3")?.textContent).toBe(title);
      expect(container.textContent).not.toContain(RAW);
      container.remove();
    }
  });

  test("retryable failures retry the failed request and name the private diagnostic", async () => {
    const { calls, container } = await renderFailure(failure(500, "internal_error"));
    expect(container.textContent).toContain("Restart `agent-benchmarks serve`");
    expect(container.textContent).toContain("private diagnostic");
    await click(byText(container, "button", "Retry"));
    expect(calls.retry).toBe(1);
  });

  test("a missing session links back to the list and offers a sync", async () => {
    const { calls, container } = await renderFailure(failure(404, "session_not_found"));
    expect(byText(container, "a", "Back to sessions")?.getAttribute("href")).toBe("/sessions");
    await click(byText(container, "button", "Sync now"));
    expect(calls.sync).toBe(1);
    expect(byText(container, "button", "Retry")).toBeNull();
  });

  test("a stale schema offers no retry and no settings detour", async () => {
    const { container } = await renderFailure(failure(409, "schema_too_old"));
    expect(container.querySelector('a[href="/settings"]')).toBeNull();
    expect(byText(container, "button", "Retry")).toBeNull();
  });

  test("an unavailable native launch shows the command and copies it", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
    const { container } = await renderFailure(
      failure(501, "launch_unsupported_platform", { command: "codex resume 42" }),
    );
    expect(container.querySelector("code")?.textContent).toBe("codex resume 42");
    await click(byText(container, "button", "Copy"));
    await flush();
    expect(copied).toEqual(["codex resume 42"]);
    expect(byText(container, "button", "Copied")).not.toBeNull();
  });
});

describe("copyTextToClipboard", () => {
  test("falls back to a hidden textarea copy when the clipboard API is missing", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const copied: string[] = [];
    document.execCommand = (command: string) => {
      const field = document.querySelector("textarea");
      copied.push(`${command}:${field?.value}`);
      return true;
    };
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    await copyTextToClipboard("prompt text");

    expect(copied).toEqual(["copy:prompt text"]);
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test("rejects when neither path can copy", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = () => false;
    await expect(copyTextToClipboard("prompt text")).rejects.toThrow(
      "Clipboard access is unavailable.",
    );
  });
});
