// src/dashboard/server.ts
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Registry } from "../core/registry.js";
import type { ServerConnection } from "../server/connection.js";
import type { WizardAnswers } from "../core/config-generator.js";
import { HealthChecker } from "../core/health.js";
import { Lifecycle } from "../core/lifecycle.js";
import { Destroyer } from "../core/destroyer.js";
import { Provisioner } from "../core/provisioner.js";
import { PortAllocator } from "../core/port-allocator.js";
import { PairingManager } from "../core/pairing.js";
import { AgentSync, EDITABLE_FILES } from "../core/agent-sync.js";
import { AgentProvisioner } from "../core/agent-provisioner.js";
import type { CreateAgentData } from "../core/agent-provisioner.js";
import { exportInstanceTeam, exportBlueprintTeam, serializeTeamYaml } from "../core/team-export.js";
import { parseAndValidateTeam, importInstanceTeam, importBlueprintTeam } from "../core/team-import.js";
import { Monitor } from "./monitor.js";
import { ClawPilotError, InstanceNotFoundError } from "../lib/errors.js";
import { resolveXdgRuntimeDir } from "../lib/xdg.js";
import { PROVIDER_CATALOG } from "../lib/provider-catalog.js";
import type { ProviderInfo } from "../lib/provider-catalog.js";
import { readGatewayToken } from "../lib/env-reader.js";

// Resolve dist/ui/ relative to this bundle chunk.
// When bundled: this file is at <install>/dist/server-*.mjs
// so __dirname = <install>/dist/ and UI_DIST = <install>/dist/ui/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST =
  process.env["CLAW_PILOT_UI_DIST"] ?? path.resolve(__dirname, "ui");

// Minimal MIME type map for static asset serving
const MIME: Record<string, string> = {
  ".html": "text/html; charset=UTF-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export interface DashboardOptions {
  port: number;
  token: string;
  registry: Registry;
  conn: ServerConnection;
}

