// src/dashboard/__tests__/agent-blueprint-routes.test.ts
//
// Integration tests for the agent blueprint API routes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { TokenCache } from "../token-cache.js";
import { SessionStore } from "../session-store.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";

// ---------------------------------------------------------------------------
// Mock workspace-templates BEFORE importing the routes module
// ---------------------------------------------------------------------------

vi.mock("../../lib/workspace-templates.js", () => ({
  loadWorkspaceTemplate: vi.fn().mockResolvedValue("# Template content"),
}));

const { registerAgentBlueprintRoutes } = await import("../routes/agent-blueprints.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-dashboard-token-64chars-hex-0123456789abcdef0123456789abcdef";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function json(res: Response): Promise<Json> {
  return res.json();
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let app: Hono;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;
let tmpDir: string;

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

function jsonHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function yamlHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    "Content-Type": "text/yaml",
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-blueprint-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  app = new Hono();

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
  };

  registerAgentBlueprintRoutes(app, deps);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper — create a blueprint via the registry directly
// ---------------------------------------------------------------------------

function seedBlueprint(name = "Test Blueprint", description = "A test blueprint") {
  return registry.createAgentBlueprint({ name, description, category: "user" });
}

// ===========================================================================
// Auth
// ===========================================================================

describe("Auth", () => {
  it("returns 401 without token", async () => {
    const res = await app.request(new Request("http://localhost/api/agent-blueprints"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// GET /api/agent-blueprints
// ===========================================================================

describe("GET /api/agent-blueprints", () => {
  it("returns empty list when no blueprints exist", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints", { headers: authHeaders() }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual([]);
  });

  it("returns created blueprints", async () => {
    seedBlueprint("Alpha");
    seedBlueprint("Beta");
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints", { headers: authHeaders() }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toHaveLength(2);
    const names = body.map((b: Json) => b.name);
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
  });
});

// ===========================================================================
// POST /api/agent-blueprints — create
// ===========================================================================

describe("POST /api/agent-blueprints", () => {
  it("creates a minimal blueprint", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "Minimal" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.name).toBe("Minimal");
    expect(body.id).toBeDefined();
    expect(body.files).toEqual([]);
  });

  it("creates a blueprint with all fields", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          name: "Full",
          description: "Complete blueprint",
          category: "tool",
          configJson: '{"model":"gpt-4"}',
          icon: "🔧",
          tags: "dev,test",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.name).toBe("Full");
    expect(body.description).toBe("Complete blueprint");
    expect(body.category).toBe("tool");
  });

  it("creates a blueprint with seedFiles", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "Seeded", seedFiles: true }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.name).toBe("Seeded");
    expect(body.files.length).toBeGreaterThan(0);
  });

  it("returns 400 for invalid body", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_BODY");
  });
});

// ===========================================================================
// GET /api/agent-blueprints/:id — detail
// ===========================================================================

describe("GET /api/agent-blueprints/:id", () => {
  it("returns detail with files summary", async () => {
    const bp = seedBlueprint("Detail");
    registry.upsertAgentBlueprintFile(bp.id, "SOUL.md", "# Soul");

    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}`, { headers: authHeaders() }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.name).toBe("Detail");
    expect(body.files).toHaveLength(1);
    expect(body.files[0].filename).toBe("SOUL.md");
    expect(body.files[0].size).toBe(6);
    // Detail endpoint returns summary (no content field)
    expect(body.files[0].content).toBeUndefined();
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/nonexistent", { headers: authHeaders() }),
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ===========================================================================
// PUT /api/agent-blueprints/:id — update
// ===========================================================================

describe("PUT /api/agent-blueprints/:id", () => {
  it("updates the name", async () => {
    const bp = seedBlueprint("OldName");
    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}`, {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "NewName" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.name).toBe("NewName");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/nonexistent", {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "X" }),
      }),
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid body", async () => {
    const bp = seedBlueprint("Valid");
    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}`, {
        method: "PUT",
        headers: jsonHeaders(),
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_BODY");
  });
});

// ===========================================================================
// DELETE /api/agent-blueprints/:id
// ===========================================================================

describe("DELETE /api/agent-blueprints/:id", () => {
  it("deletes a blueprint", async () => {
    const bp = seedBlueprint("ToDelete");
    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);

    // Verify it's gone
    const check = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}`, { headers: authHeaders() }),
    );
    expect(check.status).toBe(404);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/nonexistent", {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ===========================================================================
// POST /api/agent-blueprints/:id/clone
// ===========================================================================

