// src/core/agent-workspace.ts
//
// Pure utility for resolving agent workspace paths.
// Extracted from discovery.ts to break the circular dependency:
//   agent-sync.ts → discovery.ts → agent-sync.ts (was circular)
//   agent-sync.ts → agent-workspace.ts (acyclic)
//   discovery.ts  → agent-workspace.ts (acyclic)

/**
 * Resolve the workspace path for an agent given the instance stateDir,
 * the agent ID, and an optional explicit workspace field from config.
 *
 * Convention: workspaces/<agentId> — always under the workspaces/ subdirectory.
 *
 * Priority:
 *   1. Explicit `workspace` field in config (absolute → as-is, relative → under workspaces/)
 *   2. Default: workspaces/<agentId>
 *
 * If an explicit `workspace` field is provided for the agent (absolute or relative),
 * it always takes precedence.
 * @public
 */
export function resolveAgentWorkspacePath(
  stateDir: string,
  agentId: string,
  explicitWorkspace: string | undefined,
): string {
  // Explicit workspace field — absolute path used as-is, relative resolved under workspaces/
  if (explicitWorkspace) {
    if (explicitWorkspace.startsWith("/")) return explicitWorkspace;
    return `${stateDir}/workspaces/${explicitWorkspace}`;
  }

  // Always workspaces/<agentId>
  return `${stateDir}/workspaces/${agentId}`;
}
