import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBusinessTask } from "../business-task-repository.js";
import { initDatabase } from "../../../db/schema.js";
import {
  acknowledgeRequest,
  attachRequestContext,
  createOrGetRequest,
  getRequest,
  listRequests,
  markRequestDelivered,
  markRequestDeliveryFailed,
  persistRequestResult,
} from "../request-repository.js";

describe("request repository", () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "claw-requests-"));
    db = initDatabase(path.join(dir, "registry.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("deduplicates ordinary submissions by source-scoped idempotency key", () => {
    const first = createOrGetRequest(db, {
      instanceSlug: "demo",
      source: "web",
      idempotencyKey: "submit-1",
      traceId: "trace-1",
    });
    const duplicate = createOrGetRequest(db, {
      instanceSlug: "demo",
      source: "web",
      idempotencyKey: "submit-1",
      traceId: "different-trace",
    });

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.request.id).toBe(first.request.id);
    expect(duplicate.request.trace_id).toBe("trace-1");
    expect(listRequests(db, "demo")).toHaveLength(1);
  });

  it.each([
    { instanceSlug: "other" },
    { source: "agent" },
    { sessionId: "other-session" },
    { agentId: "other-agent" },
    { taskId: 99 },
    { parentRequestId: "parent-2" },
  ])("rejects incompatible request identity without changing it: %j", (change) => {
    createOrGetRequest(db, { instanceSlug: "demo", source: "web", requestId: "parent-1" });
    createOrGetRequest(db, { instanceSlug: "demo", source: "web", requestId: "parent-2" });
    const input = {
      instanceSlug: "demo",
      source: "web",
      requestId: "request-1",
      sessionId: "session-1",
      agentId: "main",
      parentRequestId: "parent-1",
    };
    const original = createOrGetRequest(db, input).request;
    expect(() => createOrGetRequest(db, { ...input, ...change })).toThrow();
    expect(getRequest(db, original.id)).toEqual(original);
  });

  it("rejects a key collision from a different session", () => {
    const original = createOrGetRequest(db, {
      instanceSlug: "demo",
      source: "web",
      sessionId: "session-1",
      agentId: "main",
      idempotencyKey: "retry",
    }).request;
    expect(() =>
      createOrGetRequest(db, {
        instanceSlug: "demo",
        source: "web",
        sessionId: "session-2",
        agentId: "main",
        idempotencyKey: "retry",
      }),
    ).toThrow();
    expect(getRequest(db, original.id)).toEqual(original);
    expect(listRequests(db, "demo")).toHaveLength(1);
  });

  it("rejects a parent request owned by another instance", () => {
    const parent = createOrGetRequest(db, { instanceSlug: "other", source: "web" }).request;
    expect(() =>
      createOrGetRequest(db, {
        instanceSlug: "demo",
        source: "agent",
        parentRequestId: parent.id,
      }),
    ).toThrow();
    expect(listRequests(db, "demo")).toHaveLength(0);
  });

  it("does not attach a different session or agent to an existing request", () => {
    const original = createOrGetRequest(db, {
      instanceSlug: "demo",
      source: "web",
      sessionId: "session-1",
      agentId: "main",
    }).request;
    expect(() =>
      attachRequestContext(db, original.id, {
        sessionId: "session-2",
        agentId: "other",
      }),
    ).toThrow();
    expect(getRequest(db, original.id)).toEqual(original);
  });

  it("requires the same business task context for ID retries", () => {
    db.exec(`
      INSERT INTO servers (hostname, openclaw_home) VALUES ('localhost', '/tmp');
      INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit)
        VALUES (1, 'demo', 19001, '/tmp/config', '/tmp/state', 'demo.service');
    `);
    const firstTask = createBusinessTask(db, {
      instanceSlug: "demo",
      objective: "First",
      origin: "HUMAN_REQUEST",
    });
    const secondTask = createBusinessTask(db, {
      instanceSlug: "demo",
      objective: "Second",
      origin: "HUMAN_REQUEST",
    });
    const input = { instanceSlug: "demo", source: "web", requestId: "governed-request" };
    const original = createOrGetRequest(db, { ...input, businessTaskId: firstTask.id }).request;
    expect(() => createOrGetRequest(db, { ...input, businessTaskId: secondTask.id })).toThrow();
    expect(() => createOrGetRequest(db, input)).toThrow();
    expect(createOrGetRequest(db, { ...input, businessTaskId: firstTask.id }).created).toBe(false);
    expect(getRequest(db, original.id)).toEqual(original);
  });

  it("persists a result before delivery and supports failure recovery and acknowledgement", () => {
    const { request } = createOrGetRequest(db, { instanceSlug: "demo", source: "web" });
    persistRequestResult(db, request.id, {
      messageId: "message-1",
      artifactRefs: [{ id: "part-1", type: "tool_result" }],
    });
    expect(getRequest(db, request.id)).toMatchObject({
      delivery_status: "result_persisted",
      result_message_id: "message-1",
    });

    markRequestDeliveryFailed(db, request.id, new Error("connection closed"));
    expect(getRequest(db, request.id)?.delivery_status).toBe("delivery_failed");
    markRequestDelivered(db, request.id);
    expect(getRequest(db, request.id)?.delivery_status).toBe("delivered");
    expect(acknowledgeRequest(db, request.id)?.delivery_status).toBe("acknowledged");
  });

  it("preserves parent lineage and groups successive requests under a task", () => {
    db.exec(`
      INSERT INTO servers (hostname, openclaw_home) VALUES ('localhost', '/tmp');
      INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit)
        VALUES (1, 'demo', 19001, '/tmp/config', '/tmp/state', 'demo.service');
      INSERT INTO rt_tasks (instance_slug, title, status, created_by)
        VALUES ('demo', 'Close', 'pending', 'test');
    `);
    const taskId = Number(db.prepare("SELECT id FROM rt_tasks LIMIT 1").pluck().get());
    const parent = createOrGetRequest(db, { instanceSlug: "demo", source: "web", taskId });
    const child = createOrGetRequest(db, {
      instanceSlug: "demo",
      source: "agent",
      taskId,
      parentRequestId: parent.request.id,
      traceId: parent.request.trace_id,
    });

    const retry = createOrGetRequest(db, {
      instanceSlug: "demo",
      source: "agent",
      taskId,
      requestId: child.request.id,
      parentRequestId: parent.request.id,
    });
    expect(retry.created).toBe(false);
    expect(retry.request.id).toBe(child.request.id);
    expect(() =>
      createOrGetRequest(db, {
        instanceSlug: "demo",
        source: "agent",
        requestId: child.request.id,
        parentRequestId: parent.request.id,
      }),
    ).toThrow();
    expect(child.request.parent_request_id).toBe(parent.request.id);
    expect(child.request.trace_id).toBe(parent.request.trace_id);
    expect(listRequests(db, "demo", { taskId })).toHaveLength(2);
  });
});
