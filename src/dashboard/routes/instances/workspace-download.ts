// src/dashboard/routes/instances/workspace-download.ts
// Route: GET /api/instances/:slug/workspace/download?path=<absolute-path>
// Serves workspace files as downloadable attachments.

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
import { mimeFromExtension } from "../../../lib/mime.js";
import { logger } from "../../../lib/logger.js";
import { permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size for download (50 MB) */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

export function registerWorkspaceDownloadRoutes(app: Hono, _deps: RouteDeps): void {
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });

  app.get(
    "/api/instances/:slug/workspace/download",
    permission({
      action: ACTIONS.WORKSPACE_DOWNLOAD,
      resource: { kind: "workspace" },
      attributes: attr,
    }),
    async (c) => {
      const { instance } = getInstanceContext(c);

      const filePath = c.req.query("path");
      if (!filePath) {
        return apiError(c, 400, "MISSING_PATH", "Query parameter 'path' is required");
      }

      // Resolve and validate the file is within the instance state directory
      const stateDir = instance.state_dir;
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

      // Open once, stat + read through the same handle so size + content
      // always correspond to the same inode (avoids TOCTOU).
      let fh: Awaited<ReturnType<typeof fs.open>>;
      try {
        fh = await fs.open(real, "r");
      } catch (err) {
        logger.debug("[route:workspace-download] open failed", { error: String(err) });
        return apiError(c, 404, "FILE_NOT_FOUND", "File not found");
      }
      let data: Buffer;
      try {
        const stat = await fh.stat();
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
        data = await fh.readFile();
      } finally {
        await fh.close();
      }
      const filename = path.basename(real);
      const ext = path.extname(filename);
      const mime = mimeFromExtension(ext);

      // RFC 5987 / 6266 encoding for filename: strip control chars, URL-encode.
      // This prevents header injection (CR/LF) and correctly handles unicode.
      // eslint-disable-next-line no-control-regex -- stripping CR/LF/NUL is the whole point
      const safeFilename = filename.replace(/[\r\n\u0000]/g, "");
      const encoded = encodeURIComponent(safeFilename);
      return new Response(data, {
        headers: {
          "content-type": mime,
          "content-disposition": `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
          "content-length": String(data.length),
        },
      });
    },
  );
}
