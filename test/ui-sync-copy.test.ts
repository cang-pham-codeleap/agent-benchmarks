import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readUiFile, readUiSource } from "./ui-source.ts";

const root = join(import.meta.dir, "..");
const main = readUiSource();
const globals = readFileSync(join(root, "src", "ui", "globals.css"), "utf8");

test("sync stays visually icon-led while retaining a hidden live announcement", () => {
  expect(main).toContain('archiveUpdateAvailable ? "Load new activity" : "Sync session logs"');
  expect(main).toContain('"Syncing session logs"');
  expect(main).not.toContain("Sync in progress");
  expect(main).not.toContain("Syncing…");
  expect(main).not.toContain("Synced ·");
  expect(main).not.toContain('? "Synced" : "Sync"');
  expect(main).toContain("const LIVE_DISCONNECT_GRACE_MS = 15_000");
  expect(main).toContain('label={archiveUpdateAvailable ? "Update" : "Sync"}');
  expect(main).toContain('const TOPBAR_SYNC_LABELS = ["Sync", "Update"] as const;');
  expect(main).toContain("archiveUpdateAvailable ? loadArchiveUpdates : runSync");
  expect(main).toContain('className="sr-only"');
  expect(globals).toContain('@import "tailwindcss"');
});

test("a held Sessions refresh resumes when the reader scrolls back or the tab returns", () => {
  expect(main).toContain('window.addEventListener("scroll", resume, { passive: true });');
  expect(main).toContain('document.addEventListener("visibilitychange", resume);');
  expect(main).toContain("onTextFilterChange?.(textFilterActive);");
});

test("sync progress is visible without a second live announcement", () => {
  const shell = readUiFile("main.tsx");
  expect(shell).toContain(
    "<SyncProgressLine complete={syncCompleteShown} progress={syncProgress} />",
  );
  expect(shell).toContain("<SyncProgressNotice");
  expect(shell.match(/aria-live=/g)).toHaveLength(1);
  expect(shell).toContain("? syncAnnouncement(syncProgress)");
  expect(readUiFile("sync-progress.tsx")).not.toContain("aria-live");
  expect(readUiFile("sync-progress.tsx")).toContain("motion-reduce:animate-none");
});

test("the sidebar never states partial or unloaded totals as facts", () => {
  const shell = readUiFile("main.tsx");
  expect(shell).not.toContain("metrics?.sessions ?? 0");
  expect(shell).not.toContain("metrics?.estimated_cost_usd ?? 0");
  expect(shell).toContain("Totals after the first sync");
  expect(shell).toContain("const firstSync = localSyncing && !archiveSynced;");
});
