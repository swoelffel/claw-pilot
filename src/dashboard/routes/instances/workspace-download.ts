// src/dashboard/routes/instances/workspace-download.ts
// Route: GET /api/instances/:slug/workspace/download?path=<absolute-path>
// Serves workspace files as downloadable attachments.

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import { mimeFromExtension } from "../../../lib/mime.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size for download (50 MB) */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerWorkspaceDownloadRoutes(app: Hono, deps: RouteDeps): void {
  const { registry } = deps;

  app.get("/api/instances/:slug/workspace/download", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const filePath = c.req.query("path");
    if (!filePath) {
      return apiError(c, 400, "MISSING_PATH", "Query parameter 'path' is required");
    }

    // Resolve and validate the file is within the instance state directory
    const stateDir = instance!.state_dir;
    const resolved = path.resolve(filePath);
    let real: string;
    try {
      real = await fs.realpath(resolved);
    } catch (err) {
      logger.debug("[route:workspace-download] realpath failed", { error: String(err) });
      return apiError(c, 404, "FILE_NOT_FOUND", "File not found");
    }

    // Path traversal + symlink escape protection
    if (!real.startsWith(stateDir + path.sep) && real !== stateDir) {
      return apiError(c, 403, "FORBIDDEN", "Access denied");
    }

    // Read file and check constraints
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(real);
    } catch (err) {
      logger.debug("[route:workspace-download] stat failed", { error: String(err) });
      return apiError(c, 404, "FILE_NOT_FOUND", "File not found");
    }

    if (!stat.isFile()) {
      return apiError(c, 400, "NOT_A_FILE", "Path is not a file");
    }

    if (stat.size > MAX_FILE_SIZE) {
      return apiError(
        c,
        413,
        "FILE_TOO_LARGE",
        `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
      );
    }

    // Read and serve
    const data = await fs.readFile(real);
    const filename = path.basename(real);
    const ext = path.extname(filename);
    const mime = mimeFromExtension(ext);

    return new Response(data, {
      headers: {
        "content-type": mime,
        "content-disposition": `attachment; filename="${filename.replace(/"/g, '\\"')}"`,
        "content-length": String(data.length),
      },
    });
  });
}
