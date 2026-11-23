import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readUiSource } from "./ui-source.ts";

const main = readUiSource();
const server = readFileSync(join(import.meta.dir, "..", "src", "server", "sync.ts"), "utf8");

describe("coded UI recovery", () => {
  test("keeps sync failures inline and retries the sync operation", () => {
    expect(main).toContain("const [syncError, setSyncError]");
    expect(main).toContain("setSyncError(err)");
    expect(main).toContain("<ApiFailureState error={syncError} onRetry={runSync} />");
    expect(main).toContain("setLiveConnectionKey((key) => key + 1)");
    expect(main).toContain("Reconnect");
  });

  test("refreshes failed slices on reconnect without replacing healthy data", () => {
    expect(main).toContain("const liveDroppedRef = useRef(false)");
    expect(main).toContain("const failedSlicesRef = useRef<DataSlice[]>([])");
    expect(main).toContain("failedSlicesRef.current = failures");
    expect(main).toMatch(
      /if \(liveDroppedRef\.current\) \{\s*liveDroppedRef\.current = false;\s*if \(failedSlicesRef\.current\.length > 0\) \{\s*requestRefresh\(\);\s*\} else \{\s*setArchiveUpdateAvailable\(true\);/,
    );
    expect(main).toContain("liveDroppedRef.current = true");
    expect(main).toMatch(
      /if \(events\.readyState !== EventSource\.OPEN\) \{\s*setLiveDisconnected\(true\);\s*setLiveConnectionKey\(\(key\) => key \+ 1\);/,
    );
  });

  test("preserves the archive update reason in server events", () => {
    expect(server).toMatch(/type: "archive_updated",\s*reason: "manual"/);
    expect(server).toMatch(/type: "archive_updated",\s*reason: event\.reason/);
  });
});
