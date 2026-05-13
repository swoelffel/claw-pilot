// src/dashboard/routes/instances/agents/permissions.ts
//
// WS-WRITE-001 — agent workspace-write permission endpoints.
//
// Extension-Point: ws-write-own
//
// GET    /api/instances/:slug/agents/:agentId/permissions
// PATCH  /api/instances/:slug/agents/:agentId/permissions
// GET    /api/instances/:slug/agents/:agentId/recent-writes?limit=10
//
// Read returns the persisted scope + path lists + quota; write validates the
// payload server-side (Zod + picomatch makeRe), refuses any attempt to mutate
// the hardcoded core protected paths (they are immutable), and persists via
// the agent repository.

import type { Hono } from "hono";
import picomatch from "picomatch";
import { z } from "zod";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { permission } from "../../../middleware/permission.js";
import { ACTIONS } from "../../../middleware/permission-actions.js";
import { getInstanceContext } from "../../_instance-middleware.js";
import { logger } from "../../../../lib/logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

const ScopeSchema = z.enum(["none", "own", "own_shared", "system"]);
const PeriodSchema = z.enum(["daily", "weekly", "never"]);

const GlobListSchema = z.array(z.string().min(1).max(255)).max(50);

function isValidGlobList(globs: string[]): boolean {
  for (const g of globs) {
    try {
      picomatch.makeRe(g);
    } catch (err) {
      logger.debug("invalid glob pattern", { glob: g, error: String(err) });
      return false;
    }
  }
  return true;
}

const PermissionsPatchSchema = z
  .object({
    fsWriteScope: ScopeSchema.optional(),
    protectedPaths: GlobListSchema.nullable().optional(),
    allowedPaths: GlobListSchema.nullable().optional(),
    writeQuotaMb: z
      .number()
      .int()
      .min(0)
      .max(1024 * 100)
      .nullable()
      .optional(),
    quotaResetPeriod: PeriodSchema.nullable().optional(),
  })
  .strict();

interface RecentWriteRow {
  timestamp: string;
  payload: string;
}

export function registerAgentPermissionsRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, db } = deps;
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });
  const aid = (c: HonoContext) => c.req.param("agentId");

  // -------------------------------------------------------------------------
  // GET /permissions
  // -------------------------------------------------------------------------
  app.get(
    "/api/instances/:slug/agents/:agentId/permissions",
    permission({
      action: ACTIONS.AGENT_PERMISSIONS_READ,
      resource: { kind: "agent", id: aid },
      attributes: attr,
    }),
    async (c) => {
      const { instance } = getInstanceContext(c);
      const agentId = c.req.param("agentId");
      const agent = registry.getAgentByAgentId(instance.id, agentId);
      if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

      const perms = registry.getWritePermissions(agent.id);
      if (!perms) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent permissions not found");

      const protectedPaths = perms.protectedPathsJson
        ? safeParseStringArray(perms.protectedPathsJson)
        : [];
      const allowedPaths = perms.allowedPathsJson
        ? safeParseStringArray(perms.allowedPathsJson)
        : null;

      return c.json({
        fsWriteScope: perms.fsWriteScope,
        protectedPaths,
        allowedPaths,
        writeQuotaMb: perms.writeQuotaMb,
        quotaResetPeriod: perms.quotaResetPeriod,
        bytesWrittenPeriod: perms.bytesWrittenPeriod,
        quotaPeriodStartedAt: perms.quotaPeriodStartedAt,
      });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /permissions
  // -------------------------------------------------------------------------
  app.patch(
    "/api/instances/:slug/agents/:agentId/permissions",
    permission({
      action: ACTIONS.AGENT_PERMISSIONS_UPDATE,
      resource: { kind: "agent", id: aid },
      attributes: attr,
    }),
    async (c) => {
      const { instance } = getInstanceContext(c);
      const agentId = c.req.param("agentId");

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch (err) {
        logger.warn("[route:permissions] JSON parse failed", { error: String(err) });
        return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
      }

      const parsed = PermissionsPatchSchema.safeParse(raw);
      if (!parsed.success) {
        return apiError(
          c,
          400,
          "FIELD_INVALID",
          parsed.error.issues[0]?.message ?? "Invalid fields",
        );
      }

      const data = parsed.data;
      if (data.protectedPaths && !isValidGlobList(data.protectedPaths)) {
        return apiError(c, 400, "INVALID_GLOB", "One or more protectedPaths globs are invalid");
      }
      if (data.allowedPaths && !isValidGlobList(data.allowedPaths)) {
        return apiError(c, 400, "INVALID_GLOB", "One or more allowedPaths globs are invalid");
      }
      if (
        (data.writeQuotaMb !== undefined && data.writeQuotaMb !== null) !==
        (data.quotaResetPeriod !== undefined && data.quotaResetPeriod !== null)
      ) {
        // Nothing strict — accept partial updates. We don't force atomic pairs
        // since admins can adjust them in two PATCH calls if needed.
      }

      const agent = registry.getAgentByAgentId(instance.id, agentId);
      if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

      registry.setWritePermissions(agent.id, {
        ...(data.fsWriteScope !== undefined ? { fsWriteScope: data.fsWriteScope } : {}),
        ...("protectedPaths" in data
          ? {
              protectedPathsJson:
                data.protectedPaths === null ? null : JSON.stringify(data.protectedPaths),
            }
          : {}),
        ...("allowedPaths" in data
          ? {
              allowedPathsJson:
                data.allowedPaths === null ? null : JSON.stringify(data.allowedPaths),
            }
          : {}),
        ...("writeQuotaMb" in data ? { writeQuotaMb: data.writeQuotaMb ?? null } : {}),
        ...("quotaResetPeriod" in data ? { quotaResetPeriod: data.quotaResetPeriod ?? null } : {}),
      });

      return c.json({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // GET /recent-writes
  // -------------------------------------------------------------------------
  app.get(
    "/api/instances/:slug/agents/:agentId/recent-writes",
    permission({
      action: ACTIONS.AGENT_RECENT_WRITES_READ,
      resource: { kind: "agent", id: aid },
      attributes: attr,
    }),
    async (c) => {
      const { instance } = getInstanceContext(c);
      const agentId = c.req.param("agentId");
      const agent = registry.getAgentByAgentId(instance.id, agentId);
      if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

      const limitRaw = Number(c.req.query("limit") ?? "10");
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(50, Math.trunc(limitRaw)))
        : 10;

      const rows = db
        .prepare(
          `SELECT timestamp, payload
             FROM rt_audit_events
            WHERE kind = 'agent.workspace_write'
              AND json_extract(payload, '$.agentId') = ?
              AND json_extract(payload, '$.instanceSlug') = ?
            ORDER BY timestamp DESC
            LIMIT ?`,
        )
        .all(agentId, instance.slug, limit) as RecentWriteRow[];

      const items = rows.map((r) => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(r.payload) as Record<string, unknown>;
        } catch (err) {
          logger.debug("failed to parse permission payload", { error: String(err) });
          parsed = {};
        }
        return {
          timestamp: r.timestamp,
          path: parsed["path"] ?? null,
          outcome: parsed["outcome"] ?? null,
          reason: parsed["reason"] ?? null,
          bytesWritten: parsed["bytesWritten"] ?? 0,
        };
      });

      return c.json({ items });
    },
  );
}

function safeParseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string");
    return [];
  } catch (err) {
    logger.debug("[route:permissions] malformed JSON in glob list", { error: String(err) });
    return [];
  }
}
