// src/dashboard/routes/instances/agents/__tests__/kickoff.test.ts
//
// Unit tests for POST /api/instances/:slug/agents/:agentId/kickoff

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Mocks — must be declared before the imports that use them
// ---------------------------------------------------------------------------

vi.mock("../../../../../lib/platform.js", () => ({
  resolveActualInternalApiPort: vi.fn(() => 19100),
  resolveInternalApiToken: vi.fn(() => "test-token"),
}));

vi.mock("../../../../../runtime/provider/provider.js", () => ({
  resolveModel: () => ({
    languageModel: {},
    providerId: "anthropic",
    modelId: "test",
    costPerMillion: { input: 0, output: 0 },
  }),
}));
vi.mock("../../../../../lib/crypto.js", async (original) => ({
  ...(await original<typeof import("../../../../../lib/crypto.js")>()),
  isCryptoAvailable: () => false,
}));
vi.mock("../../../../../runtime/session/prompt-loop.js", () => ({
  runPromptLoop: async (input: {
    db: ReturnType<typeof initDatabase>;
    sessionId: string;
    userText: string;
  }) => {
    const message = createUserMessage(input.db, {
      sessionId: input.sessionId,
      text: input.userText,
    });
    return {
      messageId: message.id,
      text: "Test introduction",
      steps: 1,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
    };
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { initDatabase } from "../../../../../db/schema.js";
import { Registry } from "../../../../../core/registry.js";
import { TokenCache } from "../../../../token-cache.js";
import { SessionStore } from "../../../../session-store.js";
import { MockConnection } from "../../../../../core/__tests__/mock-connection.js";
import { apiError } from "../../../../route-deps.js";
import type { RouteDeps } from "../../../../route-deps.js";
import { instanceMiddleware } from "../../../_instance-middleware.js";
import { registerAgentKickoffRoutes } from "../kickoff.js";
import { injectAdminUser } from "../../../../__tests__/_helpers/inject-admin-user.js";
import { getSession } from "../../../../../runtime/session/session.js";
import { createUserMessage } from "../../../../../runtime/session/message.js";
import { createDefaultRuntimeConfig } from "../../../../../runtime/config/index.js";
import { initAgentRegistry, resetAgentRegistry } from "../../../../../runtime/agent/registry.js";
import { ChannelRouter } from "../../../../../runtime/channel/router.js";
import { getBus, disposeBus, SessionCreated } from "../../../../../runtime/bus/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-kickoff-token-64chars-hex-0123456789abcdef0123456789abcdef0";

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

function jsonHeaders(): Record<string, string> {
  return { ...authHeaders(), "Content-Type": "application/json" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

/** Build a minimal RouteDeps stub for the test suite. */
function makeTestDeps(
  registry: Registry,
  db: ReturnType<typeof initDatabase>,
  conn: MockConnection,
): RouteDeps {
  return {
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
    tokenCache: new TokenCache(conn),
    xdgRuntimeDir: "/run/user/1000",
    sessionStore: new SessionStore(db),
    modelDiscovery: {} as unknown as RouteDeps["modelDiscovery"],
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: Hono;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;
let tmpDir: string;
const SLUG = "test-inst";
const AGENT_ID = "main";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-kickoff-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  const conn = new MockConnection();

  app = new Hono();

  // Auth middleware — validates bearer token and injects synthetic admin user
  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    await next();
  });
  app.use("/api/*", injectAdminUser());

  const deps = makeTestDeps(registry, db, conn);

  app.use("/api/instances/:slug/*", instanceMiddleware(registry));
  registerAgentKickoffRoutes(app, deps);

  // Seed: server + instance + agent
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  const inst = registry.createInstance({
    serverId: server.id,
    slug: SLUG,
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-test",
  });
  registry.upsertAgent(inst.id, {
    agentId: AGENT_ID,
    name: "Main",
    model: "anthropic/claude-sonnet-4-20250514",
    workspacePath: `/tmp/ws/${AGENT_ID}`,
    isDefault: true,
    configJson: "{}",
  });
});

afterEach(() => {
  resetAgentRegistry();
  disposeBus(SLUG);
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/instances/:slug/agents/:agentId/kickoff", () => {
  it.each(["missing", "active", "archived"])(
    "routes kickoff to a canonical permanent session when it is %s",
    async (state) => {
      if (state !== "missing") {
        db.prepare(
          `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, state, session_key, persistent)
           VALUES ('canonical-session', ?, ?, 'web', ?, 'test-inst:main', 1)`,
        ).run(SLUG, AGENT_ID, state);
      }
      const config = createDefaultRuntimeConfig({});
      config.agents[0]!.id = AGENT_ID;
      initAgentRegistry(config.agents);
      let insideRuntime = false;
      let runtimeSessionStarts = 0;
      getBus(SLUG).subscribe(SessionCreated, () => {
        if (insideRuntime) runtimeSessionStarts++;
      });
      // Keep session resolution, context validation and middleware real;
      // only transport and provider work are simulated.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          const sent = JSON.parse(init.body as string) as { sessionId?: string; message: string };
          insideRuntime = true;
          try {
            const result = await ChannelRouter.route({
              db,
              instanceSlug: SLUG,
              config,
              agentId: AGENT_ID,
              ...(sent.sessionId !== undefined ? { sessionId: sent.sessionId } : {}),
              message: { channelType: "web", peerId: "dashboard", text: sent.message },
            });
            return { ok: true, json: async () => ({ sessionId: result.sessionId }) };
          } finally {
            insideRuntime = false;
          }
        }),
      );

      const res = await app.request(`/api/instances/${SLUG}/agents/${AGENT_ID}/kickoff`, {
        method: "POST",
        headers: jsonHeaders(),
        body: "{}",
      });

      expect(res.status).toBe(202);
      const body = await json(res);
      const session = getSession(db, body.sessionId);
      expect(session).toMatchObject({
        instanceSlug: SLUG,
        agentId: AGENT_ID,
        persistent: true,
        state: "active",
      });
      expect(body.sessionId).not.toBe("test-inst:main");
      if (state !== "missing") expect(body.sessionId).toBe("canonical-session");
      expect(
        db
          .prepare("SELECT count(*) AS n FROM rt_sessions WHERE session_key = 'test-inst:main'")
          .get(),
      ).toEqual({ n: 1 });
      expect(runtimeSessionStarts).toBe(state === "active" ? 0 : 1);
      const repeated = await app.request(`/api/instances/${SLUG}/agents/${AGENT_ID}/kickoff`, {
        method: "POST",
        headers: jsonHeaders(),
        body: "{}",
      });
      expect(repeated.status).toBe(409);
      expect(await json(repeated)).toMatchObject({ code: "KICKOFF_ALREADY_DONE" });
    },
  );

  it.each([
    {
      status: 409,
      code: "REQUEST_CONTEXT_CONFLICT",
      expectedStatus: 409,
      expectedCode: "REQUEST_CONTEXT_CONFLICT",
    },
    { status: 500, code: "INTERNAL_ERROR", expectedStatus: 500, expectedCode: "INTERNAL_ERROR" },
    { status: 401, code: "UNAUTHORIZED", expectedStatus: 502, expectedCode: "RUNTIME_AUTH_FAILED" },
    { status: 403, code: "FORBIDDEN", expectedStatus: 502, expectedCode: "RUNTIME_AUTH_FAILED" },
  ])(
    "classifies a runtime HTTP rejection ($status) without exposing internal details",
    async ({ status, code, expectedStatus, expectedCode }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status,
          json: async () => ({ code, error: "private runtime detail" }),
        }),
      );
      const res = await app.request(`/api/instances/${SLUG}/agents/${AGENT_ID}/kickoff`, {
        method: "POST",
        headers: jsonHeaders(),
        body: "{}",
      });
      expect(res.status).toBe(expectedStatus);
      const body = await json(res);
      expect(body.code).toBe(expectedCode);
      expect(body.error).not.toContain("private runtime detail");
      expect(body.error).not.toContain("reach");
    },
  );

  it("returns 202 with greeting and sessionId when session is empty", async () => {
    // Stub fetch to simulate a successful runtime response
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: "runtime-session-id", ok: true }),
      }),
    );

    const res = await app.request(`/api/instances/${SLUG}/agents/${AGENT_ID}/kickoff`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(202);
    const body = await json(res);
    expect(body.sessionId).toBe("runtime-session-id");
    expect(typeof body.greeting).toBe("string");
    expect(body.greeting.length).toBeGreaterThan(0);
  });

  it("returns 409 KICKOFF_ALREADY_DONE when the session already has messages", async () => {
    // Seed a permanent session + a message in the DB
    db.prepare(
      `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, state, session_key, persistent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run("sess-001", SLUG, AGENT_ID, "web", "active", `${SLUG}:${AGENT_ID}`, 1);

    db.prepare(
      `INSERT INTO rt_messages (id, session_id, role, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run("msg-001", "sess-001", "user");

    const res = await app.request(`/api/instances/${SLUG}/agents/${AGENT_ID}/kickoff`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.code).toBe("KICKOFF_ALREADY_DONE");
  });

  it("returns 404 AGENT_NOT_FOUND when the agent does not exist", async () => {
    const res = await app.request(`/api/instances/${SLUG}/agents/ghost-agent/kickoff`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("AGENT_NOT_FOUND");
  });

  it("returns 502 RUNTIME_UNREACHABLE when the runtime call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const res = await app.request(`/api/instances/${SLUG}/agents/${AGENT_ID}/kickoff`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.code).toBe("RUNTIME_UNREACHABLE");
  });
});
