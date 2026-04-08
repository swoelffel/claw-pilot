/**
 * dashboard/routes/_wakeup-agent.ts
 *
 * Fire-and-forget helper that triggers a prompt loop for an agent in the
 * dashboard process. Used by the task assignment route to wake an agent
 * after injecting a notification message into its permanent session.
 *
 * This performs the same setup as POST /runtime/chat (config loading, agent
 * registry init, middleware registration, model resolution) but runs the
 * prompt loop asynchronously without waiting for the result.
 */

import type Database from "better-sqlite3";
import type { Registry } from "../../core/registry.js";
import { getRuntimeStateDir } from "../../lib/platform.js";
import { buildResolvedEnv } from "../../lib/env-reader.js";
import {
  runPromptLoop,
  getOrCreatePermanentSession,
  resolveEffectivePersistence,
  initAgentRegistry,
  getAgent,
  type RuntimeAgentConfig,
} from "../../runtime/index.js";
import { resolveAgentWorkspacePath } from "../../core/agent-workspace.js";
import { runMiddlewarePipeline } from "../../runtime/middleware/pipeline.js";
import { registerMiddleware, clearMiddlewares } from "../../runtime/middleware/registry.js";
import { guardrailMiddleware } from "../../runtime/middleware/built-in/guardrail.js";
import { multimodalMiddleware } from "../../runtime/middleware/built-in/multimodal.js";
import { toolErrorRecoveryMiddleware } from "../../runtime/middleware/built-in/tool-error-recovery.js";
import { createSuggestionMiddleware } from "../../runtime/middleware/built-in/suggestions.js";
import { loadMergedConfigDbFirst } from "./_config-helpers.js";
import { resolveModelForAgent } from "../../runtime/channel/router.js";
import { logger } from "../../lib/logger.js";

/**
 * Trigger a prompt loop for an agent, fire-and-forget.
 * The message must already be in the agent's session (via createUserMessage).
 * This function resolves config, model, and runs the prompt loop asynchronously.
 */
export function wakeupAgent(options: {
  db: Database.Database;
  registry: Registry;
  slug: string;
  agentId: string;
  messageText: string;
}): void {
  const { db, registry, slug, agentId, messageText } = options;

  const run = async (): Promise<void> => {
    const stateDir = getRuntimeStateDir(slug);
    const config = loadMergedConfigDbFirst(registry, slug, stateDir);
    if (!config) return;

    initAgentRegistry(config.agents);

    clearMiddlewares();
    registerMiddleware(guardrailMiddleware);
    registerMiddleware(multimodalMiddleware);
    registerMiddleware(toolErrorRecoveryMiddleware);
    if (config.artifacts?.suggestionsEnabled !== false) {
      registerMiddleware(
        createSuggestionMiddleware({
          ...(config.artifacts?.suggestionsModel !== undefined
            ? { suggestionsModel: config.artifacts.suggestionsModel }
            : {}),
          maxSuggestions: config.artifacts?.maxSuggestions ?? 3,
          ...(config.models !== undefined && config.models.length > 0
            ? { modelAliases: config.models }
            : {}),
        }),
      );
    }

    const agentInfo = getAgent(agentId);
    if (!agentInfo) return;

    const agentCfg: RuntimeAgentConfig = config.agents.find((a) => a.id === agentId) ?? {
      id: agentInfo.name,
      name: agentInfo.name,
      model: agentInfo.model ?? config.defaultModel,
      permissions: agentInfo.permission ?? [],
      maxSteps: agentInfo.steps ?? 20,
      allowSubAgents: true,
      toolProfile: "executor",
      isDefault: false,
      inheritWorkspace: true,
    };

    // Load env for API key resolution
    const mergedEnv = buildResolvedEnv(stateDir);
    for (const [key, value] of Object.entries(mergedEnv)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    const resolvedModel = resolveModelForAgent(db, slug, agentCfg, config);

    const isPermanent =
      resolveEffectivePersistence(
        agentInfo,
        config.agents.find((a) => a.id === agentId),
      ) === "permanent";

    const session = isPermanent
      ? getOrCreatePermanentSession(db, { instanceSlug: slug, agentId, channel: "internal" })
      : null;

    if (!session) return;

    const agentWorkDir = resolveAgentWorkspacePath(stateDir, agentId, undefined);

    await runMiddlewarePipeline({
      ctx: {
        db,
        instanceSlug: slug,
        sessionId: session.id,
        agentConfig: agentCfg,
        message: { text: messageText, channelType: "web", peerId: "task-board" },
      },
      runLoop: () =>
        runPromptLoop({
          db,
          instanceSlug: slug,
          sessionId: session.id,
          userText: messageText,
          agentConfig: agentCfg,
          resolvedModel,
          workDir: stateDir,
          agentWorkDir,
          runtimeAgents: config.agents.map((a) => ({ id: a.id, name: a.name })),
          runtimeConfig: config,
          compactionConfig: config.compaction,
          subagentsConfig: config.subagents,
          resolveTargetModel: (targetCfg) => resolveModelForAgent(db, slug, targetCfg, config),
        }),
    });
  };

  void run().catch((err: unknown) => {
    logger.error("wakeup_agent_failed", {
      event: "wakeup_agent_failed",
      slug,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
