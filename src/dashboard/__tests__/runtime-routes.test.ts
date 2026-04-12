// src/dashboard/__tests__/runtime-routes.test.ts
//
// Integration tests for the runtime API routes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that pull in the mocked modules
// ---------------------------------------------------------------------------

vi.mock("../routes/_config-helpers.js", () => ({
  loadMergedConfigDbFirst: vi.fn(),
}));
vi.mock("../../lib/platform.js", () => ({
  getRuntimeStateDir: vi.fn(() => "/tmp/fake-state"),
  isRuntimeRunning: vi.fn(() => false),
  deriveInternalApiPort: vi.fn(() => 19250),
  resolveInternalApiToken: vi.fn(() => "test-token"),
}));
vi.mock("../../lib/env-reader.js", () => ({
  buildResolvedEnv: vi.fn(() => ({})),
}));
vi.mock("../../runtime/index.js", () => ({
  listMessages: vi.fn(() => []),
  listParts: vi.fn(() => []),
  runPromptLoop: vi.fn(),
  createSession: vi.fn(),
  getOrCreatePermanentSession: vi.fn(),
  resolveEffectivePersistence: vi.fn(() => "ephemeral"),
  initAgentRegistry: vi.fn(),
  defaultAgentName: vi.fn(() => "main"),
  getAgent: vi.fn(),
  listAgents: vi.fn(() => []),
  getBus: vi.fn(() => ({
    subscribeAll: vi.fn(() => vi.fn()),
  })),
  MODEL_CATALOG: [],
  countMessagesSinceLastCompaction: vi.fn(() => 0),
  getCachedSystemPrompt: vi.fn(() => null),
  getPersistedSystemPrompt: vi.fn(() => null),
}));
vi.mock("../../runtime/middleware/pipeline.js", () => ({
  runMiddlewarePipeline: vi.fn(),
}));
vi.mock("../../runtime/middleware/registry.js", () => ({
  registerMiddleware: vi.fn(),
  clearMiddlewares: vi.fn(),
}));
vi.mock("../../runtime/middleware/built-in/guardrail.js", () => ({
  guardrailMiddleware: {},
}));
vi.mock("../../runtime/middleware/built-in/multimodal.js", () => ({
  multimodalMiddleware: {},
}));
vi.mock("../../runtime/middleware/built-in/tool-error-recovery.js", () => ({
  toolErrorRecoveryMiddleware: {},
}));
vi.mock("../../runtime/middleware/built-in/suggestions.js", () => ({
  createSuggestionMiddleware: vi.fn(() => ({})),
}));
vi.mock("../../runtime/channel/router.js", () => ({
  resolveModelForAgent: vi.fn(() => ({ model: "mock-model" })),
}));
vi.mock("../../core/repositories/runtime-session-repository.js", () => ({
  listEnrichedSessions: vi.fn(() => ({ sessions: [], hasMore: false })),
  purgeArchivedSessions: vi.fn(() => ({
    sessionsDeleted: 0,
    messagesDeleted: 0,
    partsDeleted: 0,
  })),
}));
vi.mock("../../core/agent-workspace.js", () => ({
  resolveAgentWorkspacePath: vi.fn(() => "/tmp/fake-workspace"),
}));
vi.mock("../../runtime/tool/registry.js", () => ({
  TOOL_PROFILES: { executor: ["read_file", "write_file"] },
  ALL_TOOL_IDS: ["read_file", "write_file", "bash"],
}));
vi.mock("../../runtime/tool/built-in/question.js", () => ({
  resolveQuestion: vi.fn(() => false),
}));
vi.mock("../routes/_internal-api-client.js", () => ({
  callRuntimeApi: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Real imports (after mocks)
// ---------------------------------------------------------------------------

import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { TokenCache } from "../token-cache.js";
import { SessionStore } from "../session-store.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { registerRuntimeRoutes } from "../routes/instances/runtime.js";
import { instanceMiddleware } from "../routes/_instance-middleware.js";
import { loadMergedConfigDbFirst } from "../routes/_config-helpers.js";
import {
  listEnrichedSessions,
  purgeArchivedSessions,
} from "../../core/repositories/runtime-session-repository.js";
import { listMessages, listParts } from "../../runtime/index.js";

import { callRuntimeApi } from "../routes/_internal-api-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-runtime-token-64chars-hex-0123456789abcdef0123456789abcdef";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function json(res: Response): Promise<Json> {
  return res.json();
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

function jsonHeaders(): Record<string, string> {
  return { ...authHeaders(), "Content-Type": "application/json" };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let app: Hono;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;
let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-runtime-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  app = new Hono();

  // Auth middleware
  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    await next();
  });

  const deps: RouteDeps = {
    registry,
    conn,
    db,
    startedAt: Date.now(),
    health: {} as unknown as RouteDeps["health"],
    lifecycle: {} as unknown as RouteDeps["lifecycle"],
    monitor: {
      setTransitioning: () => {},
      clearTransitioning: () => {},
    } as unknown as RouteDeps["monitor"],
    selfUpdateChecker: {} as unknown as RouteDeps["selfUpdateChecker"],
    selfUpdater: {} as unknown as RouteDeps["selfUpdater"],
    tokenCache,
    xdgRuntimeDir: "/run/user/1000",
    sessionStore: new SessionStore(db),
    modelDiscovery: {
      invalidateProvider: () => {},
      getProviders: () => [],
      getModelCatalog: () => [],
      findModel: () => undefined,
      start: () => {},
      stop: () => {},
    } as unknown as RouteDeps["modelDiscovery"],
  };

  // Seed data: server + instance (use Registry methods like budget-routes test)
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: "test-inst",
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-test-inst",
  });

  app.use("/api/instances/:slug/*", instanceMiddleware(registry));
  registerRuntimeRoutes(app, deps);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/instances/:slug/runtime/status", () => {
  it("returns hasConfig: false when no config exists", async () => {
    vi.mocked(loadMergedConfigDbFirst).mockReturnValue(null);
    const res = await app.request("/api/instances/test-inst/runtime/status", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.hasConfig).toBe(false);
    expect(data.config).toBeNull();
  });

  it("returns hasConfig: true with config object", async () => {
    const mockConfig = {
      defaultModel: "anthropic/claude-sonnet",
      agents: [],
    };
    vi.mocked(loadMergedConfigDbFirst).mockReturnValue(mockConfig as never);
    const res = await app.request("/api/instances/test-inst/runtime/status", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.hasConfig).toBe(true);
    expect(data.config).toEqual(mockConfig);
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/instances/nonexistent/runtime/status", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/instances/:slug/runtime/sessions", () => {
  it("returns empty session list", async () => {
    vi.mocked(listEnrichedSessions).mockReturnValue({ sessions: [], hasMore: false });
    const res = await app.request("/api/instances/test-inst/runtime/sessions", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.sessions).toEqual([]);
    expect(data.hasMore).toBe(false);
  });

  it("passes through enriched sessions data", async () => {
    const mockSessions = [
      { id: "sess-1", agentId: "main", state: "active", messageCount: 5 },
      { id: "sess-2", agentId: "pilot", state: "archived", messageCount: 12 },
    ];
    vi.mocked(listEnrichedSessions).mockReturnValue({
      sessions: mockSessions as never,
      hasMore: true,
    });
    const res = await app.request("/api/instances/test-inst/runtime/sessions?limit=2", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.sessions).toHaveLength(2);
    expect(data.hasMore).toBe(true);
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/instances/nonexistent/runtime/sessions", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/instances/:slug/runtime/sessions", () => {
  it("returns 400 without state=archived", async () => {
    const res = await app.request("/api/instances/test-inst/runtime/sessions", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("INVALID_PARAM");
  });

  it("returns 400 with state=active", async () => {
    const res = await app.request("/api/instances/test-inst/runtime/sessions?state=active", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("INVALID_PARAM");
  });

  it("purges archived sessions successfully", async () => {
    vi.mocked(purgeArchivedSessions).mockReturnValue({
      sessionsDeleted: 3,
      messagesDeleted: 15,
      partsDeleted: 42,
    });
    const res = await app.request("/api/instances/test-inst/runtime/sessions?state=archived", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ok).toBe(true);
    expect(data.sessionsDeleted).toBe(3);
    expect(data.messagesDeleted).toBe(15);
    expect(data.partsDeleted).toBe(42);
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/instances/nonexistent/runtime/sessions?state=archived", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/instances/:slug/runtime/sessions/:sessionId/messages", () => {
  it("returns empty messages list", async () => {
    vi.mocked(listMessages).mockReturnValue([]);
    const res = await app.request("/api/instances/test-inst/runtime/sessions/sess-1/messages", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.messages).toEqual([]);
    expect(data.hasMore).toBe(false);
  });

  it("enriches messages with ISO dates and parts", async () => {
    const mockDate = new Date("2026-04-08T10:00:00Z");
    vi.mocked(listMessages).mockReturnValue([
      { id: "msg-1", role: "user", createdAt: mockDate },
      { id: "msg-2", role: "assistant", createdAt: mockDate },
    ] as never);
    vi.mocked(listParts).mockImplementation((_, msgId) => {
      if (msgId === "msg-1") return [];
      return [
        { id: "part-1", type: "text", content: "Hello", createdAt: mockDate, updatedAt: mockDate },
      ] as never;
    });

    const res = await app.request("/api/instances/test-inst/runtime/sessions/sess-1/messages", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0].createdAt).toBe("2026-04-08T10:00:00.000Z");
    expect(data.messages[1].parts).toHaveLength(1);
    expect(data.messages[1].parts[0].createdAt).toBe("2026-04-08T10:00:00.000Z");
  });

  it("supports limit parameter", async () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-${i}`,
      role: "user",
      createdAt: `2026-04-08T10:0${i}:00Z`,
    }));
    vi.mocked(listMessages).mockReturnValue(messages as never);
    vi.mocked(listParts).mockReturnValue([]);

    const res = await app.request(
      "/api/instances/test-inst/runtime/sessions/sess-1/messages?limit=3",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.messages).toHaveLength(3);
    expect(data.hasMore).toBe(true);
  });

  it("supports before cursor pagination", async () => {
    const messages = [
      { id: "msg-a", role: "user", createdAt: "2026-04-08T10:00:00Z" },
      { id: "msg-b", role: "assistant", createdAt: "2026-04-08T10:01:00Z" },
      { id: "msg-c", role: "user", createdAt: "2026-04-08T10:02:00Z" },
    ];
    vi.mocked(listMessages).mockReturnValue(messages as never);
    vi.mocked(listParts).mockReturnValue([]);

    const res = await app.request(
      "/api/instances/test-inst/runtime/sessions/sess-1/messages?before=msg-c",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0].id).toBe("msg-a");
    expect(data.messages[1].id).toBe("msg-b");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/instances/nonexistent/runtime/sessions/sess-1/messages", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/instances/:slug/runtime/sessions/:sessionId/abort", () => {
  it("returns 503 when runtime is not running", async () => {
    const res = await app.request("/api/instances/test-inst/runtime/sessions/sess-1/abort", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(503);
    const data = await json(res);
    expect(data.code).toBe("RUNTIME_NOT_RUNNING");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/instances/nonexistent/runtime/sessions/sess-1/abort", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/instances/:slug/runtime/tools", () => {
  it("returns tools and profiles", async () => {
    const res = await app.request("/api/instances/test-inst/runtime/tools", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.tools).toEqual(["read_file", "write_file", "bash"]);
    expect(data.profiles).toEqual({ executor: ["read_file", "write_file"] });
  });
});

describe("POST /api/instances/:slug/runtime/questions/:questionId/answer", () => {
  it("returns 400 for invalid JSON", async () => {
    const res = await app.request("/api/instances/test-inst/runtime/questions/q-1/answer", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("INVALID_JSON");
  });

  it("returns 400 when answer is missing", async () => {
    const res = await app.request("/api/instances/test-inst/runtime/questions/q-1/answer", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("MISSING_ANSWER");
  });

  it("returns 404 when question not found", async () => {
    vi.mocked(callRuntimeApi).mockResolvedValue({ ok: true, resolved: false });
    const res = await app.request(
      "/api/instances/test-inst/runtime/questions/q-nonexistent/answer",
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ answer: "42" }),
      },
    );
    expect(res.status).toBe(404);
    const data = await json(res);
    expect(data.code).toBe("QUESTION_NOT_FOUND");
  });

  it("returns ok when question is resolved", async () => {
    vi.mocked(callRuntimeApi).mockResolvedValue({ ok: true, resolved: true });
    const res = await app.request("/api/instances/test-inst/runtime/questions/q-1/answer", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ answer: "yes" }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ok).toBe(true);
    expect(data.questionId).toBe("q-1");
    expect(data.answer).toBe("yes");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/instances/nonexistent/runtime/questions/q-1/answer", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ answer: "yes" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/instances/:slug/runtime/heartbeat/history", () => {
  it("returns 400 when agentId is missing", async () => {
    const res = await app.request("/api/instances/test-inst/runtime/heartbeat/history", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("MISSING_AGENT_ID");
  });

  it("returns empty ticks when no heartbeat data", async () => {
    const res = await app.request(
      "/api/instances/test-inst/runtime/heartbeat/history?agentId=main",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ticks).toEqual([]);
  });

  it("returns ticks with detected status from DB data", async () => {
    // Create a session with channel = 'internal'
    db.prepare(
      `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, state, persistent, spawn_depth, created_at, updated_at)
       VALUES ('hb-sess-1', 'test-inst', 'main', 'internal', 'active', 0, 0, '2026-04-08T10:00:00Z', '2026-04-08T10:00:00Z')`,
    ).run();
    // Insert an assistant message
    db.prepare(
      `INSERT INTO rt_messages (id, session_id, role, created_at)
       VALUES ('hb-msg-1', 'hb-sess-1', 'assistant', '2026-04-08T10:01:00Z')`,
    ).run();
    // Insert a text part
    db.prepare(
      `INSERT INTO rt_parts (id, message_id, type, content, created_at, updated_at)
       VALUES ('hb-part-1', 'hb-msg-1', 'text', 'All systems OK', '2026-04-08T10:01:00Z', '2026-04-08T10:01:00Z')`,
    ).run();

    const res = await app.request(
      "/api/instances/test-inst/runtime/heartbeat/history?agentId=main",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ticks).toHaveLength(1);
    expect(data.ticks[0].messageId).toBe("hb-msg-1");
    expect(data.ticks[0].agentId).toBe("main");
    expect(data.ticks[0].responseText).toBe("All systems OK");
    expect(data.ticks[0].status).toBe("ok");
  });

  it("detects alert status from heartbeat text", async () => {
    db.prepare(
      `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, state, persistent, spawn_depth, created_at, updated_at)
       VALUES ('hb-sess-2', 'test-inst', 'pilot', 'internal', 'active', 0, 0, '2026-04-08T10:00:00Z', '2026-04-08T10:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO rt_messages (id, session_id, role, created_at)
       VALUES ('hb-msg-2', 'hb-sess-2', 'assistant', '2026-04-08T10:01:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO rt_parts (id, message_id, type, content, created_at, updated_at)
       VALUES ('hb-part-2', 'hb-msg-2', 'text', 'HEARTBEAT_ALERT: service down', '2026-04-08T10:01:00Z', '2026-04-08T10:01:00Z')`,
    ).run();

    const res = await app.request(
      "/api/instances/test-inst/runtime/heartbeat/history?agentId=pilot",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ticks).toHaveLength(1);
    expect(data.ticks[0].status).toBe("alert");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request(
      "/api/instances/nonexistent/runtime/heartbeat/history?agentId=main",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/instances/:slug/runtime/chat", () => {
  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/instances/test-inst/runtime/chat", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: "{bad json",
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("INVALID_JSON");
  });

  it("returns 400 when message is missing", async () => {
    const res = await app.request("/api/instances/test-inst/runtime/chat", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("MISSING_MESSAGE");
  });

  it("returns 400 when message is empty string", async () => {
    const res = await app.request("/api/instances/test-inst/runtime/chat", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ message: "   " }),
    });
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("MISSING_MESSAGE");
  });

  it("returns 503 when runtime is not running", async () => {
    // Runtime daemon is not running — isRuntimeRunning returns false (no PID file in test env)
    const res = await app.request("/api/instances/test-inst/runtime/chat", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ message: "Hello" }),
    });
    expect(res.status).toBe(503);
    const data = await json(res);
    expect(data.code).toBe("RUNTIME_NOT_RUNNING");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/instances/nonexistent/runtime/chat", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ message: "Hello" }),
    });
    expect(res.status).toBe(404);
  });
});
