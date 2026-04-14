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
import { upsertSearchEntry, removeSearchEntry } from "../../core/repositories/search-repository.js";
import { notifySystemStateChanged } from "./_system-state-notify.js";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

/** Normalize tags: ensure they're valid JSON array format. */
function normalizeTags(tags: string | undefined): string | undefined {
  if (tags === undefined) return undefined;
  try {
    JSON.parse(tags);
    return tags;
  } catch (err) {
    logger.debug("[route:blueprints] tags JSON parse fallback", { error: String(err) });
    return JSON.stringify([tags]);
  }
}

// ---------------------------------------------------------------------------
// Extracted route handlers
// ---------------------------------------------------------------------------

/** Handle GET /api/blueprints — list all (DB + built-in). */
async function handleListBlueprints(c: HonoContext, registry: Registry): Promise<Response> {
  const dbBlueprints = registry.listBlueprints();
  const builtinBlueprints = await listBuiltinBlueprints();

  const dbNames = new Set(dbBlueprints.map((b) => b.name));
  const builtinEntries = builtinBlueprints
    .filter((b) => !dbNames.has(b.name))
    .map((b) => ({
      id: -1,
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
}

/** Handle POST /api/blueprints — create a new blueprint. */
async function handleCreateBlueprint(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { registry } = deps;
  const body = await c.req.json().catch(() => null);
  const parsed = CreateBlueprintSchema.safeParse(body);
  if (!parsed.success) {
    const nameIssue = parsed.error.issues.find((i: { path: unknown[] }) => i.path[0] === "name");
    if (nameIssue) return apiError(c, 400, "BLUEPRINT_NAME_REQUIRED", "Blueprint name is required");
    return apiError(c, 400, "INVALID_BODY", parsed.error.message);
  }
  const data = parsed.data;

  try {
    const normalizedTags = normalizeTags(data.tags);
    const blueprint = registry.createBlueprint({
      name: data.name.trim(),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      ...(normalizedTags !== undefined ? { tags: normalizedTags } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
    });

    await seedBlueprintPilotAgent(registry, blueprint.id);

    upsertSearchEntry(deps.db, {
      entityType: "blueprint",
      entityId: String(blueprint.id),
      title: blueprint.name,
      subtitle: blueprint.description ?? "",
      routeHash: `/blueprints/${blueprint.id}/builder`,
    });

    notifySystemStateChanged("blueprint", "create");
    return c.json(blueprint, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE"))
      return apiError(c, 409, "BLUEPRINT_NAME_TAKEN", "A blueprint with this name already exists");
    return apiError(c, 500, "INTERNAL_ERROR", msg);
  }
}

/** Handle POST /api/blueprints/import-builtin/:slug. */
async function handleImportBuiltin(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { registry } = deps;
  const slug = c.req.param("slug");
  const { loadBuiltinBlueprint } = await import("../../core/builtin-blueprints.js");
  const builtin = await loadBuiltinBlueprint(slug);
  if (!builtin) return apiError(c, 404, "NOT_FOUND", `Built-in blueprint '${slug}' not found`);

  try {
    const blueprint = registry.createBlueprint({
      name: builtin.name,
      description: builtin.description,
      tags: JSON.stringify(["builtin"]),
    });

    const { importBlueprintTeam } = await import("../../core/team-import.js");
    await importBlueprintTeam(deps.db, registry, blueprint.id, builtin.teamFile);

    upsertSearchEntry(deps.db, {
      entityType: "blueprint",
      entityId: String(blueprint.id),
      title: blueprint.name,
      subtitle: blueprint.description ?? "",
      routeHash: `/blueprints/${blueprint.id}/builder`,
    });

    notifySystemStateChanged("blueprint", "create");
    return c.json(blueprint, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to import built-in blueprint";
    return apiError(c, 500, "INTERNAL_ERROR", msg);
  }
}

/** Handle PUT /api/blueprints/:id — update a blueprint. */
async function handleUpdateBlueprint(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { registry } = deps;
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
  const blueprint = registry.getBlueprint(id);
  if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");

  const body = await c.req.json().catch(() => null);
  const parsed = UpdateBlueprintSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);
  const data = parsed.data;

  try {
    let normalizedTags = data.tags;
    if (normalizedTags !== undefined && normalizedTags !== null) {
      normalizedTags = normalizeTags(normalizedTags) ?? normalizedTags;
    }

    const updated = registry.updateBlueprint(id, {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      ...(normalizedTags !== undefined ? { tags: normalizedTags } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
    });

    if (updated) {
      upsertSearchEntry(deps.db, {
        entityType: "blueprint",
        entityId: String(id),
        title: updated.name,
        subtitle: updated.description ?? "",
        routeHash: `/blueprints/${id}/builder`,
      });
    }

    return c.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE"))
      return apiError(c, 409, "BLUEPRINT_NAME_TAKEN", "A blueprint with this name already exists");
    return apiError(c, 500, "INTERNAL_ERROR", msg);
  }
}

/** Handle POST /api/blueprints/:id/agents — create agent in blueprint. */
async function handleCreateBlueprintAgent(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { registry } = deps;
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
  const blueprint = registry.getBlueprint(id);
  if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");

  const body = await c.req.json().catch(() => null);
  const parsed = CreateAgentSchema.safeParse(body);
  if (!parsed.success) {
    const idIssue = parsed.error.issues.find((i: { path: unknown[] }) => i.path[0] === "agent_id");
    if (idIssue) {
      const isMissing = idIssue.code === "invalid_type";
      return apiError(
        c,
        400,
        isMissing ? "FIELD_REQUIRED" : "INVALID_AGENT_ID",
        isMissing ? "agent_id is required" : "Invalid agent_id format",
      );
    }
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

  await seedBlueprintAgentFiles(registry, newAgent.id, data.agent_id, data.name);
  const payload = buildBlueprintPayload(id, registry);
  return c.json(payload, 201);
}

/** Handle PATCH /agents/:agentId/meta. */
async function handleUpdateAgentMeta(c: HonoContext, registry: Registry): Promise<Response> {
  const id = Number(c.req.param("id"));
  const agentId = c.req.param("agentId");
  if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
  if (!registry.getBlueprint(id)) return apiError(c, 404, "NOT_FOUND", "Not found");
  const agent = registry.getBlueprintAgent(id, agentId);
  if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

  const body = await c.req.json().catch(() => null);
  const parsed = UpdateAgentMetaSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);
  const data = parsed.data;

  const metaFields: Parameters<typeof registry.updateAgentMeta>[1] = {};
  if ("role" in data) metaFields.role = data.role;
  if ("tags" in data) metaFields.tags = data.tags;
  if ("notes" in data) metaFields.notes = data.notes;
  if ("skills" in data) metaFields.skills = data.skills;
  registry.updateAgentMeta(agent.id, metaFields);

  return c.json(buildBlueprintPayload(id, registry));
}

/** Handle DELETE /agents/:agentId. */
function handleDeleteAgent(c: HonoContext, registry: Registry): Response {
  const id = Number(c.req.param("id"));
  const agentId = c.req.param("agentId");
  if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
  if (!registry.getBlueprint(id)) return apiError(c, 404, "NOT_FOUND", "Not found");
  if (!registry.getBlueprintAgent(id, agentId))
    return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");
  registry.deleteBlueprintAgent(id, agentId);
  return c.json(buildBlueprintPayload(id, registry));
}

/** Handle PATCH /agents/:agentId/position. */
async function handleUpdatePosition(c: HonoContext, registry: Registry): Promise<Response> {
  const id = Number(c.req.param("id"));
  const agentId = c.req.param("agentId");
  if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateAgentPositionSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);
  const agent = registry.getBlueprintAgent(id, agentId);
  if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");
  registry.updateBlueprintAgentPosition(agent.id, parsed.data.x, parsed.data.y);
  return c.json({ ok: true });
}

/** Handle GET /agents/:agentId/files/:filename. */
function handleReadFile(c: HonoContext, registry: Registry): Response {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
  const agent = registry.getBlueprintAgent(id, c.req.param("agentId"));
  if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");
  const file = registry.getAgentFileContent(agent.id, c.req.param("filename"));
  if (!file) return apiError(c, 404, "FILE_NOT_FOUND", "File not found");
  return c.json({
    filename: file.filename,
    content: file.content ?? "",
    content_hash: file.content_hash ?? "",
    updated_at: file.updated_at ?? "",
    editable: true,
  });
}

/** Handle PUT /agents/:agentId/files/:filename. */
async function handleWriteFile(c: HonoContext, registry: Registry): Promise<Response> {
  const id = Number(c.req.param("id"));
  const filename = c.req.param("filename");
  if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
  const body = await c.req.json().catch(() => null);
  const parsed = WriteFileSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);
  const agent = registry.getBlueprintAgent(id, c.req.param("agentId"));
  if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

  try {
    const { createHash } = await import("node:crypto");
    const contentHash = createHash("sha256").update(parsed.data.content).digest("hex").slice(0, 16);
    registry.upsertAgentFile(agent.id, { filename, content: parsed.data.content, contentHash });
  } catch (err: unknown) {
    return apiError(
      c,
      500,
      "FILE_SAVE_FAILED",
      err instanceof Error ? err.message : "File save failed",
    );
  }

  const saved = registry.getAgentFileContent(agent.id, filename);
  return c.json({
    filename,
    content: parsed.data.content,
    content_hash: saved?.content_hash ?? "",
    updated_at: saved?.updated_at ?? new Date().toISOString(),
    editable: true,
  });
}

/** Handle PATCH /agents/:agentId/spawn-links. */
async function handleSpawnLinks(c: HonoContext, registry: Registry): Promise<Response> {
  const id = Number(c.req.param("id"));
  const agentId = c.req.param("agentId");
  if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateSpawnLinksSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);
  if (!registry.getBlueprint(id)) return apiError(c, 404, "NOT_FOUND", "Not found");

  const allLinks = registry.listBlueprintLinks(id);
  const otherLinks = allLinks.filter(
    (l) => !(l.source_agent_id === agentId && l.link_type === "spawn"),
  );
  const newSpawnLinks = parsed.data.targets.map((target) => ({
    sourceAgentId: agentId,
    targetAgentId: target,
    linkType: "spawn" as const,
  }));
  registry.replaceBlueprintLinks(id, [
    ...otherLinks.map((l) => ({
      sourceAgentId: l.source_agent_id,
      targetAgentId: l.target_agent_id,
      linkType: l.link_type,
    })),
    ...newSpawnLinks,
  ]);

  const updatedLinks = registry.listBlueprintLinks(id).map((l) => ({
    source_agent_id: l.source_agent_id,
    target_agent_id: l.target_agent_id,
    link_type: l.link_type,
  }));
  return c.json({ ok: true, links: updatedLinks });
}

export function registerBlueprintRoutes(app: Hono, deps: RouteDeps) {
  const { registry } = deps;

  // GET /api/blueprints — list all blueprints (DB + built-in)
  app.get("/api/blueprints", async (c) => {
    return handleListBlueprints(c, registry);
  });

  // POST /api/blueprints — create a blueprint
  app.post("/api/blueprints", async (c) => {
    return handleCreateBlueprint(c, deps);
  });

  // POST /api/blueprints/import-builtin/:slug — import a built-in blueprint
  app.post("/api/blueprints/import-builtin/:slug", async (c) => {
    return handleImportBuiltin(c, deps);
  });

  // GET /api/blueprints/:id — blueprint detail
  app.get("/api/blueprints/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");
    return c.json(blueprint);
  });

  // PUT /api/blueprints/:id — update a blueprint
  app.put("/api/blueprints/:id", async (c) => {
    return handleUpdateBlueprint(c, deps);
  });

  // DELETE /api/blueprints/:id — delete a blueprint
  app.delete("/api/blueprints/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
    const blueprint = registry.getBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Not found");
    registry.deleteBlueprint(id);
    removeSearchEntry(deps.db, "blueprint", String(id));
    notifySystemStateChanged("blueprint", "delete");
    return c.json({ ok: true });
  });

  // GET /api/blueprints/:id/builder — full builder payload
  app.get("/api/blueprints/:id/builder", (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return apiError(c, 400, "FIELD_INVALID", "Invalid id");
    const payload = buildBlueprintPayload(id, registry);
    if (!payload) return apiError(c, 404, "NOT_FOUND", "Not found");
    return c.json(payload);
  });

  // POST /api/blueprints/:id/agents — create agent in blueprint
  app.post("/api/blueprints/:id/agents", async (c) => {
    return handleCreateBlueprintAgent(c, deps);
  });

  app.patch("/api/blueprints/:id/agents/:agentId/meta", async (c) =>
    handleUpdateAgentMeta(c, registry),
  );
  app.delete("/api/blueprints/:id/agents/:agentId", (c) => handleDeleteAgent(c, registry));
  app.patch("/api/blueprints/:id/agents/:agentId/position", async (c) =>
    handleUpdatePosition(c, registry),
  );
  app.get("/api/blueprints/:id/agents/:agentId/files/:filename", (c) =>
    handleReadFile(c, registry),
  );
  app.put("/api/blueprints/:id/agents/:agentId/files/:filename", async (c) =>
    handleWriteFile(c, registry),
  );
  app.patch("/api/blueprints/:id/agents/:agentId/spawn-links", async (c) =>
    handleSpawnLinks(c, registry),
  );
}
