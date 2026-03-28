// src/lib/schemas/permission.ts
//
// Shared PermissionRuleSchema — single source of truth.
// Used by runtime/config (RuntimeConfig) and core/team-schema (team export/import).

import { z } from "zod";

/** Permission rule: allow, deny, or ask for a specific permission + pattern */
export const PermissionRuleSchema = z.object({
  permission: z.string().min(1),
  pattern: z.string().min(1),
  action: z.enum(["allow", "deny", "ask"]),
});

/** @public */
export type PermissionRule = z.infer<typeof PermissionRuleSchema>;
