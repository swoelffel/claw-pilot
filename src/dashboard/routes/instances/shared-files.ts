// src/dashboard/routes/instances/shared-files.ts
// Instance shared workspace (v38).
//
//   GET    /api/instances/:slug/shared-files            — list (tree)
//   GET    /api/instances/:slug/shared-files/*          — read single file
//   PUT    /api/instances/:slug/shared-files/*          — create or update
//   DELETE /api/instances/:slug/shared-files/*          — delete
//
// The shared workspace lives at `<stateDir>/workspaces/shared/` and is readable
// by every agent of the instance (indexed by the runtime's ws_* tools). It is
// editable only through these dashboard routes — agents cannot write to it.

import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import * as path from "node:path";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
import {
  InvalidWorkspacePathError,
  validateWorkspaceRelativePath,
} from "../../../lib/workspace-path.js";
import { constants } from "../../../lib/constants.js";
import { logger } from "../../../lib/logger.js";
import { buildFileTree } from "../_file-tree.js";
import { publishRuntimeEvent } from "../_internal-api-client.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";

function extractRelPath(fullPath: string, slug: string): { relPath: string } | { error: string } {
  const prefix = `/api/instances/${slug}/shared-files/`;
  if (!fullPath.startsWith(prefix)) {
    return { error: "malformed shared-files path" };
  }
  const raw = fullPath.slice(prefix.length);
  if (raw.length === 0) return { error: "missing path" };

  try {
    const segments = raw.split("/").map((s) => decodeURIComponent(s));
    return { relPath: segments.join("/") };
  } catch (err) {
    logger.debug("[route:shared-files] decode failed", { error: String(err) });
    return { error: "invalid url encoding" };
  }
}

