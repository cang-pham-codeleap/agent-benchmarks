import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db.ts";
import { joinSessionCost, sessionActiveMs } from "../src/eval/cost.ts";

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

test("agent time starts at the accepted prompt, not at CLI startup", () => {
  const dir = mkdtempSync(join(tmpdir(), "ab-cost-"));
  const db = openDb(join(dir, "archive.db"));
  try {
    const id = Number(
      db
        .query(
          "INSERT INTO session (tool, source_session_id, started_at) VALUES ('copilot', 's1', '2026-11-23T05:45:52.000Z')",
        )
        .run().lastInsertRowid,
    );
    const insert = db.query(
      "INSERT INTO message (session_id, seq, role, timestamp, raw) VALUES (?1, ?2, ?3, ?4, '{}')",
    );
    insert.run(id, 0, "system", "2026-11-23T05:45:59.000Z");
    insert.run(id, 1, "user", "2026-11-23T05:46:00.000Z");
    insert.run(id, 2, "assistant", "2026-11-23T05:46:30.000Z");
    insert.run(id, 3, "user", "2026-11-23T05:46:31.000Z");
    insert.run(id, 4, "assistant", "2026-11-23T05:47:00.000Z");
    expect(sessionActiveMs(db, id)).toBe(60_000);
    expect(sessionActiveMs(db, id + 1)).toBeNull();
  } finally {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  }
});
