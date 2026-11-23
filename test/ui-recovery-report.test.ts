import { describe, expect, test } from "bun:test";
import { readUiSource } from "./ui-source.ts";

const main = readUiSource();

describe("coded UI recovery", () => {
  test("keeps sync failures inline and retries the sync operation", () => {
    expect(main).toContain("<ApiFailureState error={syncError} onRetry={runSync} />");
    expect(main).toContain("setLiveConnectionKey((key) => key + 1)");
    expect(main).toContain("Reconnect");
  });

  test("refreshes failed slices on reconnect without replacing healthy data", () => {
    expect(main).toContain("const failedSlicesRef = useRef<DataSlice[]>([])");
    expect(main).toContain("failedSlicesRef.current = failures");
    expect(main).toMatch(
      /if \(events\.readyState !== EventSource\.OPEN\) \{\s*setLiveDisconnected\(true\);\s*setLiveConnectionKey\(\(key\) => key \+ 1\);/,
    );
  });
});