describe("POST /api/agent-blueprints/:id/clone", () => {
  it("clones a blueprint with files", async () => {
    const bp = seedBlueprint("Original");
    registry.upsertAgentBlueprintFile(bp.id, "SOUL.md", "# Original Soul");
    registry.upsertAgentBlueprintFile(bp.id, "USER.md", "# User notes");

    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}/clone`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "Cloned" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.name).toBe("Cloned");
    expect(body.id).not.toBe(bp.id);
    expect(body.files).toHaveLength(2);
  });

  it("returns 404 for unknown source", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/nonexistent/clone", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ===========================================================================
// GET /api/agent-blueprints/:id/files/:filename
// ===========================================================================

describe("GET /api/agent-blueprints/:id/files/:filename", () => {
  it("returns file content", async () => {
    const bp = seedBlueprint("WithFile");
    registry.upsertAgentBlueprintFile(bp.id, "SOUL.md", "# My Soul");

    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}/files/SOUL.md`, {
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.filename).toBe("SOUL.md");
    expect(body.content).toBe("# My Soul");
    expect(body.content_hash).toBeDefined();
  });

  it("returns 404 for unknown blueprint", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/nonexistent/files/SOUL.md", {
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown file", async () => {
    const bp = seedBlueprint("NoFile");
    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}/files/MISSING.md`, {
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ===========================================================================
// PUT /api/agent-blueprints/:id/files/:filename
// ===========================================================================

describe("PUT /api/agent-blueprints/:id/files/:filename", () => {
  it("creates or updates a file", async () => {
    const bp = seedBlueprint("FileWrite");

    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}/files/SOUL.md`, {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ content: "# New Soul" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.filename).toBe("SOUL.md");
    expect(body.content).toBe("# New Soul");
  });

  it("returns 400 for invalid body (missing content)", async () => {
    const bp = seedBlueprint("FileWriteBad");

    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}/files/SOUL.md`, {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ text: "wrong field" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_BODY");
  });

  it("returns 404 for unknown blueprint", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/nonexistent/files/SOUL.md", {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ content: "x" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// DELETE /api/agent-blueprints/:id/files/:filename
// ===========================================================================

describe("DELETE /api/agent-blueprints/:id/files/:filename", () => {
  it("deletes a file", async () => {
    const bp = seedBlueprint("FileDelete");
    registry.upsertAgentBlueprintFile(bp.id, "SOUL.md", "# Soul");

    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}/files/SOUL.md`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);

    // Verify it's gone
    const check = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}/files/SOUL.md`, {
        headers: authHeaders(),
      }),
    );
    expect(check.status).toBe(404);
  });
});

// ===========================================================================
// POST /api/agent-blueprints/from-agent
// ===========================================================================

describe("POST /api/agent-blueprints/from-agent", () => {
  it("creates a blueprint from an instance agent", async () => {
    // Seed instance + agent
    const server = registry.upsertLocalServer("testhost", "/opt/claw");
    const inst = registry.createInstance({
      serverId: server.id,
      slug: "test-inst",
      port: 18789,
      configPath: "/tmp/cfg",
      stateDir: "/tmp/state",
      systemdUnit: "claw-test",
    });
    const agent = registry.upsertAgent(inst.id, {
      agentId: "agent-1",
      name: "MyAgent",
      workspacePath: "/tmp/ws/agent-1",
    });
    registry.upsertAgentFile(agent.id, {
      filename: "SOUL.md",
      content: "# Agent Soul",
      contentHash: "abc123",
    });

    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/from-agent", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          instanceSlug: "test-inst",
          agentId: "agent-1",
          name: "From Agent BP",
          description: "Created from instance",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.name).toBe("From Agent BP");
    expect(body.files).toHaveLength(1);
    expect(body.files[0].filename).toBe("SOUL.md");
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/from-agent", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          instanceSlug: "no-such-inst",
          agentId: "agent-1",
          name: "Nope",
        }),
      }),
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 404 for unknown agent", async () => {
    const server = registry.upsertLocalServer("testhost", "/opt/claw");
    registry.createInstance({
      serverId: server.id,
      slug: "inst-no-agent",
      port: 18790,
      configPath: "/tmp/cfg2",
      stateDir: "/tmp/state2",
      systemdUnit: "claw-test2",
    });

    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/from-agent", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          instanceSlug: "inst-no-agent",
          agentId: "no-such-agent",
          name: "Nope",
        }),
      }),
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid body", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/from-agent", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ instanceSlug: "x" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("INVALID_BODY");
  });
});

// ===========================================================================
// GET /api/agent-blueprints/:id/export — YAML export
// ===========================================================================

describe("GET /api/agent-blueprints/:id/export", () => {
  it("exports as YAML with correct headers", async () => {
    const bp = seedBlueprint("Export Me");
    registry.upsertAgentBlueprintFile(bp.id, "SOUL.md", "# Soul export");

    const res = await app.request(
      new Request(`http://localhost/api/agent-blueprints/${bp.id}/export`, {
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/yaml");
    expect(res.headers.get("Content-Disposition")).toContain("export-me-template.yaml");

    const yamlText = await res.text();
    expect(yamlText).toContain("name: Export Me");
    expect(yamlText).toContain("SOUL.md");
    expect(yamlText).toContain("# Soul export");
  });

  it("returns 404 for unknown blueprint", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/nonexistent/export", {
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// POST /api/agent-blueprints/import — YAML import
// ===========================================================================

describe("POST /api/agent-blueprints/import", () => {
  it("imports a valid YAML blueprint", async () => {
    const yamlContent = [
      "version: '1'",
      "name: Imported BP",
      "description: From YAML",
      "category: tool",
      "files:",
      "  SOUL.md: '# Imported Soul'",
      "  USER.md: '# Imported User'",
    ].join("\n");

    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/import", {
        method: "POST",
        headers: yamlHeaders(),
        body: yamlContent,
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.name).toBe("Imported BP");
    expect(body.description).toBe("From YAML");
    expect(body.category).toBe("tool");
    expect(body.files).toHaveLength(2);
    const filenames = body.files.map((f: Json) => f.filename);
    expect(filenames).toContain("SOUL.md");
    expect(filenames).toContain("USER.md");
  });

  it("returns 400 for invalid YAML syntax", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/import", {
        method: "POST",
        headers: yamlHeaders(),
        body: "{{invalid yaml: [",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for valid YAML but invalid structure (missing name)", async () => {
    const res = await app.request(
      new Request("http://localhost/api/agent-blueprints/import", {
        method: "POST",
        headers: yamlHeaders(),
        body: "description: no name here\n",
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});
