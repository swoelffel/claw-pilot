// src/e2e/flow.e2e.test.ts
// End-to-end flow: create instance → create agent → delete agent → delete instance
//
// This test exercises the full HTTP lifecycle via real requests:
//   POST /api/instances          → provision a claw-runtime instance
//   GET  /api/instances/:slug    → verify it exists
//   POST /api/instances/:slug/agents → create an agent
//   GET  /api/instances/:slug/agents → verify agent is present
//   DELETE /api/instances/:slug/agents/:agentId → remove the agent
//   GET  /api/instances/:slug/agents → verify agent is gone
//   DELETE /api/instances/:slug  → remove the instance
//   GET  /api/instances/:slug    → verify 404
//
// Notes:
// - The provisioner calls ensureRuntimeConfig() which uses the real fs.
//   We point OPENCLAW_HOME to a tmpdir so it writes there, and clean up after.
// - The provisioner also calls conn.mkdir/writeFile — handled by MockConnection.
// - Port is derived from slug via deriveWebChatPort (19100-19199 range).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, seedLocalServer } from "./helpers/seed.js";
import { NamedKeyRepository } from "../core/repositories/named-key-repository.js";
import { deriveWebChatPort } from "../lib/platform.js";
import type { Json } from "./helpers/types.js";

const FLOW_SLUG = "flow-test-inst";
// Port depends on the OS username salt introduced in v0.72.8, so derive at runtime.
const FLOW_PORT = deriveWebChatPort(FLOW_SLUG);

describe("Flow: create instance → create agent → delete agent → delete instance", () => {
  let ctx: TestContext;
  let tmpHome: string;
  let originalOpenclawHome: string | undefined;
  let originalMasterKey: string | undefined;
  let namedKeyId: number;

  beforeAll(async () => {
    // Point OPENCLAW_HOME to a real tmpdir so ensureRuntimeConfig() can write runtime.json
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-e2e-"));
    originalOpenclawHome = process.env["OPENCLAW_HOME"];
    process.env["OPENCLAW_HOME"] = tmpHome;

    // Set encryption key for named API keys
    originalMasterKey = process.env["MASTER_ENCRYPTION_KEY"];
    process.env["MASTER_ENCRYPTION_KEY"] = "a".repeat(64);

    ctx = await startTestServer();
    await seedAdmin(ctx.db);
    seedLocalServer(ctx.registry);

    // Seed a named API key for instance creation
    const namedKeyRepo = new NamedKeyRepository(ctx.db);
    const namedKey = namedKeyRepo.create({
      name: "Test Anthropic Key",
      providerId: "anthropic",
      apiKey: "sk-test-fake-key",
      defaultModel: "anthropic/claude-3-5-haiku-20241022",
    });
    namedKeyId = namedKey.id;
  });

  afterAll(async () => {
    // Restore env
    if (originalOpenclawHome === undefined) {
      delete process.env["OPENCLAW_HOME"];
    } else {
      process.env["OPENCLAW_HOME"] = originalOpenclawHome;
    }
    if (originalMasterKey === undefined) {
      delete process.env["MASTER_ENCRYPTION_KEY"];
    } else {
      process.env["MASTER_ENCRYPTION_KEY"] = originalMasterKey;
    }
    // Clean up tmpdir
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    // Clean up residual state dir that ensureRuntimeConfig may have created in ~/.claw-pilot/
    try {
      const residualDir = path.join(os.homedir(), ".claw-pilot", "instances", FLOW_SLUG);
      fs.rmSync(residualDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    await ctx.cleanup();
  });

  // Step 1 — POST /api/instances → 201, instance created
  it("POST /api/instances → 201, instance provisioned", async () => {
    const res = await ctx.client.withBearer().post("/api/instances", {
      slug: FLOW_SLUG,
      defaultModel: "anthropic/claude-3-5-haiku-20241022",
      namedKeyId,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Json;
    expect(body.slug).toBe(FLOW_SLUG);
    expect(body.port).toBe(FLOW_PORT);
  });

  // Step 2 — GET /api/instances/:slug → 200, instance found
  it("GET /api/instances/:slug → 200, instance found after creation", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${FLOW_SLUG}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.instance).toBeDefined();
    expect(body.instance.slug).toBe(FLOW_SLUG);
  });

  // Step 3 — POST /api/instances/:slug/agents → 201, agent created
  it("POST /api/instances/:slug/agents → 201, agent created", async () => {
    // AgentProvisioner reads instance.config_path via conn.readFile().
    // Bridge the gap by injecting DB-persisted config into MockConnection.
    const instance = ctx.registry.getInstance(FLOW_SLUG);
    if (!instance) throw new Error("Instance not found in registry after provision");
    const dbConfig = ctx.registry.getRuntimeConfig(FLOW_SLUG);
    if (dbConfig) {
      ctx.conn.files.set(instance.config_path, JSON.stringify(dbConfig, null, 2));
    }

    const res = await ctx.client.withBearer().post(`/api/instances/${FLOW_SLUG}/agents`, {
      agentSlug: "flow-agent",
      name: "Flow Agent",
      role: "assistant",
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Json;
    expect(body.agents).toBeDefined();
    expect(Array.isArray(body.agents)).toBe(true);
    const created = body.agents.find((a: Json) => a.agent_id === "flow-agent");
    expect(created).toBeDefined();
    expect(created.name).toBe("Flow Agent");
  });

  // Step 4 — GET /api/instances/:slug/agents → agent present
  it("GET /api/instances/:slug/agents → flow-agent present", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${FLOW_SLUG}/agents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((a: Json) => a.agent_id === "flow-agent");
    expect(found).toBeDefined();
  });

  // Step 5 — DELETE /api/instances/:slug/agents/:agentId → 200, agent removed
  it("DELETE /api/instances/:slug/agents/flow-agent → 200, agent removed", async () => {
    const res = await ctx.client
      .withBearer()
      .delete(`/api/instances/${FLOW_SLUG}/agents/flow-agent`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.instance).toBeDefined();
    expect(Array.isArray(body.agents)).toBe(true);
    const stillPresent = body.agents.find((a: Json) => a.agent_id === "flow-agent");
    expect(stillPresent).toBeUndefined();
  });

  // Step 6 — GET /api/instances/:slug/agents → agent gone
  it("GET /api/instances/:slug/agents → flow-agent no longer present", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${FLOW_SLUG}/agents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(Array.isArray(body)).toBe(true);
    const deleted = body.find((a: Json) => a.agent_id === "flow-agent");
    expect(deleted).toBeUndefined();
  });

  // Step 7 — DELETE /api/instances/:slug → 200, instance removed
  it("DELETE /api/instances/:slug → 200, instance deleted", async () => {
    const res = await ctx.client.withBearer().delete(`/api/instances/${FLOW_SLUG}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.ok).toBe(true);
    expect(body.slug).toBe(FLOW_SLUG);
  });

  // Step 8 — GET /api/instances/:slug → 404
  it("GET /api/instances/:slug → 404 after deletion", async () => {
    const res = await ctx.client.withBearer().get(`/api/instances/${FLOW_SLUG}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Json;
    expect(body.code).toBe("NOT_FOUND");
  });
});