export async function startDashboard(options: DashboardOptions): Promise<void> {
  const { port, token, registry, conn } = options;
  const app = new Hono();

  // Resolve XDG_RUNTIME_DIR once at startup for the current user
  const xdgRuntimeDir = await resolveXdgRuntimeDir(conn);

  const health = new HealthChecker(conn, registry, xdgRuntimeDir);
  const lifecycle = new Lifecycle(conn, registry, xdgRuntimeDir);
  const monitor = new Monitor(health);

  // Structured error helper — all API error responses go through this function.
  // Returns { error: <human message for logs>, code: <machine code for i18n> }.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function apiError(c: Context<any, any, any>, status: number, code: string, message: string) {
    return c.json({ error: message, code }, status as 400 | 401 | 403 | 404 | 409 | 500);
  }

  // Auth middleware for API routes
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${token}`) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    await next();
  });

  // --- API routes ---

  app.get("/api/instances", async (c) => {
    const statuses = await health.checkAll();
    // Merge health status with DB instance fields (state, display_name, etc.)
    // and enrich with gatewayToken
    const enriched = await Promise.all(
      statuses.map(async (s) => {
        const instance = registry.getInstance(s.slug);
        const gatewayToken = instance
          ? await readGatewayToken(conn, instance.state_dir)
          : null;
        // instance fields first, then health fields override (gateway, systemd, etc.)
        return { ...instance, ...s, gatewayToken };
      }),
    );
    return c.json(enriched);
  });

  app.get("/api/instances/:slug", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");
    const [status, gatewayToken] = await Promise.all([
      health.check(slug),
      readGatewayToken(conn, instance.state_dir),
    ]);
    return c.json({ instance, status, gatewayToken });
  });

  app.get("/api/instances/:slug/agents", (c) => {
    const slug = c.req.param("slug");
    const agents = registry.listAgents(slug);
    return c.json(agents);
  });

  // POST /api/instances/:slug/agents/sync — trigger a full agent workspace sync
  app.post("/api/instances/:slug/agents/sync", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    try {
      const agentSync = new AgentSync(conn, registry);
      const result = await agentSync.sync(instance);
      return c.json({ synced: true, ...result });
    } catch (err) {
      return apiError(c, 500, "SYNC_FAILED", err instanceof Error ? err.message : "Sync failed");
    }
  });

  // GET /api/instances/:slug/agents/builder — full builder payload (agents + links + file summaries)
  app.get("/api/instances/:slug/agents/builder", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    const agents = registry.listAgents(slug);
    const links = registry.listAgentLinks(instance.id);

    // For each agent, attach a file summary (no content — content is fetched separately)
    const agentsWithFiles = agents.map((agent) => {
      const files = registry.listAgentFiles(agent.id).map((f) => ({
        filename: f.filename,
        content_hash: f.content_hash,
        size: f.content ? f.content.length : 0,
        updated_at: f.updated_at,
      }));
      return {
        id: agent.id,
        agent_id: agent.agent_id,
        name: agent.name,
        model: agent.model,
        workspace_path: agent.workspace_path,
        is_default: agent.is_default === 1,
        role: agent.role ?? null,
        tags: agent.tags ?? null,
        notes: agent.notes ?? null,
        synced_at: agent.synced_at ?? null,
        position_x: agent.position_x ?? null,
        position_y: agent.position_y ?? null,
        files,
      };
    });

    return c.json({
      instance: {
        slug: instance.slug,
        display_name: instance.display_name,
        port: instance.port,
        state: instance.state,
        default_model: instance.default_model,
      },
      agents: agentsWithFiles,
      links: links.map((l) => ({
        source_agent_id: l.source_agent_id,
        target_agent_id: l.target_agent_id,
        link_type: l.link_type,
      })),
    });
  });

  // PATCH /api/instances/:slug/agents/:agentId/position — persist canvas position
  app.patch("/api/instances/:slug/agents/:agentId/position", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    let body: { x: number; y: number };
    try {
      body = await c.req.json() as { x: number; y: number };
      if (typeof body.x !== "number" || typeof body.y !== "number") {
        return apiError(c, 400, "FIELD_INVALID", "x and y must be numbers");
      }
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const agent = registry.getAgentByAgentId(instance.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    registry.updateAgentPosition(agent.id, body.x, body.y);
    return c.json({ ok: true });
  });

  // POST /api/instances/:slug/agents — create a new agent
  app.post("/api/instances/:slug/agents", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    let body: CreateAgentData;
    try {
      body = await c.req.json() as CreateAgentData;
      if (!body.agentSlug || !body.name || !body.provider || !body.model) {
        return apiError(c, 400, "FIELD_REQUIRED", "Missing required fields: agentSlug, name, provider, model");
      }
      // Validate slug format
      if (!/^[a-z][a-z0-9-]*$/.test(body.agentSlug) || body.agentSlug.length < 2 || body.agentSlug.length > 30) {
        return apiError(c, 400, "INVALID_AGENT_ID", "Invalid agentSlug: must be 2-30 lowercase alphanumeric chars with hyphens");
      }
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    try {
      const provisioner = new AgentProvisioner(conn, registry);
      await provisioner.createAgent(instance, body);
    } catch (err: unknown) {
      return apiError(c, 500, "AGENT_CREATE_FAILED", err instanceof Error ? err.message : "Agent create failed");
    }

    // Restart daemon fire-and-forget
    conn.execFile("systemctl", ["--user", "restart", instance.systemd_unit], {
      env: { XDG_RUNTIME_DIR: xdgRuntimeDir },
    }).catch(() => { /* best-effort restart */ });

    // Return fresh builder payload
    const agents = registry.listAgents(slug);
    const links = registry.listAgentLinks(instance.id);
    const agentsWithFiles = agents.map((agent) => {
      const files = registry.listAgentFiles(agent.id).map((f) => ({
        filename: f.filename,
        content_hash: f.content_hash,
        size: f.content ? f.content.length : 0,
        updated_at: f.updated_at,
      }));
      return {
        id: agent.id,
        agent_id: agent.agent_id,
        name: agent.name,
        model: agent.model,
        workspace_path: agent.workspace_path,
        is_default: agent.is_default === 1,
        role: agent.role ?? null,
        tags: agent.tags ?? null,
        notes: agent.notes ?? null,
        synced_at: agent.synced_at ?? null,
        position_x: agent.position_x ?? null,
        position_y: agent.position_y ?? null,
        files,
      };
    });

    return c.json({
      instance: {
        slug: instance.slug,
        display_name: instance.display_name,
        port: instance.port,
        state: instance.state,
        default_model: instance.default_model,
      },
      agents: agentsWithFiles,
      links: links.map((l) => ({
        source_agent_id: l.source_agent_id,
        target_agent_id: l.target_agent_id,
        link_type: l.link_type,
      })),
    }, 201);
  });

  // DELETE /api/instances/:slug/agents/:agentId — delete an agent
  app.delete("/api/instances/:slug/agents/:agentId", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    try {
      const provisioner = new AgentProvisioner(conn, registry);
      await provisioner.deleteAgent(instance, agentId);
    } catch (err: unknown) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "AGENT_NOT_FOUND", err.message);
      }
      return apiError(c, 500, "AGENT_DELETE_FAILED", err instanceof Error ? err.message : "Agent delete failed");
    }

    // Restart daemon fire-and-forget
    conn.execFile("systemctl", ["--user", "restart", instance.systemd_unit], {
      env: { XDG_RUNTIME_DIR: xdgRuntimeDir },
    }).catch(() => { /* best-effort restart */ });

    // Return fresh builder payload
    const agents = registry.listAgents(slug);
    const links = registry.listAgentLinks(instance.id);
    const agentsWithFiles = agents.map((agent) => {
      const files = registry.listAgentFiles(agent.id).map((f) => ({
        filename: f.filename,
        content_hash: f.content_hash,
        size: f.content ? f.content.length : 0,
        updated_at: f.updated_at,
      }));
      return {
        id: agent.id,
        agent_id: agent.agent_id,
        name: agent.name,
        model: agent.model,
        workspace_path: agent.workspace_path,
        is_default: agent.is_default === 1,
        role: agent.role ?? null,
        tags: agent.tags ?? null,
        notes: agent.notes ?? null,
        synced_at: agent.synced_at ?? null,
        position_x: agent.position_x ?? null,
        position_y: agent.position_y ?? null,
        files,
      };
    });

    return c.json({
      instance: {
        slug: instance.slug,
        display_name: instance.display_name,
        port: instance.port,
        state: instance.state,
        default_model: instance.default_model,
      },
      agents: agentsWithFiles,
      links: links.map((l) => ({
        source_agent_id: l.source_agent_id,
        target_agent_id: l.target_agent_id,
        link_type: l.link_type,
      })),
    }, 200);
  });

  // PATCH /api/instances/:slug/agents/:agentId/spawn-links — update spawn targets in openclaw.json
  app.patch("/api/instances/:slug/agents/:agentId/spawn-links", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    let body: { targets: string[] };
    try {
      body = await c.req.json();
      if (!Array.isArray(body.targets) || !body.targets.every((t: unknown) => typeof t === "string")) {
        return apiError(c, 400, "FIELD_INVALID", "targets must be an array of strings");
      }
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    try {
      // 1. Read and parse openclaw.json
      const configRaw = await conn.readFile(instance.config_path);
      const config = JSON.parse(configRaw) as Record<string, unknown>;
      const agentsConf = config["agents"] as Record<string, unknown> | undefined;

      // 2. Update the allowAgents array for the target agent
      // For "main": prefer agents.list[id=main] if it exists, otherwise fall back to agents.defaults
      const agentsList = (agentsConf?.["list"] ?? []) as Array<Record<string, unknown>>;
      const listEntry = agentsList.find((a) => a["id"] === agentId);

      if (listEntry) {
        // Agent has an explicit entry in agents.list — update there
        let subagents = listEntry["subagents"] as Record<string, unknown> | undefined;
        if (!subagents) {
          subagents = {};
          listEntry["subagents"] = subagents;
        }
        subagents["allowAgents"] = body.targets;
      } else if (agentId === "main") {
        // main with no list entry — update agents.defaults.subagents
        const defaults = agentsConf?.["defaults"] as Record<string, unknown> | undefined;
        if (defaults) {
          let subagents = defaults["subagents"] as Record<string, unknown> | undefined;
          if (!subagents) {
            subagents = {};
            defaults["subagents"] = subagents;
          }
          subagents["allowAgents"] = body.targets;
        }
      } else {
        return apiError(c, 404, "AGENT_NOT_FOUND", `Agent '${agentId}' not found in config`);
      }

      // 3. Write back openclaw.json
      await conn.writeFile(instance.config_path, JSON.stringify(config, null, 2));

      // 4. Re-sync agents to update DB + links from the new config (before restart so it always succeeds)
      const agentSync = new AgentSync(conn, registry);
      const result = await agentSync.sync(instance);

      // 5. Restart the daemon fire-and-forget (don't wait for health — instance may be unhealthy)
      conn.execFile("systemctl", ["--user", "restart", instance.systemd_unit], {
        env: { XDG_RUNTIME_DIR: xdgRuntimeDir },
      }).catch(() => { /* best-effort restart */ });

      return c.json({
        ok: true,
        links: result.links.map((l) => ({
          source_agent_id: l.source_agent_id,
          target_agent_id: l.target_agent_id,
          link_type: l.link_type,
        })),
      });
    } catch (err) {
      return apiError(c, 500, "LINK_UPDATE_FAILED", err instanceof Error ? err.message : "Failed to update spawn links");
    }
  });

  // GET /api/instances/:slug/agents/:agentId/files/:filename — fetch a single workspace file
  app.get("/api/instances/:slug/agents/:agentId/files/:filename", (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const filename = c.req.param("filename");

    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    const agent = registry.getAgentByAgentId(instance.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    const file = registry.getAgentFileContent(agent.id, filename);
    if (!file) return apiError(c, 404, "FILE_NOT_FOUND", "File not found");

    return c.json({
      filename: file.filename,
      content: file.content ?? "",
      content_hash: file.content_hash ?? "",
      updated_at: file.updated_at ?? "",
      editable: EDITABLE_FILES.has(filename),
    });
  });

  // PUT /api/instances/:slug/agents/:agentId/files/:filename — update a workspace file
  app.put("/api/instances/:slug/agents/:agentId/files/:filename", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const filename = c.req.param("filename");

    if (!EDITABLE_FILES.has(filename)) {
      return apiError(c, 403, "FILE_NOT_EDITABLE", "File is not editable");
    }

    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    const agentRecord = registry.getAgentByAgentId(instance.id, agentId);
    if (!agentRecord) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    let body: { content?: string };
    try {
      body = await c.req.json<{ content?: string }>();
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }
    if (typeof body.content !== "string") {
      return apiError(c, 400, "FIELD_REQUIRED", "content is required");
    }

    try {
      const provisioner = new AgentProvisioner(conn, registry);
      await provisioner.updateAgentFile(instance, agentId, filename, body.content);
    } catch (err: unknown) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "FILE_NOT_FOUND", err.message);
      }
      if (err instanceof ClawPilotError && err.message.includes("not editable")) {
        return apiError(c, 403, "FILE_NOT_EDITABLE", err.message);
      }
      return apiError(c, 500, "FILE_SAVE_FAILED", err instanceof Error ? err.message : "File save failed");
    }

    // Restart daemon fire-and-forget
    conn.execFile("systemctl", ["--user", "restart", instance.systemd_unit], {
      env: { XDG_RUNTIME_DIR: xdgRuntimeDir },
    }).catch(() => { /* best-effort restart */ });

    // Return updated file record
    const updatedFile = registry.getAgentFileContent(agentRecord.id, filename);
    return c.json({
      filename,
      content: updatedFile?.content ?? body.content,
      content_hash: updatedFile?.content_hash ?? "",
      updated_at: updatedFile?.updated_at ?? new Date().toISOString(),
      editable: true,
    }, 200);
  });

  app.get("/api/instances/:slug/conversations", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 100);

    try {
      const runsPath = `${instance.state_dir}/subagents/runs.json`;
      const raw = await conn.readFile(runsPath);
      const data = JSON.parse(raw) as {
        version: number;
        runs: Record<string, {
          createdAt: number;
          requesterDisplayKey: string;
          childSessionKey: string;
          label?: string;
          task: string;
          endedAt?: number;
          outcome?: string;
        }>;
      };

      const entries = Object.values(data.runs ?? {})
        .map((run) => ({
          timestamp: run.createdAt,
          from: run.requesterDisplayKey || "unknown",
          to: run.label || run.childSessionKey || "agent",
          message: run.task || "",
          type: "agent-agent" as const,
          status: run.endedAt
            ? run.outcome === "completed" ? "done" : "failed"
            : "running",
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);

      return c.json({ entries });
    } catch {
      return c.json({ entries: [] });
    }
  });

  app.get("/api/instances/:slug/health", async (c) => {
    const slug = c.req.param("slug");
    try {
      const status = await health.check(slug);
      return c.json(status);
    } catch (err) {
      return apiError(c, 500, "INTERNAL_ERROR", err instanceof Error ? err.message : "Unknown error");
    }
  });

  app.post("/api/instances/:slug/start", async (c) => {
    const slug = c.req.param("slug");
    try {
      await lifecycle.start(slug);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "NOT_FOUND", err.message);
      }
      return apiError(c, 500, "LIFECYCLE_FAILED", err instanceof Error ? err.message : "Start failed");
    }
  });

  app.post("/api/instances/:slug/stop", async (c) => {
    const slug = c.req.param("slug");
    try {
      await lifecycle.stop(slug);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "NOT_FOUND", err.message);
      }
      return apiError(c, 500, "LIFECYCLE_FAILED", err instanceof Error ? err.message : "Stop failed");
    }
  });

  app.post("/api/instances/:slug/restart", async (c) => {
    const slug = c.req.param("slug");
    try {
      await lifecycle.restart(slug);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "NOT_FOUND", err.message);
      }
      return apiError(c, 500, "LIFECYCLE_FAILED", err instanceof Error ? err.message : "Restart failed");
    }
  });

  app.delete("/api/instances/:slug", async (c) => {
    const slug = c.req.param("slug");
    try {
      const destroyer = new Destroyer(conn, registry, xdgRuntimeDir);
      await destroyer.destroy(slug);
      return c.json({ ok: true, slug });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "NOT_FOUND", err.message);
      }
      return apiError(c, 500, "DESTROY_FAILED", err instanceof Error ? err.message : "Destroy failed");
    }
  });

  app.get("/api/health", (c) => {
    return c.json({ ok: true, instances: registry.listInstances().length });
  });

  // GET /api/next-port — suggest next free port in the configured range
  app.get("/api/next-port", async (c) => {
    const server = registry.getLocalServer();
    if (!server) return apiError(c, 500, "SERVER_NOT_INIT", "Server not initialized. Run claw-pilot init first.");
    try {
      const portAllocator = new PortAllocator(registry, conn);
      const nextPort = await portAllocator.findFreePort(server.id);
      return c.json({ port: nextPort });
    } catch (err) {
      return apiError(c, 500, "INTERNAL_ERROR", err instanceof Error ? err.message : "No free port available");
    }
  });

  // GET /api/providers — list available providers with their model catalogs
  app.get("/api/providers", async (c) => {
    const existing = registry.listInstances();
    let canReuseCredentials = false;
    let sourceInstance: string | null = null;

    // Start from the full catalog (deep copy to allow per-request mutation)
    const providers: ProviderInfo[] = PROVIDER_CATALOG.map((p) => ({ ...p, models: [...p.models] }));

    // Detect reuse capability from existing instance config
    if (existing.length > 0) {
      const source = existing[0]!;
      sourceInstance = source.slug;

      try {
        const raw = await conn.readFile(source.config_path);
        const cfg = JSON.parse(raw) as {
          models?: { providers?: Record<string, unknown> };
          auth?: { profiles?: Record<string, { provider?: string }> };
        };

        // Detect providers from models.providers block
        const cfgProviderIds = new Set(Object.keys(cfg.models?.providers ?? {}));

        // Also detect opencode from auth.profiles
        const profiles = cfg.auth?.profiles ?? {};
        for (const profile of Object.values(profiles)) {
          if (profile.provider === "opencode") cfgProviderIds.add("opencode");
        }

        if (cfgProviderIds.size > 0) {
          canReuseCredentials = true;
          // Mark matching providers as reusable (no key required)
          for (const p of providers) {
            if (cfgProviderIds.has(p.id)) {
              p.requiresKey = false;
              p.label = p.id === "opencode"
                ? `${p.label} (via ${source.slug})`
                : `${p.label} (reuse from ${source.slug})`;
              p.isDefault = true;
            }
          }
        }
      } catch {
        // Non-fatal: source config unreadable → fall through to defaults
      }
    }

    // Mark first provider as default if none marked yet
    if (!providers.some((p) => p.isDefault)) {
      providers[0]!.isDefault = true;
    }

    return c.json({ canReuseCredentials, sourceInstance, providers });
  });

  // POST /api/instances — provision a new instance
  app.post("/api/instances", async (c) => {
    const server = registry.getLocalServer();
    if (!server) return apiError(c, 500, "SERVER_NOT_INIT", "Server not initialized. Run claw-pilot init first.");

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    // Basic validation
    const slug = body["slug"];
    const port = body["port"];
    const defaultModel = body["defaultModel"];
    const provider = body["provider"];
    const apiKey   = body["apiKey"];

    if (typeof slug !== "string" || !/^[a-z][a-z0-9-]*$/.test(slug) || slug.length < 2 || slug.length > 30) {
      return apiError(c, 400, "INVALID_INSTANCE_SLUG", "Invalid slug: must be 2-30 lowercase alphanumeric chars with hyphens");
    }
    if (typeof port !== "number" || port < 1024 || port > 65535) {
      return apiError(c, 400, "FIELD_INVALID", "Invalid port: must be 1024-65535");
    }
    if (typeof defaultModel !== "string" || !defaultModel) {
      return apiError(c, 400, "FIELD_REQUIRED", "defaultModel is required");
    }
    if (typeof provider !== "string" || !provider) {
      return apiError(c, 400, "FIELD_REQUIRED", "provider is required");
    }
    if (typeof apiKey !== "string") {
      return apiError(c, 400, "FIELD_INVALID", "apiKey must be a string (use '' for providers that need no key)");
    }

    // Build WizardAnswers from simplified web form
    const rawAgents = Array.isArray(body["agents"]) ? body["agents"] : [];
    const agents: WizardAnswers["agents"] = rawAgents.length > 0
      ? (rawAgents as Array<{ id: string; name: string; model?: string; isDefault?: boolean }>)
      : [{ id: "main", name: "Main", isDefault: true }];

    // Ensure main agent is always present
    if (!agents.some((a) => a.id === "main" || a.isDefault)) {
      agents.unshift({ id: "main", name: "Main", isDefault: true });
    }

    const answers: WizardAnswers = {
      slug,
      displayName: typeof body["displayName"] === "string" && body["displayName"]
        ? body["displayName"]
        : slug.charAt(0).toUpperCase() + slug.slice(1),
      port,
      agents,
      defaultModel,
      provider,
      apiKey,
      telegram: { enabled: false },
      mem0:     { enabled: false },
    };

    try {
      const portAllocator = new PortAllocator(registry, conn);
      const provisioner = new Provisioner(conn, registry, portAllocator);
      const blueprintId = typeof body.blueprintId === "number" ? body.blueprintId : undefined;
      const result = await provisioner.provision(answers, server.id, blueprintId);

      // Attempt device pairing bootstrap (non-fatal)
      try {
        const pairing = new PairingManager(conn, registry);
        await pairing.bootstrapDevicePairing(slug as string);
      } catch {
        // Pairing is best-effort — don't fail the whole request
      }

      return c.json(result, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Provisioning failed";
      if (err instanceof ClawPilotError && (
        err.code === "NO_EXISTING_INSTANCE" ||
        err.code === "ENV_READ_FAILED" ||
        err.code === "API_KEY_READ_FAILED"
      )) {
        return apiError(c, 400, "PROVISION_FAILED", msg);
      }
      return apiError(c, 500, "PROVISION_FAILED", msg);
    }
  });

  // --- Blueprint routes ---

  /**
   * Seed workspace files (AGENTS.md, SOUL.md, etc.) for a blueprint agent.
   * Reads templates from templates/workspace/ and stores them in the DB.
   * Called both on blueprint creation (main agent) and when adding a new agent.
   */
  async function seedBlueprintAgentFiles(
    reg: Registry,
    agentDbId: number,
    agentId: string,
    agentName: string,
  ): Promise<void> {
    const { createHash } = await import("node:crypto");

    // Resolve templates directory.
    // In dev: src/dashboard/ → ../templates/workspace = templates/workspace ✓
    // In prod: dist/ → ../templates/workspace = templates/workspace ✓
    const templateDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../templates/workspace",
    );

    // Seed the 6 standard workspace files (no MEMORY.md — runtime only)
    const templateFiles = ["AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md", "IDENTITY.md", "HEARTBEAT.md"];
    const date = new Date().toISOString().split("T")[0]!;

    for (const filename of templateFiles) {
      let content: string;
      try {
        content = await fs.readFile(path.join(templateDir, filename), "utf-8");
      } catch {
        content = `# ${filename}\n`;
      }

      // Apply simple template substitutions where relevant
      content = content
        .replace(/\{\{agentId\}\}/g, agentId)
        .replace(/\{\{agentName\}\}/g, agentName)
        .replace(/\{\{instanceSlug\}\}/g, "blueprint")
        .replace(/\{\{instanceName\}\}/g, "Blueprint")
        .replace(/\{\{date\}\}/g, date)
        // Strip {{#each agents}}...{{/each}} blocks (no agents list in a fresh blueprint)
        .replace(/\{\{#each agents\}\}[\s\S]*?\{\{\/each\}\}/g, "");

      const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      reg.upsertAgentFile(agentDbId, { filename, content, contentHash });
    }
  }

  /**
   * Seed the default "main" agent into a newly created blueprint.
   * Mirrors the implicit "main" agent that OpenClaw creates on every fresh instance.
   */
  async function seedBlueprintMainAgent(reg: Registry, blueprintId: number): Promise<void> {
    // Create the main agent row
    const mainAgent = reg.createBlueprintAgent(blueprintId, {
      agentId: "main",
      name: "Main",
      isDefault: true,
    });

    // Centre it on the canvas
    reg.updateBlueprintAgentPosition(mainAgent.id, 400, 300);

    // Seed workspace files
    await seedBlueprintAgentFiles(reg, mainAgent.id, "main", "Main");
  }

  // Helper: build the full builder payload for a blueprint
  function buildBlueprintPayload(blueprintId: number, reg: Registry) {
    const data = reg.getBlueprintBuilderData(blueprintId);
    if (!data) return null;
    const agentsWithFiles = data.agents.map((agent) => {
      const files = reg.listAgentFiles(agent.id).map((f) => ({
        filename: f.filename,
        content_hash: f.content_hash,
        size: f.content ? f.content.length : 0,
        updated_at: f.updated_at,
      }));
      return {
        id: agent.id,
        agent_id: agent.agent_id,
        name: agent.name,
        model: agent.model,
        workspace_path: agent.workspace_path,
        is_default: agent.is_default === 1,
        role: agent.role ?? null,
        tags: agent.tags ?? null,
        notes: agent.notes ?? null,
        synced_at: agent.synced_at ?? null,
        position_x: agent.position_x ?? null,
        position_y: agent.position_y ?? null,
        files,
      };
    });
    return {
      blueprint: data.blueprint,
      agents: agentsWithFiles,
      links: data.links.map((l) => ({
        source_agent_id: l.source_agent_id,
        target_agent_id: l.target_agent_id,
        link_type: l.link_type,
      })),
    };
  }

  // GET /api/blueprints — liste tous les blueprints
  app.get("/api/blueprints", (c) => {
    const blueprints = registry.listBlueprints();
    return c.json(blueprints);
  });

  // POST /api/blueprints — créer un blueprint
  app.post("/api/blueprints", async (c) => {
    let body: { name: string; description?: string; icon?: string; tags?: string; color?: string };
    try {
      body = await c.req.json() as typeof body;
      if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
        return apiError(c, 400, "BLUEPRINT_NAME_REQUIRED", "name is required");
      }
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }
    try {
      const blueprint = registry.createBlueprint({
        name: body.name.trim(),
        description: body.description,
        icon: body.icon,
        tags: body.tags,
        color: body.color,
      });

      // Seed default "main" agent — every blueprint starts with one
      await seedBlueprintMainAgent(registry, blueprint.id);

      return c.json(blueprint, 201);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE")) return apiError(c, 409, "BLUEPRINT_NAME_TAKEN", "A blueprint with this name already exists");
      return apiError(c, 500, "INTERNAL_ERROR", msg);
    }
  });

  // GET /api/blueprints/:id — détail d'un blueprint
  app.get("/api/blueprints/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");
    return c.json(blueprint);
  });

  // PUT /api/blueprints/:id — mettre à jour un blueprint
  app.put("/api/blueprints/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");

    let body: Partial<{ name: string; description: string | null; icon: string | null; tags: string | null; color: string | null }>;
    try {
      body = await c.req.json() as typeof body;
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    try {
      const updated = registry.updateBlueprint(id, body);
      return c.json(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE")) return apiError(c, 409, "BLUEPRINT_NAME_TAKEN", "A blueprint with this name already exists");
      return apiError(c, 500, "INTERNAL_ERROR", msg);
    }
  });

  // DELETE /api/blueprints/:id — supprimer un blueprint
  app.delete("/api/blueprints/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");
    registry.deleteBlueprint(id);
    return c.json({ ok: true });
  });

  // GET /api/blueprints/:id/builder — payload complet builder
  app.get("/api/blueprints/:id/builder", (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
    const payload = buildBlueprintPayload(id, registry);
    if (!payload) return apiError(c, 404, "NOT_FOUND", "Not found");
    return c.json(payload);
  });

  // POST /api/blueprints/:id/agents — créer un agent dans un blueprint
  app.post("/api/blueprints/:id/agents", async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");

    let body: { agent_id: string; name: string; model?: string };
    try {
      body = await c.req.json() as typeof body;
      if (!body.agent_id || !body.name) {
        return apiError(c, 400, "FIELD_REQUIRED", "agent_id and name are required");
      }
      if (!/^[a-z][a-z0-9-]*$/.test(body.agent_id) || body.agent_id.length < 2 || body.agent_id.length > 30) {
        return apiError(c, 400, "INVALID_AGENT_ID", "Invalid agent_id: must be 2-30 lowercase alphanumeric chars with hyphens");
      }
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    let newAgent;
    try {
      newAgent = registry.createBlueprintAgent(id, {
        agentId: body.agent_id,
        name: body.name,
        model: body.model,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("UNIQUE")) return apiError(c, 409, "AGENT_ID_TAKEN", "An agent with this id already exists in this blueprint");
      return apiError(c, 500, "INTERNAL_ERROR", errMsg);
    }

    // Seed workspace files for the new agent (same as for the default main agent)
    await seedBlueprintAgentFiles(registry, newAgent.id, body.agent_id, body.name);

    const payload = buildBlueprintPayload(id, registry);
    return c.json(payload, 201);
  });

  // DELETE /api/blueprints/:id/agents/:agentId — supprimer un agent
  app.delete("/api/blueprints/:id/agents/:agentId", (c) => {
    const id = Number(c.req.param("id"));
    const agentId = c.req.param("agentId");
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");
    const agent = registry.getBlueprintAgent(id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");
    registry.deleteBlueprintAgent(id, agentId);
    const payload = buildBlueprintPayload(id, registry);
    return c.json(payload);
  });

  // PATCH /api/blueprints/:id/agents/:agentId/position — position canvas
  app.patch("/api/blueprints/:id/agents/:agentId/position", async (c) => {
    const id = Number(c.req.param("id"));
    const agentId = c.req.param("agentId");
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");

    let body: { x: number; y: number };
    try {
      body = await c.req.json() as { x: number; y: number };
      if (typeof body.x !== "number" || typeof body.y !== "number") {
        return apiError(c, 400, "FIELD_INVALID", "x and y must be numbers");
      }
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const agent = registry.getBlueprintAgent(id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");
    registry.updateBlueprintAgentPosition(agent.id, body.x, body.y);
    return c.json({ ok: true });
  });

  // GET /api/blueprints/:id/agents/:agentId/files/:filename — lire un fichier
  app.get("/api/blueprints/:id/agents/:agentId/files/:filename", (c) => {
    const id = Number(c.req.param("id"));
    const agentId = c.req.param("agentId");
    const filename = c.req.param("filename");
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");

    const agent = registry.getBlueprintAgent(id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    const file = registry.getAgentFileContent(agent.id, filename);
    if (!file) return apiError(c, 404, "FILE_NOT_FOUND", "File not found");

    return c.json({
      filename: file.filename,
      content: file.content ?? "",
      content_hash: file.content_hash ?? "",
      updated_at: file.updated_at ?? "",
      editable: true,
    });
  });

  // PUT /api/blueprints/:id/agents/:agentId/files/:filename — écrire un fichier
  app.put("/api/blueprints/:id/agents/:agentId/files/:filename", async (c) => {
    const id = Number(c.req.param("id"));
    const agentId = c.req.param("agentId");
    const filename = c.req.param("filename");
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");

    let body: { content: string };
    try {
      body = await c.req.json() as { content: string };
      if (typeof body.content !== "string") return apiError(c, 400, "FIELD_INVALID", "content must be a string");
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const agent = registry.getBlueprintAgent(id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    try {
      const { createHash } = await import("node:crypto");
      const contentHash = createHash("sha256").update(body.content).digest("hex").slice(0, 16);
      registry.upsertAgentFile(agent.id, {
        filename,
        content: body.content,
        contentHash,
      });
    } catch (err: unknown) {
      return apiError(c, 500, "FILE_SAVE_FAILED", err instanceof Error ? err.message : "File save failed");
    }

    // Return AgentFileContent shape (same as instance file route) so the
    // shared agent-detail-panel can handle both contexts uniformly.
    const saved = registry.getAgentFileContent(agent.id, filename);
    return c.json({
      filename,
      content: body.content,
      content_hash: saved?.content_hash ?? "",
      updated_at: saved?.updated_at ?? new Date().toISOString(),
      editable: true,
    });
  });

  // PATCH /api/blueprints/:id/agents/:agentId/spawn-links — modifier les liens spawn
  app.patch("/api/blueprints/:id/agents/:agentId/spawn-links", async (c) => {
    const id = Number(c.req.param("id"));
    const agentId = c.req.param("agentId");
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");

    let body: { targets: string[] };
    try {
      body = await c.req.json() as { targets: string[] };
      if (!Array.isArray(body.targets)) return apiError(c, 400, "FIELD_INVALID", "targets must be an array");
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");

    // Get all current links for this blueprint, keep non-spawn links for this agent, replace spawn links
    const allLinks = registry.listBlueprintLinks(id);
    const otherLinks = allLinks.filter(
      (l) => !(l.source_agent_id === agentId && l.link_type === "spawn"),
    );
    const newSpawnLinks = body.targets.map((target) => ({
      sourceAgentId: agentId,
      targetAgentId: target,
      linkType: "spawn" as const,
    }));
    const mergedLinks = [
      ...otherLinks.map((l) => ({
        sourceAgentId: l.source_agent_id,
        targetAgentId: l.target_agent_id,
        linkType: l.link_type,
      })),
      ...newSpawnLinks,
    ];
    registry.replaceBlueprintLinks(id, mergedLinks);

    // Return { ok, links } — same shape as the instance spawn-links route so
    // the shared agent-detail-panel can handle both contexts uniformly.
    const updatedLinks = registry.listBlueprintLinks(id).map((l) => ({
      source_agent_id: l.source_agent_id,
      target_agent_id: l.target_agent_id,
      link_type: l.link_type,
    }));
    return c.json({ ok: true, links: updatedLinks });
  });

  // --- Team export/import routes ---

  // GET /api/instances/:slug/team/export — export instance team as YAML
  app.get("/api/instances/:slug/team/export", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    try {
      const team = await exportInstanceTeam(conn, registry, instance);
      const yaml = serializeTeamYaml(team);
      return new Response(yaml, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${slug}-team.yaml"`,
        },
      });
    } catch (err) {
      return apiError(c, 500, "EXPORT_FAILED", err instanceof Error ? err.message : "Export failed");
    }
  });

  // POST /api/instances/:slug/team/import — import team YAML into instance
  app.post("/api/instances/:slug/team/import", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    const dryRun = c.req.query("dry_run") === "true";

    let yamlContent: string;
    try {
      yamlContent = await c.req.text();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Could not read request body");
    }

    const parsed = parseAndValidateTeam(yamlContent);
    if (!parsed.success) {
      return c.json(parsed.error, 400);
    }

    try {
      const result = await importInstanceTeam(
        registry.getDb(),
        registry,
        conn,
        instance,
        parsed.data,
        xdgRuntimeDir,
        dryRun,
      );
      return c.json(result);
    } catch (err) {
      return apiError(c, 500, "IMPORT_FAILED", err instanceof Error ? err.message : "Import failed");
    }
  });

  // GET /api/blueprints/:id/team/export — export blueprint team as YAML
  app.get("/api/blueprints/:id/team/export", (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");

    try {
      const team = exportBlueprintTeam(registry, id);
      const yaml = serializeTeamYaml(team);
      const blueprint = registry.getBlueprint(id);
      const filename = blueprint ? `${blueprint.name.toLowerCase().replace(/\s+/g, "-")}-team.yaml` : `blueprint-${id}-team.yaml`;
      return new Response(yaml, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } catch (err) {
      return apiError(c, 500, "EXPORT_FAILED", err instanceof Error ? err.message : "Export failed");
    }
  });

  // POST /api/blueprints/:id/team/import — import team YAML into blueprint
  app.post("/api/blueprints/:id/team/import", async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");

    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");

    const dryRun = c.req.query("dry_run") === "true";

    let yamlContent: string;
    try {
      yamlContent = await c.req.text();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Could not read request body");
    }

    const parsed = parseAndValidateTeam(yamlContent);
    if (!parsed.success) {
      return c.json(parsed.error, 400);
    }

    try {
      const result = importBlueprintTeam(
        registry.getDb(),
        registry,
        id,
        parsed.data,
        dryRun,
      );
      return c.json(result);
    } catch (err) {
      return apiError(c, 500, "IMPORT_FAILED", err instanceof Error ? err.message : "Import failed");
    }
  });

  // --- Static file serving ---
  // Serve index.html with injected token (all non-asset routes → SPA)
  const serveIndex = async () => {
    const indexPath = path.join(UI_DIST, "index.html");
    let html = await fs.readFile(indexPath, "utf-8");
    const injection = `<script>window.__CP_TOKEN__=${JSON.stringify(token)};</script>`;
    html = html.replace("</head>", `${injection}\n</head>`);
    return html;
  };

  // SPA root
  app.get("/", async (c) => {
    try {
      return c.html(await serveIndex());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.html(`<!DOCTYPE html><html><head><title>Claw Pilot</title></head>
<body><h1>Claw Pilot Dashboard</h1>
<p>UI not built. Run <code>pnpm build:ui</code> in <code>${path.resolve(UI_DIST, "..")}</code></p>
<p><small>${msg}</small></p>
<p><a href="/api/instances">API: /api/instances</a></p></body></html>`);
    }
  });

  // Static assets — served by reading from absolute UI_DIST path
  app.get("/assets/*", async (c) => {
    const url = new URL(c.req.url, "http://localhost");
    const filePath = path.join(UI_DIST, url.pathname);
    // Prevent path traversal
    if (!filePath.startsWith(UI_DIST)) {
      return c.text("Forbidden", 403);
    }
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath);
      const mime = MIME[ext] ?? "application/octet-stream";
      return new Response(data, {
        headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable" },
      });
    } catch {
      return c.text("Not found", 404);
    }
  });

  // SPA fallback for all other routes
  app.get("*", async (c) => {
    try {
      return c.html(await serveIndex());
    } catch {
      return c.redirect("/");
    }
  });

  // Start HTTP server
  const server = serve({ fetch: app.fetch, port });

  // WebSocket server
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wss = new WebSocketServer({ server: server as any });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const wsToken = url.searchParams.get("token");
    if (wsToken !== token) {
      ws.close(1008, "Unauthorized");
      return;
    }
    monitor.addClient(ws);
  });

  monitor.start();
}
