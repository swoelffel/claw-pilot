// src/core/audit/events.ts
//
// Structured audit event taxonomy (H6).
//
// Discriminated union consumed by `emitAudit()`. Each variant is the minimum
// payload required for a given security event; adding a field requires a
// dedicated PR so existing sinks stay schema-stable.
//
// R5 reminder: NEVER include plaintext secrets, passwords, tokens, or
// unredacted API keys in a payload. Sensitive fields are structurally
// excluded from each variant; there is no runtime sanitizer.

/** Discriminated union of every audit event emitted by the core. */
export type AuditEvent =
  | {
      kind: "auth.login";
      userId: string;
      provider: string;
      success: boolean;
      ip?: string;
      userAgent?: string;
    }
  | {
      kind: "auth.logout";
      userId: string;
    }
  | {
      kind: "auth.failed";
      attemptedUsername: string;
      reason: string;
      ip?: string;
    }
  | {
      kind: "permission.denied";
      userId: string;
      action: string;
      resource: string;
      reason: string;
    }
  | {
      kind: "secret.access";
      name: string;
      /** `userId` of the caller, or `system:<context>` when emitted outside a request. */
      by: string;
    }
  | {
      kind: "agent.tool_call";
      agentId: string;
      tool: string;
      /** SHA-256 of the canonical JSON of the tool arguments (see `canonicalize`). */
      argsHash: string;
      /** `userId` if the tool call was triggered by an authenticated request; undefined otherwise. */
      userId?: string;
    }
  | {
      kind: "named_key.mutation";
      action: "create" | "update" | "delete";
      keyId: string;
      by: string;
    }
  | {
      kind: "tool.denied";
      agentId: string;
      tool: string;
      /** Reason returned by the denying plugin (or thrown error message). */
      reason: string;
      /** SHA-256 of the canonical JSON of the tool arguments. */
      argsHash: string;
      userId?: string;
    }
  | {
      kind: "tool.approval_required";
      agentId: string;
      tool: string;
      /** Backend identifier of the approval request (e.g. `"slack"`). */
      approvalKind: string;
      argsHash: string;
      userId?: string;
    }
  | {
      kind: "tool.args_modified";
      agentId: string;
      tool: string;
      /** SHA-256 of the canonical JSON of the mutated arguments. */
      argsHash: string;
      userId?: string;
    }
  | {
      kind: "plugin.rejected";
      /** Canonical absolute path of the rejected plugin file. */
      path: string;
      /** `kind` of the verifier that issued the rejection (e.g. `"ca"`, `"cosign"`). */
      verifierKind: string;
      /** Human-readable rejection reason returned by `verify()`. */
      reason: string;
    };

/** Fully-hydrated event as written to sinks. */
export type AuditEventEnvelope = AuditEvent & {
  /** ISO-8601 UTC timestamp assigned at emit-time. */
  timestamp: string;
  /** `serverRegistry.getLocal().id` — stable across restarts. */
  serverId: string;
  /** Enterprise routing slot — always `undefined` in Community. */
  orgId?: string;
};
