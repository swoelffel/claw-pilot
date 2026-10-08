import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import {
  completeExecution,
  createExecution,
  getExecution,
  getExecutionAnalytics,
  inspectCircuit,
  recordBusinessOutcome,
  recordCircuitFailure,
  recordCircuitSuccess,
  recoverStaleExecutions,
  startExecution,
} from "../execution-repository.js";

describe("execution repository", () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "claw-executions-"));
    db = initDatabase(path.join(dir, "registry.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("tracks a request through completion and business outcome", () => {
    const execution = createExecution(db, {
      instanceSlug: "demo",
      sessionId: "session-1",
      agentId: "main",
      timeoutMs: 10_000,
    });
    expect(execution.status).toBe("accepted");

    startExecution(db, execution.id);
    completeExecution(db, execution.id, {
      messageId: "message-1",
      inputTokens: 120,
      outputTokens: 30,
      costUsd: 0.02,
    });
    recordBusinessOutcome(db, execution.id, "useful", 50);

    const completed = getExecution(db, execution.id)!;
    expect(completed).toMatchObject({
      status: "succeeded",
      result_message_id: "message-1",
      input_tokens: 120,
      output_tokens: 30,
      outcome: "useful",
      outcome_value: 50,
    });
    expect(getExecutionAnalytics(db, "demo")).toMatchObject({
      total: 1,
      succeeded: 1,
      useful: 1,
      cost_usd: 0.02,
      outcome_value: 50,
    });
  });

  it("recovers executions whose heartbeat exceeded their timeout", () => {
    const execution = createExecution(db, {
      instanceSlug: "demo",
      sessionId: "session-1",
      agentId: "main",
      timeoutMs: 1,
    });
    startExecution(db, execution.id);
    db.prepare(
      "UPDATE rt_executions SET heartbeat_at = datetime('now', '-2 minutes') WHERE id = ?",
    ).run(execution.id);

    expect(recoverStaleExecutions(db, "demo", 0)).toBe(1);
    expect(getExecution(db, execution.id)).toMatchObject({
      status: "timed_out",
      error_code: "EXECUTION_STALE",
    });
  });

  it("opens a failing resource circuit and closes it after success", () => {
    const key = "provider:openai/gpt-test";
    recordCircuitFailure(db, "demo", key, new Error("down"), { threshold: 2 });
    expect(inspectCircuit(db, "demo", key)?.state).toBe("closed");
    recordCircuitFailure(db, "demo", key, new Error("still down"), { threshold: 2 });
    expect(inspectCircuit(db, "demo", key)?.state).toBe("open");

    recordCircuitSuccess(db, "demo", key);
    expect(inspectCircuit(db, "demo", key)).toMatchObject({ state: "closed", failure_count: 0 });
  });
});
