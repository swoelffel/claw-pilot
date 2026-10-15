import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Registry } from "../../core/registry.js";
import { initDatabase } from "../../db/schema.js";
import {
  acknowledgeRequest,
  createOrGetRequest,
  getRequest,
  markRequestDeliveryFailed,
  persistRequestResult,
} from "../../core/repositories/request-repository.js";
import { createSession } from "../../runtime/session/session.js";
import { createAssistantMessage, updateMessageMetadata } from "../../runtime/session/message.js";
import { createPart } from "../../runtime/session/part.js";
import { disposeBus } from "../../runtime/bus/index.js";
import { instanceMiddleware } from "../routes/_instance-middleware.js";
import { registerExecutionRoutes } from "../routes/instances/executions.js";
import type { RouteDeps } from "../route-deps.js";
import { registerPermissionChecker, resetPermissionChecker } from "../middleware/permission.js";
import { injectAdminUser } from "./_helpers/inject-admin-user.js";

describe("request result recovery HTTP contract", () => {
  let dir: string;
  let db: ReturnType<typeof initDatabase>;
  let app: Hono;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "claw-recovery-"));
    db = initDatabase(path.join(dir, "registry.db"));
    const registry = new Registry(db);
    const server = registry.upsertLocalServer("test", "/tmp/claw-recovery");
    for (const slug of ["demo", "other"]) {
      registry.createInstance({
        serverId: server.id,
        slug,
        port: slug === "demo" ? 18789 : 18790,
        configPath: `/tmp/${slug}/runtime.json`,
        stateDir: `/tmp/${slug}`,
        systemdUnit: `claw-${slug}`,
      });
    }
    app = new Hono();
    app.use("*", injectAdminUser());
    app.use("/api/instances/:slug/*", instanceMiddleware(registry));
    registerExecutionRoutes(app, { db } as RouteDeps);
  });

  afterEach(() => {
    resetPermissionChecker();
    disposeBus("demo");
    disposeBus("other");
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seedResult(finishReason = "stop") {
    const session = createSession(db, { instanceSlug: "demo", agentId: "assistant" });
    const { request } = createOrGetRequest(db, {
      instanceSlug: "demo",
      source: "telegram",
      sessionId: session.id,
    });
    const message = createAssistantMessage(db, { sessionId: session.id });
    createPart(db, { messageId: message.id, type: "text", content: "Recovered **report**" });
    const artifact = createPart(db, {
      messageId: message.id,
      type: "tool_result",
      content: '{"title":"Report"}',
    });
    updateMessageMetadata(db, message.id, { finishReason });
    persistRequestResult(db, request.id, {
      messageId: message.id,
      artifactRefs: [{ id: artifact.id }],
    });
    markRequestDeliveryFailed(db, request.id, new Error("Channel unavailable"));
    return { request, session, message, artifact };
  }

  function recover(id: string, slug = "demo") {
    return app.request(`/api/instances/${slug}/requests/${id}/recover-delivery`, {
      method: "POST",
    });
  }

  it("scopes latest terminal activity by session and source before limiting", async () => {
    const session = createSession(db, { instanceSlug: "demo", agentId: "assistant" });
    const request = createOrGetRequest(db, {
      instanceSlug: "demo",
      source: "web",
      sessionId: session.id,
    }).request;
    db.prepare(
      `INSERT INTO rt_executions
      (id,correlation_id,instance_slug,session_id,agent_id,timeout_ms,request_id,status)
      VALUES ('failed-run','trace','demo',?,'assistant',300000,?,'timed_out')`,
    ).run(session.id, request.id);
    createOrGetRequest(db, { instanceSlug: "demo", source: "web", sessionId: "another" });
    createOrGetRequest(db, { instanceSlug: "demo", source: "agent", sessionId: session.id });
    createOrGetRequest(db, { instanceSlug: "other", source: "web", sessionId: session.id });
    const response = await app.request(
      `/api/instances/demo/requests?sessionId=${session.id}&source=web&limit=1`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      requests: [
        {
          id: request.id,
          execution_status: "timed_out",
          delivery_status: "pending",
          result_message_id: null,
        },
      ],
    });
    expect(getRequest(db, request.id)?.delivery_status).toBe("pending");
    expect(db.prepare("SELECT COUNT(*) AS n FROM rt_executions").get()).toEqual({ n: 1 });
  });

  it("finds an older pending HTTP request without crossing its session scope", async () => {
    const first = createOrGetRequest(db, {
      instanceSlug: "demo",
      source: "web",
      sessionId: "s1",
    }).request;
    createOrGetRequest(db, { instanceSlug: "demo", source: "telegram", sessionId: "s1" });
    const query = `requestId=${first.id}&sessionId=s1&limit=1`;
    const response = await app.request(`/api/instances/demo/requests?${query}`);
    expect(await response.json()).toMatchObject({ requests: [{ id: first.id }] });
    const otherSession = await app.request(
      `/api/instances/demo/requests?requestId=${first.id}&sessionId=s2`,
    );
    expect(await otherSession.json()).toEqual({ requests: [] });
    const otherInstance = await app.request(`/api/instances/other/requests?${query}`);
    expect(await otherInstance.json()).toEqual({ requests: [] });
  });

  it("returns durable text and message parts before clearing the delivery failure", async () => {
    const { request, message, artifact } = seedResult();
    const res = await recover(request.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: request.id,
      delivery_status: "delivered",
      error_message: null,
      result: {
        text: "Recovered **report**",
        partial: false,
        message: {
          id: message.id,
          parts: [{ content: "Recovered **report**" }, { id: artifact.id }],
        },
      },
    });
    expect(getRequest(db, request.id)?.delivery_status).toBe("delivered");
  });

  it("returns the same content on repeated calls without resetting delivery or acknowledgement", async () => {
    const { request } = seedResult();
    const first = await (await recover(request.id)).json();
    expect(await (await recover(request.id)).json()).toEqual(first);
    acknowledgeRequest(db, request.id);
    expect(await (await recover(request.id)).json()).toMatchObject({
      delivery_status: "acknowledged",
      result: { text: "Recovered **report**" },
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM rt_executions").get()).toEqual({ n: 0 });
  });

  it("rejects a request belonging to another instance", async () => {
    const { request } = seedResult();
    expect((await recover(request.id, "other")).status).toBe(404);
    expect(getRequest(db, request.id)?.delivery_status).toBe("delivery_failed");
  });

  it("preserves permission checks", async () => {
    const { request } = seedResult();
    registerPermissionChecker({ check: async () => ({ allow: false, reason: "Denied" }) });
    expect((await recover(request.id)).status).toBe(403);
    expect(getRequest(db, request.id)?.delivery_status).toBe("delivery_failed");
  });

  it("rejects pending requests without a durable result", async () => {
    const { request } = createOrGetRequest(db, { instanceSlug: "demo", source: "web" });
    expect((await recover(request.id)).status).toBe(409);
    expect(getRequest(db, request.id)?.delivery_status).toBe("pending");
  });

  it("rejects a missing message without clearing the failure", async () => {
    const { request, message } = seedResult();
    db.prepare("DELETE FROM rt_messages WHERE id = ?").run(message.id);
    expect((await recover(request.id)).status).toBe(409);
    expect(getRequest(db, request.id)?.error_message).toBe("Channel unavailable");
  });

  it("rejects an empty message without clearing the failure", async () => {
    const { request, message } = seedResult();
    db.prepare("DELETE FROM rt_parts WHERE message_id = ?").run(message.id);
    expect((await recover(request.id)).status).toBe(409);
    expect(getRequest(db, request.id)?.delivery_status).toBe("delivery_failed");
  });

  it("rejects a result message outside the request session", async () => {
    const { request } = seedResult();
    const foreign = createSession(db, { instanceSlug: "other", agentId: "assistant" });
    const message = createAssistantMessage(db, { sessionId: foreign.id });
    persistRequestResult(db, request.id, { messageId: message.id });
    expect((await recover(request.id)).status).toBe(409);
    expect(getRequest(db, request.id)?.delivery_status).toBe("result_persisted");
  });

  it.each(["error", "length", "content-filter", ""])(
    "returns partial content for finish reason %s without claiming delivery",
    async (finishReason) => {
      const { request } = seedResult(finishReason);
      expect(await (await recover(request.id)).json()).toMatchObject({
        delivery_status: "delivery_failed",
        error_message: "Channel unavailable",
        result: { text: "Recovered **report**", partial: true },
      });
    },
  );

  it("returns an artifact-only saved message without re-executing it", async () => {
    const { request, message, artifact } = seedResult();
    db.prepare("DELETE FROM rt_parts WHERE message_id = ? AND type = 'text'").run(message.id);
    expect(await (await recover(request.id)).json()).toMatchObject({
      delivery_status: "delivered",
      result: {
        text: "",
        partial: false,
        message: { parts: [{ id: artifact.id, content: '{"title":"Report"}' }] },
      },
    });
  });

  it("keeps pending delivery unchanged even with a stale result reference", async () => {
    const { request } = seedResult();
    db.prepare("UPDATE rt_requests SET delivery_status = 'pending' WHERE id = ?").run(request.id);
    expect((await recover(request.id)).status).toBe(409);
    expect(getRequest(db, request.id)?.delivery_status).toBe("pending");
  });

  it("rejects a message from another session in the same instance", async () => {
    const { request } = seedResult();
    const session = createSession(db, { instanceSlug: "demo", agentId: "assistant" });
    const message = createAssistantMessage(db, { sessionId: session.id });
    createPart(db, { messageId: message.id, type: "text", content: "Different result" });
    persistRequestResult(db, request.id, { messageId: message.id });
    expect((await recover(request.id)).status).toBe(409);
    expect(getRequest(db, request.id)?.delivery_status).toBe("result_persisted");
  });

  it("checks the session instance even when both saved references agree", async () => {
    const { request } = seedResult();
    const session = createSession(db, { instanceSlug: "other", agentId: "assistant" });
    const message = createAssistantMessage(db, { sessionId: session.id });
    createPart(db, { messageId: message.id, type: "text", content: "Different result" });
    db.prepare("UPDATE rt_requests SET session_id = ? WHERE id = ?").run(session.id, request.id);
    persistRequestResult(db, request.id, { messageId: message.id });
    expect((await recover(request.id)).status).toBe(409);
    expect(getRequest(db, request.id)?.delivery_status).toBe("result_persisted");
  });

  it.each(["pending", "running", "error"])(
    "retains failure when a saved tool part is %s",
    async (state) => {
      const { request, artifact } = seedResult();
      db.prepare("UPDATE rt_parts SET state = ? WHERE id = ?").run(state, artifact.id);
      expect(await (await recover(request.id)).json()).toMatchObject({
        delivery_status: "delivery_failed",
        result: { text: "Recovered **report**", partial: true },
      });
    },
  );

  it("recovers result_persisted requests as well as failures", async () => {
    const { request, message } = seedResult();
    persistRequestResult(db, request.id, { messageId: message.id });
    expect(await (await recover(request.id)).json()).toMatchObject({
      delivery_status: "delivered",
    });
  });
});
