import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import { appendExecutionEvent, listExecutionEventsAfter } from "../execution-event-repository.js";
import {
  canAutomaticallyRetry,
  createOperation,
  finishOperation,
  startOperation,
} from "../operation-repository.js";

describe("EP-02 recovery repositories", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    db.prepare(
      `INSERT INTO rt_requests (id, trace_id, instance_slug) VALUES ('r1', 't1', 'demo')`,
    ).run();
  });
  afterEach(() => db.close());

  it("replays request events monotonically after a durable cursor", () => {
    const first = appendExecutionEvent(db, {
      request_id: "r1",
      execution_id: null,
      trace_id: "t1",
      instance_slug: "demo",
      session_id: "s1",
      event_type: "session.status",
      payload: { status: "busy" },
    });
    const second = appendExecutionEvent(db, {
      request_id: "r1",
      execution_id: null,
      trace_id: "t1",
      instance_slug: "demo",
      session_id: "s1",
      event_type: "session.status",
      payload: { status: "idle" },
    });

    expect(second).toBeGreaterThan(first);
    expect(listExecutionEventsAfter(db, "demo", first).map((event) => event.id)).toEqual([second]);
  });

  it("only retries safely failed read-only or idempotent operations", () => {
    const safe = createOperation(db, {
      requestId: "r1",
      operationType: "lookup",
      idempotencyMode: "read_only",
    });
    startOperation(db, safe.id);
    finishOperation(db, safe.id, "failed_safely", { code: "TIMEOUT" });
    const safeRow = db
      .prepare("SELECT * FROM rt_operations WHERE id = ?")
      .get(safe.id) as typeof safe;
    expect(canAutomaticallyRetry(safeRow)).toBe(true);

    const unsafe = { ...safeRow, state: "uncertain" as const, idempotency_mode: "unsafe" as const };
    expect(canAutomaticallyRetry(unsafe)).toBe(false);
  });
});
