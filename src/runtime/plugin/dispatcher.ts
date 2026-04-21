/**
 * runtime/plugin/dispatcher.ts
 *
 * Decision-aware dispatcher for `tool.beforeCall` (H8 — plugin API hardening).
 *
 * The generic `runHooks` engine in `hooks.ts` is fire-and-forget: it ignores
 * return values and swallows throws. That is correct for notification hooks
 * (`agent.end`, `message.received`, …) but insufficient for policy enforcement.
 *
 * This module observes the return of each `tool.beforeCall` plugin and folds
 * them into a single `ToolCallDecision`:
 *
 * - `undefined` / `{ action: "allow" }` → continue to next plugin
 * - `{ action: "deny" }`                → emit `tool.denied`, short-circuit
 * - `{ action: "modify-args" }`         → emit `tool.args_modified`, chain new args
 * - `{ action: "require-approval" }`    → emit `tool.approval_required`, short-circuit
 * - `throw err`                         → treated as `{ action: "deny", reason: err.message }`
 *
 * Plugins are invoked sequentially in registration order. Community ships no
 * plugin that returns a decision ≠ allow; Enterprise registers policy plugins
 * via `registerPlugin(enterprisePolicyPlugin)`.
 */

import type { ToolCallContext, ToolCallDecision } from "./types.js";
import { getRegisteredHooks } from "./hooks.js";
import { emitAudit } from "../../core/audit/emitter.js";
import { hashArgs } from "../../core/audit/canonical.js";
import { logger } from "../../lib/logger.js";

export interface DispatchResult {
  decision: ToolCallDecision;
  /** Effective args after any `modify-args` mutations in the chain. */
  effectiveArgs: unknown;
}

export interface DispatchExtra {
  /** Agent id passed to audit events. Falls back to `instanceSlug` when absent. */
  agentId?: string;
  /** User id for audit correlation; undefined when no HTTP request is in flight. */
  userId?: string;
}

interface AuditMeta {
  agentId: string;
  tool: string;
  userId: string | undefined;
}

function auditDenied(meta: AuditMeta, reason: string, argsHash: string): void {
  emitAudit({
    kind: "tool.denied",
    agentId: meta.agentId,
    tool: meta.tool,
    reason,
    argsHash,
    ...(meta.userId !== undefined ? { userId: meta.userId } : {}),
  });
}

function auditArgsModified(meta: AuditMeta, argsHash: string): void {
  emitAudit({
    kind: "tool.args_modified",
    agentId: meta.agentId,
    tool: meta.tool,
    argsHash,
    ...(meta.userId !== undefined ? { userId: meta.userId } : {}),
  });
}

function auditApprovalRequired(meta: AuditMeta, approvalKind: string, argsHash: string): void {
  emitAudit({
    kind: "tool.approval_required",
    agentId: meta.agentId,
    tool: meta.tool,
    approvalKind,
    argsHash,
    ...(meta.userId !== undefined ? { userId: meta.userId } : {}),
  });
}

async function invokePlugin(
  fn: NonNullable<
    (ctx: ToolCallContext) => void | Promise<void> | ToolCallDecision | Promise<ToolCallDecision>
  >,
  ctx: ToolCallContext,
): Promise<ToolCallDecision | undefined> {
  try {
    const res = await fn(ctx);
    return res ?? undefined;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`Plugin hook "tool.beforeCall" threw: ${reason}`);
    return { action: "deny", reason };
  }
}

export async function dispatchToolBeforeCall(
  ctx: ToolCallContext,
  extra: DispatchExtra = {},
): Promise<DispatchResult> {
  const meta: AuditMeta = {
    agentId: extra.agentId ?? ctx.instanceSlug,
    tool: ctx.toolName,
    userId: extra.userId,
  };
  let currentArgs = ctx.args;

  for (const hooks of getRegisteredHooks()) {
    const fn = hooks["tool.beforeCall"];
    if (!fn) continue;

    const result = await invokePlugin(fn, { ...ctx, args: currentArgs });
    if (!result || result.action === "allow") continue;

    if (result.action === "deny") {
      auditDenied(meta, result.reason, hashArgs(currentArgs));
      return { decision: result, effectiveArgs: currentArgs };
    }
    if (result.action === "modify-args") {
      currentArgs = result.newArgs;
      auditArgsModified(meta, hashArgs(currentArgs));
      continue;
    }
    // require-approval
    auditApprovalRequired(meta, result.approvalRequest.kind, hashArgs(currentArgs));
    return { decision: result, effectiveArgs: currentArgs };
  }

  return { decision: { action: "allow" }, effectiveArgs: currentArgs };
}
