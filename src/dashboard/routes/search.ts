// src/dashboard/routes/search.ts
// Routes: global search via FTS5 index

import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import { searchEntities } from "../../core/repositories/search-repository.js";
import { permission } from "../middleware/permission.js";
import { ACTIONS } from "../middleware/permission-actions.js";

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

export function registerSearchRoutes(app: Hono, deps: RouteDeps): void {
  // GET /api/search?q=<term>&limit=<n>
  app.get(
    "/api/search",
    permission({ action: ACTIONS.SEARCH_QUERY, resource: { kind: "search" } }),
    (c) => {
      const parsed = SearchQuerySchema.safeParse(c.req.query());
      if (!parsed.success) {
        return apiError(c, 400, "INVALID_QUERY", parsed.error.message);
      }

      const { q, limit } = parsed.data;
      const results = searchEntities(deps.db, q, limit);

      return c.json({ results });
    },
  );
}
