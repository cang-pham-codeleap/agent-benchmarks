import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db.ts";
import { joinSessionCost } from "../src/eval/cost.ts";

test("a hermetic cell joins the session the agent recorded in its temp copy", () => {
  const dir = mkdtempSync(join(tmpdir(), "ab-cost-"));
  const db = openDb(join(dir, "archive.db"));
  try {
    const startedAt = Date.parse("2026-11-20T16:10:47.000Z");
    const id = Number(
      db
        .query(
          "INSERT INTO session (tool, source_session_id, cwd, started_at) VALUES ('omp', 'omp-native', ?1, ?2)",
        )
        .run("/tmp/ab-hermetic/run/cell-1", new Date(startedAt + 500).toISOString())
        .lastInsertRowid,
    );
    const joined = joinSessionCost(db, "omp", {
      runId: "r1",
      sessionId: "omp-ach-generated",
      cwd: join(dir, "ledger.work", "cell-1"),
      hermetic: { tempDir: "/private/tmp/ab-hermetic/run/cell-1" },
      startedAt,
      updatedAt: startedAt + 13_000,
    });
    expect(joined.session?.id).toBe(id);
  } finally {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
