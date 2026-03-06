// src/dashboard/routes/instances/agents.ts
// Routes: GET agents, sync, builder, CRUD agents, position, meta, files, spawn-links
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { AgentSync, EDITABLE_FILES } from "../../../core/agent-sync.js";
import { AgentProvisioner } from "../../../core/agent-provisioner.js";
import type { CreateAgentData } from "../../../core/agent-provisioner.js";
import { ClawPilotError, InstanceNotFoundError } from "../../../lib/errors.js";
import { z } from "zod/v4";
import { buildAgentPayload } from "../_helpers.js";

/** Build the standard builder response payload (agents + links + instance summary). */
function builderPayload(
  instance: { slug: string; display_name: string | null; port: number; state: string; default_model: string | null; id: number },
  registry: RouteDeps["registry"],
) {
  const agents = registry.listAgents(instance.slug);
  const links = registry.listAgentLinks(instance.id);
  return {
    instance: {
      slug: instance.slug,
      display_name: instance.display_name,
      port: instance.port,
      state: instance.state,
      default_model: instance.default_model,
    },
    agents: agents.map((agent) => buildAgentPayload(agent, registry.listAgentFiles(agent.id))),
    links: links.map((l) => ({
      source_agent_id: l.source_agent_id,
      target_agent_id: l.target_agent_id,
      link_type: l.link_type,
    })),
  };
}

export function registerAgentRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle, xdgRuntimeDir } = deps;

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

  // GET /api/instances/:slug/agents/builder — full builder payload
  app.get("/api/instances/:slug/agents/builder", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");
    return c.json(builderPayload(instance, registry));
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

  // PATCH /api/instances/:slug/agents/:agentId/meta — update SQLite-side agent fields
  const AgentMetaPatchSchema = z.object({
    role:  z.string().max(200).nullable().optional(),
    tags:  z.string().max(500).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  }).strict();

  app.patch("/api/instances/:slug/agents/:agentId/meta", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", "Not found");

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const parsed = AgentMetaPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(c, 400, "FIELD_INVALID", parsed.error.issues[0]?.message ?? "Invalid fields");
    }

    const agent = registry.getAgentByAgentId(instance.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    registry.updateAgentMeta(agent.id, parsed.data);
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
    lifecycle.restart(slug).catch(() => { /* best-effort restart */ });

    return c.json(builderPayload(instance, registry), 201);
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
    lifecycle.restart(slug).catch(() => { /* best-effort restart */ });

    return c.json(builderPayload(instance, registry), 200);
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
      const configRaw = await conn.readFile(instance.config_path);
      const config = JSON.parse(configRaw) as Record<string, unknown>;
      const agentsConf = config["agents"] as Record<string, unknown> | undefined;

      const agentsList = (agentsConf?.["list"] ?? []) as Array<Record<string, unknown>>;
      const listEntry = agentsList.find((a) => a["id"] === agentId);

      if (listEntry) {
        let subagents = listEntry["subagents"] as Record<string, unknown> | undefined;
        if (!subagents) {
          subagents = {};
          listEntry["subagents"] = subagents;
        }
        subagents["allowAgents"] = body.targets;
      } else if (agentId === "main") {
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

      await conn.writeFile(instance.config_path, JSON.stringify(config, null, 2));

      const agentSync = new AgentSync(conn, registry);
      const result = await agentSync.sync(instance);

      // Restart daemon fire-and-forget
      lifecycle.restart(slug).catch(() => { /* best-effort restart */ });

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
    lifecycle.restart(slug).catch(() => { /* best-effort restart */ });

    const updatedFile = registry.getAgentFileContent(agentRecord.id, filename);
    return c.json({
      filename,
      content: updatedFile?.content ?? body.content,
      content_hash: updatedFile?.content_hash ?? "",
      updated_at: updatedFile?.updated_at ?? new Date().toISOString(),
      editable: true,
    }, 200);
  });

}
