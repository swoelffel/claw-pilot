import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../db/schema.js";
import {
  getActiveAlerts,
  getObservabilityMetrics,
  getRetention,
  listTrace,
  recordObservabilityEvent,
  setRetention,
} from "../observability-repository.js";

describe("observability repository", () => {
  let db: Database.Database;
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-observability-"));
    db = initDatabase(path.join(dir, "test.db"));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("builds trace timelines and percentile metrics with activity attribution", () => {
    for (const [durationMs, activityKind] of [
      [10, "human_request"],
      [20, "human_request"],
      [100, "child_agent"],
    ] as const) {
      recordObservabilityEvent(db, {
        instanceSlug: "demo",
        eventName: "execution.completed",
        eventKind: "span",
        traceId: "trace-1",
        activityKind,
        durationMs,
        costUsd: 0.01,
        success: true,
      });
    }
    const human = getObservabilityMetrics(db, "demo", 30, "human_request");
    expect(human.event_count).toBe(2);
    expect(human.latency_ms).toEqual({ p50: 10, p95: 20, p99: 20 });
    expect(listTrace(db, "demo", "trace-1")).toHaveLength(3);
  });

  it("alerts immediately for delivery failures and keeps retention classes independent", () => {
    recordObservabilityEvent(db, {
      instanceSlug: "demo",
      eventName: "delivery.failed",
      eventKind: "error",
      traceId: "trace-2",
      errorCode: "DELIVERY_FAILED",
      retryable: true,
    });
    expect(getActiveAlerts(db, "demo")).toHaveLength(1);
    expect(getRetention(db, "demo")).toMatchObject({ traces: 30, metrics: 395 });
    setRetention(db, "demo", { traces: 14 });
    expect(getRetention(db, "demo")).toMatchObject({ traces: 14, metrics: 395 });
  });
});
