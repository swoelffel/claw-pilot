// src/dashboard/routes/instances/skills.ts
//
// Instance-scoped structured-skills REST API (SKILLS-002 Task 5).
// All routes mount under `/api/instances/:slug/skills/...` and are guarded
// by the dashboard auth + `instanceMiddleware`. Strict instance scoping is
// enforced on every `:id` handler — a skill owned by another instance must
// return 404 (not leak existence).
//
// Routes:
//   GET    /api/instances/:slug/skills                              — list summaries
//   POST   /api/instances/:slug/skills                              — ingest (blank | zip | github)
//   GET    /api/instances/:slug/skills/:id                          — detail (skill, files, agents)
//   PUT    /api/instances/:slug/skills/:id                          — update meta
//   DELETE /api/instances/:slug/skills/:id                          — cascade delete
//   GET    /api/instances/:slug/skills/:id/files/*                  — read single file
//   PUT    /api/instances/:slug/skills/:id/files/*                  — upsert single file
//   DELETE /api/instances/:slug/skills/:id/files/*                  — delete single file
//   POST   /api/instances/:slug/skills/:id/agents/:agentId          — assign
//   DELETE /api/instances/:slug/skills/:id/agents/:agentId          — unassign
//   GET    /api/instances/:slug/skills/:id/export                   — ZIP download

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context, Hono } from "hono";
import { zipSync, strToU8 } from "fflate";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { logger } from "../../../lib/logger.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";
import { getInstanceContext } from "../_instance-middleware.js";
import {
  assignSkillToAgent,
  createSkill,
  deleteSkill,
  deleteSkillFile,
  getSkillWithFiles,
  listAgentsForSkill,
  listSkillsByInstance,
  unassignSkillFromAgent,
  updateSkillMeta,
  upsertSkillFile,
  type SkillFileRow,
  type SkillRow,
} from "../../../core/repositories/skill-repository.js";
import {
  ingestBlank,
  ingestGithub,
  ingestZip,
  parseAndValidateSkill,
  type IngestedSkill,
} from "../../../core/skills/_skill-ingest.js";
import { SkillManifestError } from "../../../core/skills/_skill-manifest.js";
import { getBus } from "../../../runtime/bus/index.js";
import {
  AgentSkillAssigned,
  AgentSkillUnassigned,
  SkillCreated,
  SkillDeleted,
  SkillFileDeleted,
  SkillFileUpserted,
  SkillUpdated,
} from "../../../runtime/bus/events.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ZIP_BODY_BYTES = 25 * 1024 * 1024; // 25 MB

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const IngestBlankSchema = z.object({
  mode: z.literal("blank"),
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
});

const IngestGithubSchema = z.object({
  mode: z.literal("github"),
  url: z.string().min(1).max(512),
  ref: z.string().min(1).max(128).optional(),
});

const UpdateMetaSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(500).nullable().optional(),
  version: z.string().max(64).nullable().optional(),
});

