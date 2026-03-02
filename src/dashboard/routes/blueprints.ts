// src/dashboard/routes/blueprints.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import type { Registry } from "../../core/registry.js";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";

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
  // At runtime (bundled): dist/ → ../templates/workspace = templates/workspace ✓
  // The path is relative to the bundled output in dist/, not to this source file.
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

export function registerBlueprintRoutes(app: Hono, deps: RouteDeps) {
  const { registry } = deps;

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

    // Prevent database bloat — reject files larger than 1MB
    if (body.content.length > 1_048_576) {
      return apiError(c, 413, "CONTENT_TOO_LARGE", "File content exceeds 1MB limit");
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
}
