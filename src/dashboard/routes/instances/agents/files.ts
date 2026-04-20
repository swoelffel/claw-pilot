// src/dashboard/routes/instances/agents/files.ts
// GET    /api/instances/:slug/agents/:agentId/files                        — list (tree)
// GET    /api/instances/:slug/agents/:agentId/files/*                      — read a single file
// PUT    /api/instances/:slug/agents/:agentId/files/*                      — create or update
// DELETE /api/instances/:slug/agents/:agentId/files/*                      — delete
//
// The trailing `*` captures a workspace-relative path that may include slashes
// (e.g. `memory/facts.md`). All paths are validated by
// `validateWorkspaceRelativePath` — rejects traversal, absolute paths,
// disallowed extensions, and reserved segments.
import type { Context, Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { getInstanceContext } from "../../_instance-middleware.js";
import { AgentProvisioner } from "../../../../core/agent-provisioner.js";
import {
  InvalidWorkspacePathError,
  validateWorkspaceRelativePath,
} from "../../../../lib/workspace-path.js";
import { EDITABLE_FILES } from "../../../../core/agent-sync.js";
import { ClawPilotError, InstanceNotFoundError } from "../../../../lib/errors.js";
import { logger } from "../../../../lib/logger.js";
import * as path from "node:path";
import { publishRuntimeEvent } from "../../_internal-api-client.js";
import { buildFileTree } from "../../_file-tree.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the workspace-relative path from the URL.
 * Hono's `:param` captures a single segment; for multi-segment paths we parse
 * the URL directly and decode each segment.
 */
function extractRelPath(
  fullPath: string,
  slug: string,
  agentId: string,
): { relPath: string } | { error: string } {
  const prefix = `/api/instances/${slug}/agents/${agentId}/files/`;
  if (!fullPath.startsWith(prefix)) {
    return { error: "malformed files path" };
  }
  const raw = fullPath.slice(prefix.length);
  if (raw.length === 0) return { error: "missing path" };

  try {
    const segments = raw.split("/").map((s) => decodeURIComponent(s));
    return { relPath: segments.join("/") };
  } catch (err) {
    logger.debug("[route:agents-files] decode failed", { error: String(err) });
    return { error: "invalid url encoding" };
  }
}

function invalidPath(c: Context, err: unknown): Response {
  const message = err instanceof InvalidWorkspacePathError ? err.message : "Invalid workspace path";
  return apiError(c, 400, "INVALID_PATH", message);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAgentFileRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn } = deps;

  // GET /api/instances/:slug/agents/:agentId/files — list workspace as a tree
  app.get("/api/instances/:slug/agents/:agentId/files", (c) => {
    const { instance } = getInstanceContext(c);
    const agentId = c.req.param("agentId");

    const agent = registry.getAgentByAgentId(instance.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    const rows = registry.listAgentFiles(agent.id).map((f) => ({
      filename: f.filename,
      size: Buffer.byteLength(f.content ?? "", "utf8"),
      content_hash: f.content_hash ?? "",
      updated_at: f.updated_at ?? "",
    }));
    return c.json({ tree: buildFileTree(rows) });
  });

  // GET /api/instances/:slug/agents/:agentId/files/* — fetch a single workspace file
  app.get("/api/instances/:slug/agents/:agentId/files/*", (c) => {
    const { instance, slug } = getInstanceContext(c);
    const agentId = c.req.param("agentId");

    const extracted = extractRelPath(new URL(c.req.url).pathname, slug, agentId);
    if ("error" in extracted) return apiError(c, 400, "INVALID_PATH", extracted.error);

    let relPath: string;
    try {
      relPath = validateWorkspaceRelativePath(extracted.relPath);
    } catch (err) {
      return invalidPath(c, err);
    }

    const agent = registry.getAgentByAgentId(instance.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    const file = registry.getAgentFileContent(agent.id, relPath);
    if (!file) return apiError(c, 404, "FILE_NOT_FOUND", "File not found");

    // Files outside the prompt-discovery whitelist are still editable.
    // The `in_system_prompt` flag tells the UI whether edits affect the system prompt.
    return c.json({
      filename: file.filename,
      path: file.filename,
      content: file.content ?? "",
      content_hash: file.content_hash ?? "",
      updated_at: file.updated_at ?? "",
      editable: true,
      in_system_prompt: EDITABLE_FILES.has(relPath),
    });
  });

  // PUT /api/instances/:slug/agents/:agentId/files/* — create or update a workspace file
  app.put("/api/instances/:slug/agents/:agentId/files/*", async (c) => {
    const { instance, slug } = getInstanceContext(c);
    const agentId = c.req.param("agentId");

    const extracted = extractRelPath(new URL(c.req.url).pathname, slug, agentId);
    if ("error" in extracted) return apiError(c, 400, "INVALID_PATH", extracted.error);

    let relPath: string;
    try {
      relPath = validateWorkspaceRelativePath(extracted.relPath);
    } catch (err) {
      return invalidPath(c, err);
    }

    const agentRecord = registry.getAgentByAgentId(instance.id, agentId);
    if (!agentRecord) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    let body: { content?: string };
    try {
      body = await c.req.json<{ content?: string }>();
    } catch (err) {
      logger.warn("[route:agents-files] JSON parse failed", { error: String(err) });
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
      await provisioner.updateAgentFile(instance, agentId, relPath, body.content);
    } catch (err: unknown) {
      if (err instanceof InvalidWorkspacePathError) {
        return apiError(c, 400, "INVALID_PATH", err.message);
      }
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "FILE_NOT_FOUND", err.message);
      }
      if (err instanceof ClawPilotError && err.code === "AGENT_NOT_FOUND") {
        return apiError(c, 404, "AGENT_NOT_FOUND", err.message);
      }
      return apiError(
        c,
        500,
        "FILE_SAVE_FAILED",
        err instanceof Error ? err.message : "File save failed",
      );
    }

    // Notify the runtime daemon that a workspace file changed.
    // Best-effort: if the daemon is not running, the next startup reloads fresh files.
    const filePath = path.join(instance.state_dir, "workspaces", agentId, relPath);
    void publishRuntimeEvent(slug, "workspace.file.changed", {
      instanceSlug: slug,
      agentId,
      filename: relPath,
      filePath,
    });

    const updatedFile = registry.getAgentFileContent(agentRecord.id, relPath);
    return c.json(
      {
        filename: relPath,
        path: relPath,
        content: updatedFile?.content ?? body.content,
        content_hash: updatedFile?.content_hash ?? "",
        updated_at: updatedFile?.updated_at ?? new Date().toISOString(),
        editable: true,
        in_system_prompt: EDITABLE_FILES.has(relPath),
      },
      200,
    );
  });

  // DELETE /api/instances/:slug/agents/:agentId/files/* — delete a workspace file
  app.delete("/api/instances/:slug/agents/:agentId/files/*", async (c) => {
    const { instance, slug } = getInstanceContext(c);
    const agentId = c.req.param("agentId");

    const extracted = extractRelPath(new URL(c.req.url).pathname, slug, agentId);
    if ("error" in extracted) return apiError(c, 400, "INVALID_PATH", extracted.error);

    let relPath: string;
    try {
      relPath = validateWorkspaceRelativePath(extracted.relPath);
    } catch (err) {
      return invalidPath(c, err);
    }

    const agentRecord = registry.getAgentByAgentId(instance.id, agentId);
    if (!agentRecord) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    try {
      const provisioner = new AgentProvisioner(conn, registry);
      await provisioner.deleteAgentFile(instance, agentId, relPath);
    } catch (err: unknown) {
      if (err instanceof InvalidWorkspacePathError) {
        return apiError(c, 400, "INVALID_PATH", err.message);
      }
      if (err instanceof ClawPilotError && err.code === "AGENT_NOT_FOUND") {
        return apiError(c, 404, "AGENT_NOT_FOUND", err.message);
      }
      return apiError(
        c,
        500,
        "FILE_DELETE_FAILED",
        err instanceof Error ? err.message : "File delete failed",
      );
    }

    const filePath = path.join(instance.state_dir, "workspaces", agentId, relPath);
    void publishRuntimeEvent(slug, "workspace.file.changed", {
      instanceSlug: slug,
      agentId,
      filename: relPath,
      filePath,
      deleted: true,
    });

    return c.json({ deleted: true, path: relPath }, 200);
  });
}
