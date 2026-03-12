/**
 * runtime/permission/index.ts
 *
 * Permission engine for claw-runtime.
 * Inspired by OpenCode's permission/next.ts.
 *
 * Design:
 * - Rules are evaluated in order, last-match-wins
 * - Default action when no rule matches: "ask"
 * - Supports per-instance, per-agent, and per-session rulesets
 * - Approval persistence: "once" (session) or "always" (instance)
 */

import type {
  PermissionRule,
  PermissionRuleset,
  PermissionAction,
  PermissionResult,
  InstanceSlug,
  SessionId,
} from "../types.js";
import { wildcardMatch } from "./wildcard.js";

export { wildcardMatch };
export type { PermissionRule, PermissionRuleset, PermissionAction, PermissionResult };

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a ruleset for a given (permission, pattern) pair.
 * Rules are evaluated in order — the LAST matching rule wins.
 * Returns "ask" if no rule matches (safe default).
 */
export function evaluateRuleset(
  ruleset: PermissionRuleset,
  permission: string,
  pattern: string,
): PermissionResult {
  let matched: PermissionRule | undefined;

  for (const rule of ruleset) {
    if (wildcardMatch(rule.permission, permission) && wildcardMatch(rule.pattern, pattern)) {
      matched = rule;
      // Don't break — last match wins
    }
  }

  if (!matched) {
    return { action: "ask" };
  }

  return { action: matched.action, matchedRule: matched };
}

// ---------------------------------------------------------------------------
// Approval persistence (in-memory, per instance)
// ---------------------------------------------------------------------------

interface ApprovalKey {
  instanceSlug: InstanceSlug;
  sessionId: SessionId | undefined;
  permission: string;
  pattern: string;
}

function approvalKeyString(key: ApprovalKey): string {
  return `${key.instanceSlug}::${key.sessionId ?? "global"}::${key.permission}::${key.pattern}`;
}

/** Instance-level persistent approvals (survive session changes) */
const _instanceApprovals = new Map<string, PermissionAction>();

/** Session-level approvals (cleared when session ends) */
const _sessionApprovals = new Map<string, PermissionAction>();

/**
 * Record a user approval decision.
 * @param persist - "always" = instance-level, "once" = session-level
 */
export function recordApproval(
  key: ApprovalKey,
  action: PermissionAction,
  persist: "always" | "once",
): void {
  const k = approvalKeyString(key);
  if (persist === "always") {
    _instanceApprovals.set(k, action);
  } else {
    _sessionApprovals.set(k, action);
  }
}

/**
 * Look up a previously recorded approval.
 * Instance-level takes precedence over session-level.
 */
export function lookupApproval(key: ApprovalKey): PermissionAction | undefined {
  const k = approvalKeyString(key);
  return _instanceApprovals.get(k) ?? _sessionApprovals.get(k);
}

/**
 * Clear all session-level approvals for a given session.
 * Call this when a session ends.
 */
export function clearSessionApprovals(slug: InstanceSlug, sessionId: SessionId): void {
  const prefix = `${slug}::${sessionId}::`;
  for (const key of _sessionApprovals.keys()) {
    if (key.startsWith(prefix)) {
      _sessionApprovals.delete(key);
    }
  }
}

/**
 * Clear all approvals for an instance (called on instance destroy).
 */
export function clearInstanceApprovals(slug: InstanceSlug): void {
  const prefix = `${slug}::`;
  for (const key of _instanceApprovals.keys()) {
    if (key.startsWith(prefix)) _instanceApprovals.delete(key);
  }
  for (const key of _sessionApprovals.keys()) {
    if (key.startsWith(prefix)) _sessionApprovals.delete(key);
  }
}

// ---------------------------------------------------------------------------
// High-level permission check
// ---------------------------------------------------------------------------

export interface PermissionCheckOptions {
  instanceSlug: InstanceSlug;
  sessionId?: SessionId | undefined;
  /** Agent-level ruleset (applied first) */
  agentRuleset?: PermissionRuleset | undefined;
  /** Session-level ruleset override (applied on top of agent ruleset) */
  sessionRuleset?: PermissionRuleset | undefined;
}

/**
 * Full permission check with approval persistence lookup.
 *
 * Resolution order:
 * 1. Check recorded approvals (instance > session)
 * 2. Evaluate session ruleset (if provided)
 * 3. Evaluate agent ruleset (if provided)
 * 4. Default: "ask"
 */
export function checkPermission(
  permission: string,
  pattern: string,
  options: PermissionCheckOptions,
): PermissionResult {
  const { instanceSlug, sessionId, agentRuleset, sessionRuleset } = options;

  // 1. Check recorded approvals
  const recorded = lookupApproval({ instanceSlug, sessionId, permission, pattern });
  if (recorded) {
    return { action: recorded };
  }

  // 2. Session ruleset (highest priority)
  if (sessionRuleset && sessionRuleset.length > 0) {
    const result = evaluateRuleset(sessionRuleset, permission, pattern);
    if (result.action !== "ask" || result.matchedRule) {
      return result;
    }
  }

  // 3. Agent ruleset
  if (agentRuleset && agentRuleset.length > 0) {
    return evaluateRuleset(agentRuleset, permission, pattern);
  }

  // 4. Default
  return { action: "ask" };
}

// ---------------------------------------------------------------------------
// Built-in rulesets for standard agent types
// ---------------------------------------------------------------------------

/** Ruleset for the "explore" agent — read-only */
export const EXPLORE_AGENT_RULESET: PermissionRuleset = [
  { permission: "read", pattern: "**", action: "allow" },
  { permission: "glob", pattern: "**", action: "allow" },
  { permission: "grep", pattern: "**", action: "allow" },
  { permission: "bash", pattern: "**", action: "ask" },
  { permission: "write", pattern: "**", action: "deny" },
  { permission: "edit", pattern: "**", action: "deny" },
  { permission: "task", pattern: "**", action: "deny" },
];

/** Ruleset for the "plan" agent — no file edits */
export const PLAN_AGENT_RULESET: PermissionRuleset = [
  { permission: "read", pattern: "**", action: "allow" },
  { permission: "glob", pattern: "**", action: "allow" },
  { permission: "grep", pattern: "**", action: "allow" },
  { permission: "write", pattern: "**", action: "deny" },
  { permission: "edit", pattern: "**", action: "deny" },
  { permission: "bash", pattern: "**", action: "ask" },
];

/** Ruleset for sub-agents spawned via the task tool */
export const SUBAGENT_RULESET: PermissionRuleset = [
  { permission: "task", pattern: "**", action: "deny" }, // No nested spawning by default
];

/** Ruleset for internal agents (compaction, title, summary) — no tools */
export const INTERNAL_AGENT_RULESET: PermissionRuleset = [
  { permission: "*", pattern: "**", action: "deny" },
];
