// src/dashboard/routes/agent-blueprints.ts
//
// API routes for standalone agent blueprints (reusable agent templates).
//
// Routes:
//   GET    /api/agent-blueprints              — list all
//   POST   /api/agent-blueprints              — create (with optional seeded files)
//   GET    /api/agent-blueprints/:id           — detail + files
//   PUT    /api/agent-blueprints/:id           — update metadata
//   DELETE /api/agent-blueprints/:id           — delete (cascade files)
//   POST   /api/agent-blueprints/:id/clone     — deep clone
//   GET    /api/agent-blueprints/:id/files/:filename  — read file
//   PUT    /api/agent-blueprints/:id/files/:filename  — write file
//   DELETE /api/agent-blueprints/:id/files/:filename  — delete file
//   POST   /api/agent-blueprints/from-agent    — create from instance agent ("Save as template")
//   GET    /api/agent-blueprints/:id/export    — export as YAML
//   POST   /api/agent-blueprints/import        — import from YAML

import { z } from "zod";
import { stringify } from "yaml";
import { parse as parseYaml } from "yaml";
import type { Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import { constants } from "../../lib/constants.js";
import { logger } from "../../lib/logger.js";
import { loadWorkspaceTemplate } from "../../lib/workspace-templates.js";

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  category: z.enum(["user", "tool", "system"]).optional(),
  configJson: z.string().optional(),
  icon: z.string().max(10).optional(),
  tags: z.string().optional(),
  /** If true, seed default workspace files (SOUL.md, IDENTITY.md, etc.) */
  seedFiles: z.boolean().optional(),
});

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  category: z.enum(["user", "tool", "system"]).optional(),
  configJson: z.string().optional(),
  icon: z.string().max(10).nullable().optional(),
  tags: z.string().nullable().optional(),
});

const CloneSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