const FileBodySchema = z.object({
  content: z.string(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safePublish<T extends string, P>(
  slug: string,
  def: { type: T; readonly _payload: P },
  payload: P,
): void {
  try {
    getBus(slug).publish(def as never, payload as never);
  } catch (err) {
    logger.debug("[route:skills] bus publish failed", {
      event: "skills_bus_publish_failed",
      type: def.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function loadScopedSkill(
  db: RouteDeps["db"],
  id: string,
  slug: string,
): { skill: SkillRow; files: SkillFileRow[] } | null {
  const loaded = getSkillWithFiles(db, id);
  if (!loaded) return null;
  if (loaded.skill.instance_slug !== slug) return null;
  return loaded;
}

function serializeSkill(row: SkillRow): Record<string, unknown> {
  return {
    id: row.id,
    instanceSlug: row.instance_slug,
    name: row.name,
    description: row.description,
    version: row.version,
    source: row.source,
    sourceUrl: row.source_url,
    configJson: row.config_json,
    orgId: row.org_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeFile(row: SkillFileRow): Record<string, unknown> {
  return {
    path: row.path,
    content: row.content,
    hash: row.hash,
  };
}

function extractFilePath(fullPath: string, slug: string, id: string): string | null {
  const prefix = `/api/instances/${slug}/skills/${id}/files/`;
  const idx = fullPath.indexOf(prefix);
  if (idx === -1) return null;
  const raw = fullPath.slice(idx + prefix.length);
  if (raw.length === 0) return null;
  try {
    return raw
      .split("/")
      .map((s) => decodeURIComponent(s))
      .join("/");
  } catch (err) {
    logger.debug("[route:skills] path decode failed", { error: String(err) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handlers — list / detail
// ---------------------------------------------------------------------------

function handleList(c: HonoContext, deps: RouteDeps): Response {
  const { slug } = getInstanceContext(c);
  const summaries = listSkillsByInstance(deps.db, slug);
  return c.json({ skills: summaries });
}

function handleDetail(c: HonoContext, deps: RouteDeps): Response {
  const { slug } = getInstanceContext(c);
  const id = c.req.param("id");
  const loaded = loadScopedSkill(deps.db, id, slug);
  if (!loaded) return apiError(c, 404, "NOT_FOUND", `Skill not found: ${id}`);
  const agents = listAgentsForSkill(deps.db, id);
  return c.json({
    skill: serializeSkill(loaded.skill),
    files: loaded.files.map(serializeFile),
    agents,
  });
}

// ---------------------------------------------------------------------------
// Handlers — create / ingest
// ---------------------------------------------------------------------------

async function persistIngestedSkill(
  deps: RouteDeps,
  slug: string,
  ingested: IngestedSkill,
  source: "blank" | "zip" | "github",
  sourceUrl: string | null,
): Promise<SkillRow> {
  const id = randomUUID();
  const configJson =
    Object.keys(ingested.extras).length > 0 ? JSON.stringify(ingested.extras) : null;
  const row = createSkill(deps.db, {
    id,
    instanceSlug: slug,
    name: ingested.meta.name,
    description: ingested.meta.description ?? null,
    version: ingested.meta.version ?? null,
    source,
    sourceUrl,
    configJson,
    files: ingested.files,
  });
  safePublish(slug, SkillCreated, { instanceSlug: slug, skillId: id, name: row.name });
  return row;
}

async function handleCreateZip(c: HonoContext, deps: RouteDeps, slug: string): Promise<Response> {
  const contentLengthHeader = c.req.header("content-length");
  if (contentLengthHeader) {
    const len = Number(contentLengthHeader);
    if (Number.isFinite(len) && len > MAX_ZIP_BODY_BYTES) {
      return apiError(c, 413, "PAYLOAD_TOO_LARGE", "ZIP body exceeds 25 MB cap");
    }
  }
  let body: Record<string, unknown>;
  try {
    body = (await c.req.parseBody()) as Record<string, unknown>;
  } catch (err) {
    logger.warn("[route:skills] parseBody failed", { error: String(err) });
    return apiError(c, 400, "INVALID_BODY", "Failed to parse multipart body");
  }
  const file = body["file"];
  if (!(file instanceof File)) {
    return apiError(c, 400, "MISSING_FILE", "Multipart 'file' field is required for zip mode");
  }
  if (file.size > MAX_ZIP_BODY_BYTES) {
    return apiError(c, 413, "PAYLOAD_TOO_LARGE", "ZIP file exceeds 25 MB cap");
  }

  let ingested: IngestedSkill;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    ingested = await ingestZip(buf);
  } catch (err) {
    if (err instanceof SkillManifestError) {
      return apiError(c, 400, err.code, err.message);
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[route:skills] zip ingest failed", { error: msg });
    return apiError(c, 400, "INGEST_FAILED", msg);
  }

  const row = await persistIngestedSkill(deps, slug, ingested, "zip", null);
  return c.json({ id: row.id }, 201);
}

function ingestErrorResponse(c: HonoContext, err: unknown): Response {
  if (err instanceof SkillManifestError) return apiError(c, 400, err.code, err.message);
  const msg = err instanceof Error ? err.message : String(err);
  return apiError(c, 400, "INGEST_FAILED", msg);
}

async function handleCreateBlank(
  c: HonoContext,
  deps: RouteDeps,
  slug: string,
  raw: unknown,
): Promise<Response> {
  const parsed = IngestBlankSchema.safeParse(raw);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);
  let ingested: IngestedSkill;
  try {
    ingested = ingestBlank({
      name: parsed.data.name,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
    });
  } catch (err) {
    return ingestErrorResponse(c, err);
  }
  const row = await persistIngestedSkill(deps, slug, ingested, "blank", null);
  return c.json({ id: row.id }, 201);
}

async function handleCreateGithub(
  c: HonoContext,
  deps: RouteDeps,
  slug: string,
  raw: unknown,
): Promise<Response> {
  const parsed = IngestGithubSchema.safeParse(raw);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);
  let ingested: IngestedSkill;
  try {
    ingested = await ingestGithub({
      url: parsed.data.url,
      ...(parsed.data.ref !== undefined ? { ref: parsed.data.ref } : {}),
    });
  } catch (err) {
    if (!(err instanceof SkillManifestError)) {
      logger.warn("[route:skills] github ingest failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return ingestErrorResponse(c, err);
  }
  const row = await persistIngestedSkill(deps, slug, ingested, "github", parsed.data.url);
  return c.json({ id: row.id }, 201);
}

function readMode(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const mode = (raw as { mode?: unknown }).mode;
  return typeof mode === "string" ? mode : null;
}

async function handleCreate(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { slug } = getInstanceContext(c);
  const contentType = (c.req.header("content-type") ?? "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    return handleCreateZip(c, deps, slug);
  }
  const raw = await c.req.json().catch(() => null);
  const mode = readMode(raw);
  if (mode === "blank") return handleCreateBlank(c, deps, slug, raw);
  if (mode === "github") return handleCreateGithub(c, deps, slug, raw);
  return apiError(c, 400, "INVALID_MODE", "Body must include mode: blank | zip | github");
}

// ---------------------------------------------------------------------------
// Handlers — update / delete
// ---------------------------------------------------------------------------

async function handleUpdate(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { slug } = getInstanceContext(c);
  const id = c.req.param("id");
  if (!loadScopedSkill(deps.db, id, slug)) {
    return apiError(c, 404, "NOT_FOUND", `Skill not found: ${id}`);
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = UpdateMetaSchema.safeParse(raw);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);

  const patch: Parameters<typeof updateSkillMeta>[2] = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.version !== undefined) patch.version = parsed.data.version;

  const row = updateSkillMeta(deps.db, id, patch);
  if (!row) return apiError(c, 404, "NOT_FOUND", `Skill not found: ${id}`);
  safePublish(slug, SkillUpdated, { instanceSlug: slug, skillId: id });
  return c.json({ skill: serializeSkill(row) });
}

function handleDelete(c: HonoContext, deps: RouteDeps): Response {
  const { slug } = getInstanceContext(c);
  const id = c.req.param("id");
  if (!loadScopedSkill(deps.db, id, slug)) {
    return apiError(c, 404, "NOT_FOUND", `Skill not found: ${id}`);
  }
  deleteSkill(deps.db, id);
  safePublish(slug, SkillDeleted, { instanceSlug: slug, skillId: id });
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Handlers — files
// ---------------------------------------------------------------------------

function handleFileRead(c: HonoContext, deps: RouteDeps): Response {
  const { slug } = getInstanceContext(c);
  const id = c.req.param("id");
  const loaded = loadScopedSkill(deps.db, id, slug);
  if (!loaded) return apiError(c, 404, "NOT_FOUND", `Skill not found: ${id}`);
  const filePath = extractFilePath(new URL(c.req.url).pathname, slug, id);
  if (!filePath) return apiError(c, 400, "INVALID_PATH", "Missing file path");
  const file = loaded.files.find((f) => f.path === filePath);
  if (!file) return apiError(c, 404, "FILE_NOT_FOUND", `File not found: ${filePath}`);
  return c.json(serializeFile(file));
}

async function handleFileUpsert(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { slug } = getInstanceContext(c);
  const id = c.req.param("id");
  const loaded = loadScopedSkill(deps.db, id, slug);
  if (!loaded) return apiError(c, 404, "NOT_FOUND", `Skill not found: ${id}`);
  const filePath = extractFilePath(new URL(c.req.url).pathname, slug, id);
  if (!filePath) return apiError(c, 400, "INVALID_PATH", "Missing file path");

  const raw = await c.req.json().catch(() => null);
  const parsed = FileBodySchema.safeParse(raw);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);

  if (filePath === "SKILL.md") {
    try {
      parseAndValidateSkill([{ path: "SKILL.md", content: parsed.data.content }]);
    } catch (err) {
      if (err instanceof SkillManifestError) return apiError(c, 400, err.code, err.message);
      const msg = err instanceof Error ? err.message : String(err);
      return apiError(c, 400, "MANIFEST_INVALID", msg);
    }
  }

  let row: SkillFileRow;
  try {
    row = upsertSkillFile(deps.db, id, filePath, parsed.data.content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 400, "FILE_UPSERT_FAILED", msg);
  }
  safePublish(slug, SkillFileUpserted, { instanceSlug: slug, skillId: id, path: filePath });
  return c.json(serializeFile(row));
}

function handleFileDelete(c: HonoContext, deps: RouteDeps): Response {
  const { slug } = getInstanceContext(c);
  const id = c.req.param("id");
  const loaded = loadScopedSkill(deps.db, id, slug);
  if (!loaded) return apiError(c, 404, "NOT_FOUND", `Skill not found: ${id}`);
  const filePath = extractFilePath(new URL(c.req.url).pathname, slug, id);
  if (!filePath) return apiError(c, 400, "INVALID_PATH", "Missing file path");
  if (filePath === "SKILL.md") {
    return apiError(c, 400, "MANIFEST_REQUIRED", "SKILL.md cannot be deleted");
  }
  deleteSkillFile(deps.db, id, filePath);
  safePublish(slug, SkillFileDeleted, { instanceSlug: slug, skillId: id, path: filePath });
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Handlers — agent bindings
// ---------------------------------------------------------------------------

function handleAssign(c: HonoContext, deps: RouteDeps): Response {
  const { slug } = getInstanceContext(c);
  const id = c.req.param("id");
  const agentId = c.req.param("agentId");
  if (!loadScopedSkill(deps.db, id, slug)) {
    return apiError(c, 404, "NOT_FOUND", `Skill not found: ${id}`);
  }
  assignSkillToAgent(deps.db, id, agentId);
  safePublish(slug, AgentSkillAssigned, { instanceSlug: slug, skillId: id, agentId });
  return new Response(null, { status: 204 });
}

function handleUnassign(c: HonoContext, deps: RouteDeps): Response {
  const { slug } = getInstanceContext(c);
  const id = c.req.param("id");
  const agentId = c.req.param("agentId");
  if (!loadScopedSkill(deps.db, id, slug)) {
    return apiError(c, 404, "NOT_FOUND", `Skill not found: ${id}`);
  }
  unassignSkillFromAgent(deps.db, id, agentId);
  safePublish(slug, AgentSkillUnassigned, { instanceSlug: slug, skillId: id, agentId });
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Handlers — export
// ---------------------------------------------------------------------------

function handleExport(c: HonoContext, deps: RouteDeps): Response {
  const { slug } = getInstanceContext(c);
  const id = c.req.param("id");
  const loaded = loadScopedSkill(deps.db, id, slug);
  if (!loaded) return apiError(c, 404, "NOT_FOUND", `Skill not found: ${id}`);

  const entries: Record<string, Uint8Array> = {};
  for (const f of loaded.files) {
    entries[f.path] = strToU8(f.content);
  }
  const zip = zipSync(entries);
  const versionLabel = loaded.skill.version ?? "unversioned";
  const filename = `${loaded.skill.name}-${versionLabel}.zip`;
  const body = new Uint8Array(zip);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerInstanceSkillsRoutes(app: Hono, deps: RouteDeps): void {
  const skillKind = { kind: "skill" } as const;
  const skillId = { kind: "skill", id: (c: Context) => c.req.param("id") } as const;
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });

  app.get(
    "/api/instances/:slug/skills",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillKind, attributes: attr }),
    (c) => handleList(c, deps),
  );
  app.post(
    "/api/instances/:slug/skills",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillKind, attributes: attr }),
    async (c) => handleCreate(c, deps),
  );
  app.get(
    "/api/instances/:slug/skills/:id",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillId, attributes: attr }),
    (c) => handleDetail(c, deps),
  );
  app.put(
    "/api/instances/:slug/skills/:id",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillId, attributes: attr }),
    async (c) => handleUpdate(c, deps),
  );
  app.delete(
    "/api/instances/:slug/skills/:id",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillId, attributes: attr }),
    (c) => handleDelete(c, deps),
  );

  app.get(
    "/api/instances/:slug/skills/:id/files/*",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillId, attributes: attr }),
    (c) => handleFileRead(c, deps),
  );
  app.put(
    "/api/instances/:slug/skills/:id/files/*",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillId, attributes: attr }),
    async (c) => handleFileUpsert(c, deps),
  );
  app.delete(
    "/api/instances/:slug/skills/:id/files/*",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillId, attributes: attr }),
    (c) => handleFileDelete(c, deps),
  );

  app.post(
    "/api/instances/:slug/skills/:id/agents/:agentId",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillId, attributes: attr }),
    (c) => handleAssign(c, deps),
  );
  app.delete(
    "/api/instances/:slug/skills/:id/agents/:agentId",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillId, attributes: attr }),
    (c) => handleUnassign(c, deps),
  );

  app.get(
    "/api/instances/:slug/skills/:id/export",
    permission({ action: ACTIONS.INSTANCE_SKILLS_MANAGE, resource: skillId, attributes: attr }),
    (c) => handleExport(c, deps),
  );
}
