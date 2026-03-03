// src/dashboard/routes/instances.ts
import type { Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import { logger } from "../../lib/logger.js";
import type { WizardAnswers } from "../../core/config-generator.js";
import { Destroyer } from "../../core/destroyer.js";
import { Provisioner } from "../../core/provisioner.js";
import { PortAllocator } from "../../core/port-allocator.js";
import { PairingManager } from "../../core/pairing.js";
import { AgentSync, EDITABLE_FILES } from "../../core/agent-sync.js";
import { AgentProvisioner } from "../../core/agent-provisioner.js";
import type { CreateAgentData } from "../../core/agent-provisioner.js";
import { ClawPilotError, InstanceNotFoundError } from "../../lib/errors.js";
import { PROVIDER_CATALOG } from "../../lib/provider-catalog.js";
import type { ProviderInfo } from "../../lib/provider-catalog.js";
// readGatewayToken replaced by tokenCache in RouteDeps for performance
import { readInstanceConfig, applyConfigPatch, ConfigPatchSchema } from "../../core/config-updater.js";
import type { ConfigPatch } from "../../core/config-updater.js";
import { DeviceManager } from "../../core/device-manager.js";
import { TelegramPairingManager } from "../../core/telegram-pairing-manager.js";

export function registerInstanceRoutes(app: Hono, deps: RouteDeps) {
  const { registry, conn, health, lifecycle, tokenCache, xdgRuntimeDir } = deps;

  app.get("/api/instances", async (c) => {
    const statuses = await health.checkAll();
    // Merge health status with DB instance fields (state, display_name, etc.)
    // and enrich with gatewayToken
    const enriched = await Promise.all(
      statuses.map(async (s) => {
        const instance = registry.getInstance(s.slug);
        const gatewayToken = instance
          ? await tokenCache.get(s.slug, instance.state_dir)
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
      tokenCache.get(slug, instance.state_dir),
    ]);
    return c.json({ instance, status, gatewayToken });
  });

  // GET /api/instances/:slug/config — structured config for the settings UI
  app.get("/api/instances/:slug/config", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    try {
      const payload = await readInstanceConfig(conn, instance.config_path, instance.state_dir);
      // Enrich with DB-only fields
      payload.general.displayName = instance.display_name ?? "";
      return c.json(payload);
    } catch (err) {
      logger.error(`[config] GET /config error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`);
      return apiError(c, 500, "CONFIG_READ_FAILED", err instanceof Error ? err.message : "Failed to read config");
    }
  });

  // PATCH /api/instances/:slug/config — apply partial config changes
  app.patch("/api/instances/:slug/config", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    let patch: ConfigPatch;
    try {
      const raw = await c.req.json();
      const result = ConfigPatchSchema.safeParse(raw);
      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        return apiError(c, 400, "INVALID_BODY", `Invalid config patch: ${issues}`);
      }
      patch = result.data as ConfigPatch;
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    logger.info(`[config] PATCH /config slug=${slug} patch=${JSON.stringify(patch)}`);

    try {
      const result = await applyConfigPatch(
        conn,
        registry,
        slug,
        instance.config_path,
        instance.state_dir,
        patch,
      );

      // If restart required and instance is running, restart the daemon
      if (result.restarted && instance.state === "running") {
        try {
          await lifecycle.restart(slug);
        } catch (err) {
          result.warnings.push(`Restart failed: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }

      logger.info(`[config] PATCH /config slug=${slug} result=${JSON.stringify(result)}`);
      return c.json(result);
    } catch (err) {
      logger.error(`[config] PATCH /config error for slug=${slug}: ${err instanceof Error ? err.message : String(err)}`);
      return apiError(c, 500, "CONFIG_PATCH_FAILED", err instanceof Error ? err.message : "Failed to apply config");
    }
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
    if (body.content.length > 1_048_576) {
      return apiError(c, 413, "CONTENT_TOO_LARGE", "File content exceeds 1MB limit");
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
      const portAllocator = new PortAllocator(registry, conn);
      const destroyer = new Destroyer(conn, registry, xdgRuntimeDir, portAllocator);
      await destroyer.destroy(slug);
      tokenCache.invalidate(slug);
      return c.json({ ok: true, slug });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "NOT_FOUND", err.message);
      }
      return apiError(c, 500, "DESTROY_FAILED", err instanceof Error ? err.message : "Destroy failed");
    }
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

  // GET /api/instances/:slug/devices — list pending + paired devices
  app.get("/api/instances/:slug/devices", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");
    const dm = new DeviceManager(conn);
    const devices = await dm.list(instance.state_dir);
    return c.json(devices);
  });

  // POST /api/instances/:slug/devices/approve — approve a pending device
  app.post("/api/instances/:slug/devices/approve", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");
    let body: { requestId?: string };
    try { body = await c.req.json(); } catch { return apiError(c, 400, "INVALID_JSON", "Invalid JSON"); }
    if (!body.requestId) return apiError(c, 400, "FIELD_REQUIRED", "requestId is required");
    const dm = new DeviceManager(conn);
    try {
      await dm.approve(instance.state_dir, body.requestId);
      return c.json({ ok: true });
    } catch (err) {
      return apiError(c, 500, "APPROVE_FAILED", err instanceof Error ? err.message : "Approve failed");
    }
  });

  // DELETE /api/instances/:slug/devices/:deviceId — revoke a paired device
  app.delete("/api/instances/:slug/devices/:deviceId", async (c) => {
    const slug = c.req.param("slug");
    const deviceId = c.req.param("deviceId");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");
    const dm = new DeviceManager(conn);
    try {
      await dm.revoke(instance.state_dir, deviceId);
      return c.json({ ok: true });
    } catch (err) {
      return apiError(c, 500, "REVOKE_FAILED", err instanceof Error ? err.message : "Revoke failed");
    }
  });

  // GET /api/instances/:slug/telegram/pairing — list pending + approved DM pairing
  app.get("/api/instances/:slug/telegram/pairing", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");
    const tm = new TelegramPairingManager(conn);
    const pairing = await tm.list(instance.state_dir);
    return c.json(pairing);
  });

  // POST /api/instances/:slug/telegram/pairing/approve — approve a pending DM pairing code
  app.post("/api/instances/:slug/telegram/pairing/approve", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");
    let body: { code?: string };
    try { body = await c.req.json(); } catch { return apiError(c, 400, "INVALID_JSON", "Invalid JSON"); }
    if (!body.code) return apiError(c, 400, "FIELD_REQUIRED", "code is required");
    const tm = new TelegramPairingManager(conn);
    try {
      await tm.approve(instance.state_dir, body.code);
      return c.json({ ok: true });
    } catch (err) {
      return apiError(c, 500, "APPROVE_FAILED", err instanceof Error ? err.message : "Approve failed");
    }
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
}
