import { expect, test } from "bun:test";
import { isoFromMillis, isoFromZoned } from "../src/sources/shared.ts";

test("isoFromMillis rejects null, non-finite, and out-of-range values", () => {
  expect(isoFromMillis(0)).toBe("1970-01-01T00:00:00.000Z");
  expect(isoFromMillis(null)).toBeNull();
  expect(isoFromMillis(Number.NaN)).toBeNull();
  expect(isoFromMillis(8.64e15 + 1)).toBeNull();
});

test("isoFromZoned treats bare stamps as UTC and keeps explicit offsets", () => {
  expect(isoFromZoned("2026-01-02T03:04:05")).toBe("2026-01-02T03:04:05.000Z");
  expect(isoFromZoned("2026-01-02T03:04:05+02:00")).toBe("2026-01-02T01:04:05.000Z");
  expect(isoFromZoned("2026-01-02T03:04:05+0200")).toBe("2026-01-02T01:04:05.000Z");
  expect(isoFromZoned("not a date")).toBeNull();
  expect(isoFromZoned(null)).toBeNull();
});
