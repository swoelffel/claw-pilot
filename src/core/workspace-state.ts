/**
 * core/workspace-state.ts
 *
 * Lightweight persistence for workspace-level state flags.
 * Stored as JSON in <workspaceDir>/.claw-pilot/workspace-state.json.
 *
 * Design:
 * - Read/write are synchronous (called from system-prompt.ts during prompt build)
 * - Failures are silently ignored — degraded gracefully to V1 behaviour
 * - The file is intentionally NOT in EDITABLE_FILES (internal state, not user config)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceState {
  /** True once BOOTSTRAP.md has been injected into the system prompt at least once. */
  bootstrapDone?: boolean;
  /**
   * ISO 8601 date string of when the agent was first provisioned.
   * Written during agent provisioning, injected into the generic identity block
   * of the system prompt for primary agents.
   */
  agentCreatedAt?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_SUBDIR = ".claw-pilot";
const STATE_FILENAME = "workspace-state.json";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the workspace state for a given workspace directory.
 * Returns an empty object if the file is absent or cannot be parsed.
 */
export function readWorkspaceState(workspaceDir: string): WorkspaceState {
  const statePath = join(workspaceDir, STATE_SUBDIR, STATE_FILENAME);
  try {
    const raw = readFileSync(statePath, "utf-8");
    return JSON.parse(raw) as WorkspaceState;
  } catch {
    // File absent, unreadable, or invalid JSON — return empty state
    return {};
  }
}

/**
 * Write (merge) workspace state for a given workspace directory.
 * Creates the .claw-pilot/ subdirectory if it does not exist.
 * Failures are silently ignored — BOOTSTRAP.md will simply be re-injected
 * on the next session (safe degradation, no data loss).
 */
export function writeWorkspaceState(workspaceDir: string, state: WorkspaceState): void {
  const stateDir = join(workspaceDir, STATE_SUBDIR);
  const statePath = join(stateDir, STATE_FILENAME);
  try {
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Silently ignore — write failures must not block session startup
  }
}
