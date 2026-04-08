// src/dashboard/routes/blueprints.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Hono } from "hono";
import type { Registry } from "../../core/registry.js";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import { buildAgentPayload } from "./_helpers.js";
import { constants } from "../../lib/constants.js";
import { listBuiltinBlueprints } from "../../core/builtin-blueprints.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const CreateBlueprintSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(10).optional(),
  tags: z.string().max(500).optional(),
  color: z.string().max(30).optional(),
});

const UpdateBlueprintSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(10).nullable().optional(),
  tags: z.string().max(500).nullable().optional(),
  color: z.string().max(30).nullable().optional(),
});

const CreateAgentSchema = z.object({
  agent_id: z
    .string()
    .min(2)
    .max(30)
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "must be lowercase alphanumeric with hyphens, starting with a letter",
    ),
  name: z.string().min(1).max(100),
  model: z.string().max(100).optional(),
});

const UpdateAgentMetaSchema = z.object({
  role: z.string().max(200).nullable().optional(),
  tags: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  skills: z.array(z.string()).nullable().optional(),
});

const UpdateAgentPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const WriteFileSchema = z.object({
  content: z.string().max(1_048_576),
});

const UpdateSpawnLinksSchema = z.object({
  targets: z.array(z.string()),
});

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

  // Seed the standard workspace files from the single source of truth.
  // EXPORTABLE_FILES = the 6 editable files (no MEMORY.md — runtime only).
  const templateFiles = constants.EXPORTABLE_FILES;
  const date = new Date().toISOString().split("T")[0]!;

  for (const filename of templateFiles) {
    let content: string;
    try {
      content = await fs.readFile(path.join(templateDir, filename), "utf-8");
    } catch (err) {
      logger.debug("[route:blueprints] template file read failed", { error: String(err) });
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
 * Seed the default "pilot" agent into a newly created blueprint.
 * Mirrors the implicit "pilot" agent that claw-runtime creates on every fresh instance.
 */
async function seedBlueprintPilotAgent(reg: Registry, blueprintId: number): Promise<void> {
  // Create the pilot agent row
  const pilotAgent = reg.createBlueprintAgent(blueprintId, {
    agentId: "pilot",
    name: "Pilot",
    isDefault: true,
  });

  // Centre it on the canvas
  reg.updateBlueprintAgentPosition(pilotAgent.id, 400, 300);

  // Seed workspace files
  await seedBlueprintAgentFiles(reg, pilotAgent.id, "pilot", "Pilot");
}

// Helper: build the full builder payload for a blueprint
function buildBlueprintPayload(blueprintId: number, reg: Registry) {
  const data = reg.getBlueprintBuilderData(blueprintId);
  if (!data) return null;
  const agentsWithFiles = data.agents.map((agent) =>
    buildAgentPayload(agent, reg.listAgentFiles(agent.id)),
  );

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

  // GET /api/blueprints — liste tous les blueprints (DB + built-in)
  app.get("/api/blueprints", async (c) => {
    const dbBlueprints = registry.listBlueprints();
    const builtinBlueprints = await listBuiltinBlueprints();

    // Merge: built-in blueprints not yet in the DB are appended with _builtin marker
    const dbNames = new Set(dbBlueprints.map((b) => b.name));
    const builtinEntries = builtinBlueprints
      .filter((b) => !dbNames.has(b.name))
      .map((b) => ({
        id: -1, // sentinel: not in DB
        name: b.name,
        description: b.description,
        icon: null,
        tags: JSON.stringify(["builtin"]),
        color: null,
        agent_count: b.agentCount,
        created_at: "",
        updated_at: "",
        _builtin: true as const,
        _slug: b.slug,
      }));

    return c.json([...builtinEntries, ...dbBlueprints]);
  });

  // POST /api/blueprints — créer un blueprint
  app.post("/api/blueprints", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateBlueprintSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    try {
      // Normalize tags: convert to JSON array format if it's a plain string
      let normalizedTags: string | undefined;
      if (data.tags !== undefined) {
        try {
          // If it's already valid JSON, keep it as is
          JSON.parse(data.tags);
          normalizedTags = data.tags;
        } catch (err) {
          logger.debug("[route:blueprints] tags JSON parse fallback on create", {
            error: String(err),
          });
          // If it's a plain string, convert to JSON array
          normalizedTags = JSON.stringify([data.tags]);
        }
      }

      const blueprint = registry.createBlueprint({
        name: data.name.trim(),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(normalizedTags !== undefined ? { tags: normalizedTags } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
      });

      // Seed default "main" agent — every blueprint starts with one
      await seedBlueprintPilotAgent(registry, blueprint.id);

      return c.json(blueprint, 201);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE"))
        return apiError(
          c,
          409,
          "BLUEPRINT_NAME_TAKEN",
          "A blueprint with this name already exists",
        );
      return apiError(c, 500, "INTERNAL_ERROR", msg);
    }
  });

  // POST /api/blueprints/import-builtin/:slug — import a built-in blueprint into the DB
  app.post("/api/blueprints/import-builtin/:slug", async (c) => {
    const slug = c.req.param("slug");
    const { loadBuiltinBlueprint } = await import("../../core/builtin-blueprints.js");
    const builtin = await loadBuiltinBlueprint(slug);
    if (!builtin) {
      return apiError(c, 404, "NOT_FOUND", `Built-in blueprint '${slug}' not found`);
    }

    try {
      const blueprint = registry.createBlueprint({
        name: builtin.name,
        description: builtin.description,
        tags: JSON.stringify(["builtin"]),
      });

      const { importBlueprintTeam } = await import("../../core/team-import.js");
      await importBlueprintTeam(deps.db, registry, blueprint.id, builtin.teamFile);

      return c.json(blueprint, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to import built-in blueprint";
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

    const body = await c.req.json().catch(() => null);
    const parsed = UpdateBlueprintSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    try {
      // Normalize tags if provided
      let normalizedTags = data.tags;
      if (normalizedTags !== undefined && normalizedTags !== null) {
        try {
          // If it's already valid JSON, keep it as is
          JSON.parse(normalizedTags);
        } catch (err) {
          logger.debug("[route:blueprints] tags JSON parse fallback on update", {
            error: String(err),
          });
          // If it's a plain string, convert to JSON array
          normalizedTags = JSON.stringify([normalizedTags]);
        }
      }

      const updated = registry.updateBlueprint(id, {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(normalizedTags !== undefined ? { tags: normalizedTags } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
      });
      return c.json(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE"))
        return apiError(
          c,
          409,
          "BLUEPRINT_NAME_TAKEN",
          "A blueprint with this name already exists",
        );
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

    const body = await c.req.json().catch(() => null);
    const parsed = CreateAgentSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    let newAgent;
    try {
      newAgent = registry.createBlueprintAgent(id, {
        agentId: data.agent_id,
        name: data.name,
        ...(data.model !== undefined ? { model: data.model } : {}),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("UNIQUE"))
        return apiError(
          c,
          409,
          "AGENT_ID_TAKEN",
          "An agent with this id already exists in this blueprint",
        );
      return apiError(c, 500, "INTERNAL_ERROR", errMsg);
    }

    // Seed workspace files for the new agent (same as for the default main agent)
    await seedBlueprintAgentFiles(registry, newAgent.id, data.agent_id, data.name);

    const payload = buildBlueprintPayload(id, registry);
    return c.json(payload, 201);
  });

  // PATCH /api/blueprints/:id/agents/:agentId/meta — mettre à jour les métadonnées
  app.patch("/api/blueprints/:id/agents/:agentId/meta", async (c) => {
    const id = Number(c.req.param("id"));
    const agentId = c.req.param("agentId");
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");

    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");

    const agent = registry.getBlueprintAgent(id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    const body = await c.req.json().catch(() => null);
    const parsed = UpdateAgentMetaSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    const metaFields: Parameters<typeof registry.updateAgentMeta>[1] = {};
    if ("role" in data) metaFields.role = data.role;
    if ("tags" in data) metaFields.tags = data.tags;
    if ("notes" in data) metaFields.notes = data.notes;
    if ("skills" in data) metaFields.skills = data.skills;

    registry.updateAgentMeta(agent.id, metaFields);

    const payload = buildBlueprintPayload(id, registry);
    return c.json(payload);
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

    const body = await c.req.json().catch(() => null);
    const parsed = UpdateAgentPositionSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    const agent = registry.getBlueprintAgent(id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");
    registry.updateBlueprintAgentPosition(agent.id, data.x, data.y);
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

    const body = await c.req.json().catch(() => null);
    const parsed = WriteFileSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    const agent = registry.getBlueprintAgent(id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    try {
      const { createHash } = await import("node:crypto");
      const contentHash = createHash("sha256").update(data.content).digest("hex").slice(0, 16);
      registry.upsertAgentFile(agent.id, {
        filename,
        content: data.content,
        contentHash,
      });
    } catch (err: unknown) {
      return apiError(
        c,
        500,
        "FILE_SAVE_FAILED",
        err instanceof Error ? err.message : "File save failed",
      );
    }

    // Return AgentFileContent shape (same as instance file route) so the
    // shared agent-detail-panel can handle both contexts uniformly.
    const saved = registry.getAgentFileContent(agent.id, filename);
    return c.json({
      filename,
      content: data.content,
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

    const body = await c.req.json().catch(() => null);
    const parsed = UpdateSpawnLinksSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const data = parsed.data;

    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");

    // Get all current links for this blueprint, keep non-spawn links for this agent, replace spawn links
    const allLinks = registry.listBlueprintLinks(id);
    const otherLinks = allLinks.filter(
      (l) => !(l.source_agent_id === agentId && l.link_type === "spawn"),
    );
    const newSpawnLinks = data.targets.map((target) => ({
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