function invalidPath(c: Context, err: unknown): Response {
  const message = err instanceof InvalidWorkspacePathError ? err.message : "Invalid workspace path";
  return apiError(c, 400, "INVALID_PATH", message);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

async function handleSharedFileUpdate(
  c: HonoContext,
  registry: RouteDeps["registry"],
  conn: RouteDeps["conn"],
): Promise<Response> {
  const { instance, slug } = getInstanceContext(c);

  const extracted = extractRelPath(new URL(c.req.url).pathname, slug);
  if ("error" in extracted) return apiError(c, 400, "INVALID_PATH", extracted.error);

  let relPath: string;
  try {
    relPath = validateWorkspaceRelativePath(extracted.relPath);
  } catch (err) {
    return invalidPath(c, err);
  }

  let body: { content?: string };
  try {
    body = (await c.req.json()) as { content?: string };
  } catch (err) {
    logger.warn("[route:shared-files] JSON parse failed", { error: String(err) });
    return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
  }
  if (typeof body.content !== "string") {
    return apiError(c, 400, "FIELD_REQUIRED", "content is required");
  }
  if (body.content.length > 1_048_576) {
    return apiError(c, 413, "CONTENT_TOO_LARGE", "File content exceeds 1MB limit");
  }

  const sharedDir = path.join(instance.state_dir, "workspaces", constants.SHARED_WORKSPACE_DIR);
  const filePath = path.join(sharedDir, relPath);

  try {
    // Ensure the shared dir exists (self-healing for pre-v38 instances).
    await conn.mkdir(sharedDir);
    await conn.writeFile(filePath, body.content);
  } catch (err: unknown) {
    logger.warn("[route:shared-files] write failed", { error: String(err) });
    return apiError(
      c,
      500,
      "FILE_SAVE_FAILED",
      err instanceof Error ? err.message : "File save failed",
    );
  }

  const hash = createHash("sha256").update(body.content).digest("hex");
  registry.upsertSharedFile(instance.id, {
    filename: relPath,
    content: body.content,
    contentHash: hash,
  });

  void publishRuntimeEvent(slug, "shared-workspace.file.changed", {
    instanceSlug: slug,
    filename: relPath,
    filePath,
  });

  const updated = registry.getSharedFileContent(instance.id, relPath);
  return c.json(
    {
      filename: relPath,
      path: relPath,
      content: updated?.content ?? body.content,
      content_hash: updated?.content_hash ?? hash,
      updated_at: updated?.updated_at ?? new Date().toISOString(),
      editable: true,
    },
    200,
  );
}

async function handleSharedFileDelete(
  c: HonoContext,
  registry: RouteDeps["registry"],
  conn: RouteDeps["conn"],
): Promise<Response> {
  const { instance, slug } = getInstanceContext(c);

  const extracted = extractRelPath(new URL(c.req.url).pathname, slug);
  if ("error" in extracted) return apiError(c, 400, "INVALID_PATH", extracted.error);

  let relPath: string;
  try {
    relPath = validateWorkspaceRelativePath(extracted.relPath);
  } catch (err) {
    return invalidPath(c, err);
  }

  const sharedDir = path.join(instance.state_dir, "workspaces", constants.SHARED_WORKSPACE_DIR);
  const filePath = path.join(sharedDir, relPath);

  try {
    const existed = await conn.exists(filePath);
    if (existed) await conn.remove(filePath);
  } catch (err: unknown) {
    logger.warn("[route:shared-files] delete failed", { error: String(err) });
    return apiError(
      c,
      500,
      "FILE_DELETE_FAILED",
      err instanceof Error ? err.message : "File delete failed",
    );
  }

  registry.deleteSharedFile(instance.id, relPath);

  void publishRuntimeEvent(slug, "shared-workspace.file.changed", {
    instanceSlug: slug,
    filename: relPath,
    filePath,
    deleted: true,
  });

  return c.json({ deleted: true, path: relPath }, 200);
}

export function registerSharedFilesRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn } = deps;
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });
  const attrWithPath = (c: HonoContext) => ({ slug: c.req.param("slug"), path: c.req.path });

  // GET /api/instances/:slug/shared-files — list as a tree
  app.get(
    "/api/instances/:slug/shared-files",
    permission({
      action: ACTIONS.SHARED_FILES_LIST,
      resource: { kind: "shared-files" },
      attributes: attr,
    }),
    (c) => {
      const { instance } = getInstanceContext(c);

      const rows = registry.listSharedFiles(instance.id).map((f) => ({
        filename: f.filename,
        size: Buffer.byteLength(f.content ?? "", "utf8"),
        content_hash: f.content_hash ?? "",
        updated_at: f.updated_at ?? "",
      }));
      return c.json({ tree: buildFileTree(rows) });
    },
  );

  // GET /api/instances/:slug/shared-files/* — read a single file
  app.get(
    "/api/instances/:slug/shared-files/*",
    permission({
      action: ACTIONS.SHARED_FILE_READ,
      resource: { kind: "shared-files" },
      attributes: attrWithPath,
    }),
    (c) => {
      const { instance, slug } = getInstanceContext(c);

      const extracted = extractRelPath(new URL(c.req.url).pathname, slug);
      if ("error" in extracted) return apiError(c, 400, "INVALID_PATH", extracted.error);

      let relPath: string;
      try {
        relPath = validateWorkspaceRelativePath(extracted.relPath);
      } catch (err) {
        return invalidPath(c, err);
      }

      const file = registry.getSharedFileContent(instance.id, relPath);
      if (!file) return apiError(c, 404, "FILE_NOT_FOUND", "File not found");

      return c.json({
        filename: file.filename,
        path: file.filename,
        content: file.content ?? "",
        content_hash: file.content_hash ?? "",
        updated_at: file.updated_at ?? "",
        editable: true,
      });
    },
  );

  // PUT /api/instances/:slug/shared-files/* — create or update
  app.put(
    "/api/instances/:slug/shared-files/*",
    permission({
      action: ACTIONS.SHARED_FILE_UPDATE,
      resource: { kind: "shared-files" },
      attributes: attrWithPath,
    }),
    (c) => handleSharedFileUpdate(c, registry, conn),
  );

  // DELETE /api/instances/:slug/shared-files/* — delete
  app.delete(
    "/api/instances/:slug/shared-files/*",
    permission({
      action: ACTIONS.SHARED_FILE_DELETE,
      resource: { kind: "shared-files" },
      attributes: attrWithPath,
    }),
    (c) => handleSharedFileDelete(c, registry, conn),
  );
}