const FromAgentSchema = z.object({
  instanceSlug: z.string().min(1),
  agentId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAgentBlueprintRoutes(app: Hono, deps: RouteDeps): void {
  const { registry } = deps;

  // --- GET /api/agent-blueprints — list all ---
  app.get("/api/agent-blueprints", (c) => {
    const blueprints = registry.listAgentBlueprints();
    return c.json(blueprints);
  });

  // --- POST /api/agent-blueprints — create ---
  app.post("/api/agent-blueprints", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const { name, description, category, configJson, icon, tags, seedFiles } = parsed.data;

    const blueprint = registry.createAgentBlueprint({
      name,
      ...(description !== undefined ? { description } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(configJson !== undefined ? { configJson } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(tags !== undefined ? { tags } : {}),
    });

    // Seed default files if requested — use workspace templates as initial content
    if (seedFiles) {
      for (const filename of constants.EXPORTABLE_FILES) {
        const content = await loadWorkspaceTemplate(filename, {
          agentId: blueprint.id,
          agentName: blueprint.name,
          instanceSlug: "blueprint",
          instanceName: "Blueprint",
        });
        registry.upsertAgentBlueprintFile(blueprint.id, filename, content);
      }
    }

    const files = registry.listAgentBlueprintFiles(blueprint.id);
    return c.json({ ...blueprint, files }, 201);
  });

  // --- GET /api/agent-blueprints/:id — detail + files ---
  app.get("/api/agent-blueprints/:id", (c) => {
    const id = c.req.param("id");
    const blueprint = registry.getAgentBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Agent blueprint not found");

    const files = registry.listAgentBlueprintFiles(id);
    return c.json({
      ...blueprint,
      files: files.map((f) => ({
        filename: f.filename,
        content_hash: f.content_hash,
        size: f.content.length,
        updated_at: f.updated_at,
      })),
    });
  });

  // --- PUT /api/agent-blueprints/:id — update metadata ---
  app.put("/api/agent-blueprints/:id", async (c) => {
    const id = c.req.param("id");
    const existing = registry.getAgentBlueprint(id);
    if (!existing) return apiError(c, 404, "NOT_FOUND", "Agent blueprint not found");

    const body = await c.req.json().catch(() => null);
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }

    // Build update payload with conditional spread (exactOptionalPropertyTypes)
    const d = parsed.data;
    const updated = registry.updateAgentBlueprint(id, {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...("description" in d ? { description: d.description ?? null } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.configJson !== undefined ? { configJson: d.configJson } : {}),
      ...("icon" in d ? { icon: d.icon ?? null } : {}),
      ...("tags" in d ? { tags: d.tags ?? null } : {}),
    });
    return c.json(updated);
  });

  // --- DELETE /api/agent-blueprints/:id ---
  app.delete("/api/agent-blueprints/:id", (c) => {
    const id = c.req.param("id");
    const existing = registry.getAgentBlueprint(id);
    if (!existing) return apiError(c, 404, "NOT_FOUND", "Agent blueprint not found");

    registry.deleteAgentBlueprint(id);
    return c.json({ ok: true });
  });

  // --- POST /api/agent-blueprints/:id/clone ---
  app.post("/api/agent-blueprints/:id/clone", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parsed = CloneSchema.safeParse(body);
    const newName = parsed.success ? parsed.data.name : undefined;

    const clone = registry.cloneAgentBlueprint(id, newName);
    if (!clone) return apiError(c, 404, "NOT_FOUND", "Source agent blueprint not found");

    const files = registry.listAgentBlueprintFiles(clone.id);
    return c.json(
      {
        ...clone,
        files: files.map((f) => ({
          filename: f.filename,
          content_hash: f.content_hash,
          size: f.content.length,
          updated_at: f.updated_at,
        })),
      },
      201,
    );
  });

  // --- GET /api/agent-blueprints/:id/files/:filename ---
  app.get("/api/agent-blueprints/:id/files/:filename", (c) => {
    const id = c.req.param("id");
    const filename = c.req.param("filename");

    const blueprint = registry.getAgentBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Agent blueprint not found");

    const file = registry.getAgentBlueprintFile(id, filename);
    if (!file) return apiError(c, 404, "NOT_FOUND", `File not found: ${filename}`);

    return c.json({
      filename: file.filename,
      content: file.content,
      content_hash: file.content_hash,
      updated_at: file.updated_at,
    });
  });

  // --- PUT /api/agent-blueprints/:id/files/:filename ---
  app.put("/api/agent-blueprints/:id/files/:filename", async (c) => {
    const id = c.req.param("id");
    const filename = c.req.param("filename");

    const blueprint = registry.getAgentBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Agent blueprint not found");

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.content !== "string") {
      return apiError(c, 400, "INVALID_BODY", 'Body must be { "content": "..." }');
    }

    const content = body.content as string;
    if (content.length > 1_000_000) {
      return apiError(c, 413, "FILE_TOO_LARGE", "File content exceeds 1MB limit");
    }

    registry.upsertAgentBlueprintFile(id, filename, content);

    const saved = registry.getAgentBlueprintFile(id, filename);
    return c.json({
      filename: saved!.filename,
      content: saved!.content,
      content_hash: saved!.content_hash,
      updated_at: saved!.updated_at,
    });
  });

  // --- DELETE /api/agent-blueprints/:id/files/:filename ---
  app.delete("/api/agent-blueprints/:id/files/:filename", (c) => {
    const id = c.req.param("id");
    const filename = c.req.param("filename");

    const blueprint = registry.getAgentBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Agent blueprint not found");

    registry.deleteAgentBlueprintFile(id, filename);
    return c.json({ ok: true });
  });

  // --- POST /api/agent-blueprints/from-agent — "Save as template" ---
  app.post("/api/agent-blueprints/from-agent", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = FromAgentSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const { instanceSlug, agentId, name, description } = parsed.data;

    // Verify the instance and agent exist
    const instance = registry.getInstance(instanceSlug);
    if (!instance) return apiError(c, 404, "NOT_FOUND", `Instance not found: ${instanceSlug}`);

    const agentRecord = registry.getAgentByAgentId(instance.id, agentId);
    if (!agentRecord) return apiError(c, 404, "NOT_FOUND", `Agent not found: ${agentId}`);

    // Create the agent blueprint
    const blueprint = registry.createAgentBlueprint({
      name,
      ...(description !== undefined ? { description } : {}),
      category: "user",
    });

    // Copy workspace files from the instance agent to the blueprint
    const agentFiles = registry.listAgentFiles(agentRecord.id);
    for (const file of agentFiles) {
      if (file.content) {
        registry.upsertAgentBlueprintFile(blueprint.id, file.filename, file.content);
      }
    }

    const files = registry.listAgentBlueprintFiles(blueprint.id);
    return c.json(
      {
        ...blueprint,
        files: files.map((f) => ({
          filename: f.filename,
          content_hash: f.content_hash,
          size: f.content.length,
          updated_at: f.updated_at,
        })),
      },
      201,
    );
  });

  // --- GET /api/agent-blueprints/:id/export — export as YAML ---
  app.get("/api/agent-blueprints/:id/export", (c) => {
    const id = c.req.param("id");
    const blueprint = registry.getAgentBlueprint(id);
    if (!blueprint) return apiError(c, 404, "NOT_FOUND", "Agent blueprint not found");

    const files = registry.listAgentBlueprintFiles(id);
    const filesMap: Record<string, string> = {};
    for (const f of files) {
      if (f.content) filesMap[f.filename] = f.content;
    }

    const doc = {
      version: "1",
      name: blueprint.name,
      ...(blueprint.description ? { description: blueprint.description } : {}),
      category: blueprint.category,
      ...(blueprint.icon ? { icon: blueprint.icon } : {}),
      ...(blueprint.tags ? { tags: blueprint.tags } : {}),
      ...(Object.keys(filesMap).length > 0 ? { files: filesMap } : {}),
    };

    const yaml = stringify(doc, { lineWidth: 0 });
    const filename = `${blueprint.name.toLowerCase().replace(/\s+/g, "-")}-template.yaml`;
    return new Response(yaml, {
      status: 200,
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  // --- POST /api/agent-blueprints/import — import from YAML ---
  app.post("/api/agent-blueprints/import", async (c) => {
    let yamlContent: string;
    try {
      yamlContent = await c.req.text();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Cannot read request body");
    }

    // 1. Parse YAML
    let raw: unknown;
    try {
      raw = parseYaml(yamlContent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid YAML";
      logger.error(`[agent-blueprint-import] YAML parse error: ${msg}`);
      return apiError(c, 400, "YAML_PARSE_ERROR", msg);
    }

    // 2. Validate structure
    const ImportSchema = z.object({
      version: z.string().optional(),
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      category: z.enum(["user", "tool", "system"]).optional(),
      icon: z.string().max(10).optional(),
      tags: z.string().optional(),
      files: z.record(z.string(), z.string()).optional(),
    });

    const parsed = ImportSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", parsed.error.message);
    }

    const { name, description, category, icon, tags, files } = parsed.data;

    // 3. Create blueprint
    const blueprint = registry.createAgentBlueprint({
      name,
      ...(description !== undefined ? { description } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(tags !== undefined ? { tags } : {}),
    });

    // 4. Create files from YAML
    if (files) {
      for (const [filename, content] of Object.entries(files)) {
        registry.upsertAgentBlueprintFile(blueprint.id, filename, content);
      }
    }

    const createdFiles = registry.listAgentBlueprintFiles(blueprint.id);
    return c.json(
      {
        ...blueprint,
        files: createdFiles.map((f) => ({
          filename: f.filename,
          content_hash: f.content_hash,
          size: f.content.length,
          updated_at: f.updated_at,
        })),
      },
      201,
    );
  });
}
