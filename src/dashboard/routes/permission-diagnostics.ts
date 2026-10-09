import type { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../route-deps.js";
import { ACTIONS } from "../middleware/permission-actions.js";
import {
  getPermissionChecker,
  permission,
  type PermissionContext,
} from "../middleware/permission.js";

const InspectSchema = z.object({
  action: z.string().trim().min(1).max(200),
  resource: z.object({
    kind: z.string().trim().min(1).max(100),
    id: z.string().trim().min(1).max(500).optional(),
    orgId: z.string().trim().min(1).max(200).optional(),
  }),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

/** Register the authenticated effective-permission diagnostic endpoint. */
export function registerPermissionDiagnosticsRoutes(app: Hono): void {
  app.post(
    "/api/auth/permissions/inspect",
    permission({
      action: ACTIONS.AUTH_PERMISSION_INSPECT,
      resource: { kind: "permission-diagnostic" },
    }),
    async (c) => {
      const parsed = InspectSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);

      const user = c.get("user");
      const { resource, attributes } = parsed.data;
      const target: PermissionContext = {
        user,
        action: parsed.data.action,
        resource: {
          kind: resource.kind,
          ...(resource.id !== undefined ? { id: resource.id } : {}),
          ...(resource.orgId !== undefined ? { orgId: resource.orgId } : {}),
        },
        ...(attributes !== undefined ? { attributes } : {}),
      };
      const decision = await getPermissionChecker().check(target);
      return c.json({
        principal: user,
        action: target.action,
        resource: target.resource,
        allowed: decision.allow,
        matchedGrant: decision.matchedGrant ?? null,
        denialReason: decision.allow ? null : decision.reason,
        ...(!decision.allow && decision.requiresApproval ? { requiresApproval: true } : {}),
      });
    },
  );
}
