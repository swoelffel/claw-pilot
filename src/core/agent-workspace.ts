// src/core/agent-workspace.ts
//
// Pure utility for resolving agent workspace paths.
// Extracted from discovery.ts to break the circular dependency:
//   agent-sync.ts → discovery.ts → agent-sync.ts (was circular)
//   agent-sync.ts → agent-workspace.ts (acyclic)
//   discovery.ts  → agent-workspace.ts (acyclic)

/**
 * Resolve the workspace path for an agent given the instance stateDir,
 * the agent ID, an optional explicit workspace field from config, and the
 * full agents.list array (used to detect multi-agent layout).
 *
 * Priority:
 *   1. Explicit `workspace` field in config (absolute → as-is, relative → under workspaces/)
 *   2. Multi-agent layout (agents.list non-empty) → workspaces/<agentId>
 *   3. Native single-instance layout for "main" → workspace (singular)
 *   4. Fallback → workspaces/<agentId>
 *
 * If an explicit `workspace` field is provided for the agent (absolute or relative),
 * it always takes precedence over both heuristics.
 * @public
 */
export function resolveAgentWorkspacePath(
  stateDir: string,
  agentId: string,
  explicitWorkspace: string | undefined,
  agentsList: Array<Record<string, unknown>>,
): string {
  // Explicit workspace field — absolute path used as-is, relative resolved under workspaces/
  if (explicitWorkspace) {
    if (explicitWorkspace.startsWith("/")) return explicitWorkspace;
    return `${stateDir}/workspaces/${explicitWorkspace}`;
  }

  // If agents.list is non-empty → claw-pilot multi-instance layout
  if (agentsList.length > 0) {
    return `${stateDir}/workspaces/${agentId}`;
  }

  // Native OpenClaw single-instance layout: workspace is at <stateDir>/workspace (singular)
  // Only applies to the implicit main agent (no list entry).
  // Any explicitly listed agent still gets workspaces/<id>.
  if (agentId === "main") {
    return `${stateDir}/workspace`;
  }

  // Fallback for non-main agents without explicit workspace in a no-list config
  return `${stateDir}/workspaces/${agentId}`;
}
