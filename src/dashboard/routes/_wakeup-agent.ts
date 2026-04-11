/**
 * dashboard/routes/_wakeup-agent.ts
 *
 * Fire-and-forget helper that wakes an agent after injecting a notification
 * message into its permanent session.
 *
 * Delegates execution to the runtime daemon's internal API.
 * If the runtime is not running, silently skips (the message stays in the
 * session and will be processed when the runtime starts).
 */

import { getRuntimeStateDir, isRuntimeRunning } from "../../lib/platform.js";
import { callRuntimeApi } from "./_internal-api-client.js";
import { logger } from "../../lib/logger.js";

/**
 * Trigger a prompt loop for an agent, fire-and-forget.
 * The message must already be in the agent's session (via createUserMessage).
 * Delegates to the runtime daemon — silently skips if runtime is not running.
 */
export function wakeupAgent(options: {
  db: unknown;
  registry: unknown;
  slug: string;
  agentId: string;
  messageText: string;
}): void {
  const { slug, agentId, messageText } = options;

  const stateDir = getRuntimeStateDir(slug);
  if (!isRuntimeRunning(stateDir)) {
    logger.warn("wakeup_skipped_runtime_not_running", {
      event: "wakeup_skipped_runtime_not_running",
      slug,
      agentId,
    });
    return;
  }

  void callRuntimeApi(slug, "/internal/wake", { agentId, messageText }, { timeoutMs: 5000 }).catch(
    (err: unknown) => {
      logger.error("wakeup_agent_failed", {
        event: "wakeup_agent_failed",
        slug,
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    },
  );
}
