import { describe, expect, test } from "bun:test";
import { readUiFile } from "./ui-source.ts";

describe("responsive UI behavior", () => {
  test("shows one search trigger at each screen size", () => {
    const shell = readUiFile("main.tsx");
    expect(shell).toMatch(/aria-label="Open command palette"[^>]*className="hidden[^\"]*md:inline-flex/);
    expect(shell).toMatch(/aria-label="Search"[^>]*className="md:hidden"/);
  });

  test("uses the mobile sidebar below the desktop breakpoint", () => {
    const sidebar = readUiFile("components/ui/sidebar.tsx");
    expect(sidebar).toContain("if (isMobile)");
    expect(sidebar).toContain("hidden text-sidebar-foreground md:block");
    expect(sidebar).toContain("md:flex");
  });

  test("hides optional session columns until their container has room", () => {
    const sessions = readUiFile("views/sessions.tsx");
    expect(sessions).toContain("hidden @min-[1448px]:table-cell");
    expect(sessions).toContain("hidden @min-[1196px]:table-cell");
  });

  test("keeps transcript and palette content scrollable or wrapped", () => {
    expect(readUiFile("transcript-markdown.tsx")).toContain("whitespace-pre-wrap break-words");
    expect(readUiFile("components/ui/command.tsx")).toContain("overflow-y-auto");
    expect(readUiFile("command-palette-view.tsx")).toContain("max-h-[60vh]");
  });
});
