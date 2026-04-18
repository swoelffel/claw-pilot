/**
 * runtime/engine/engine.ts
 *
 * ClawRuntime — top-level orchestrator that wires all subsystems together.
 *
 * Lifecycle:
 *   new ClawRuntime(config, db, slug)
 *   → start()   : init agents, MCP, channels, plugin wiring
 *   → [running] : messages flow through ChannelRouter
 *   → stop()    : disconnect channels, dispose MCP, dispose bus
 *
 * State machine: starting → running → stopping → stopped | error
 */

import type Database from "better-sqlite3";

import type { RuntimeInstanceState, InstanceSlug } from "../types.js";
import type { RuntimeConfig } from "../config/index.js";
import type { Channel } from "../channel/channel.js";
import type { InboundMessage } from "../types.js";
import { getBus, disposeBus } from "../bus/index.js";
import {
  RuntimeStarted,
  RuntimeStopped,
  RuntimeStateChanged,
  RuntimeError,
  WorkspaceFileChanged,
  SystemStateChanged,
  QuestionAsked,
} from "../bus/events.js";
import { clearWorkspaceCache, invalidateWorkspaceCache } from "../session/workspace-cache.js";
import { markAllDirty } from "../session/system-prompt-dirty.js";
import { initAgentRegistry, resolveEffectivePersistence, getAgent } from "../agent/registry.js";
import { getOrCreatePermanentSession } from "../session/session.js";
import { McpRegistry } from "../mcp/registry.js";
import { ChannelRouter, registerSubagentCompletedHandler } from "../channel/router.js";
import { WebChatChannel } from "../channel/web-chat.js";
import { createChannels } from "./channel-factory.js";
import { wirePluginsToBus } from "./plugin-wiring.js";
import { registerPlugin, initPlugins, resetPlugins } from "../plugin/plugin.js";
import { systemToolsPlugin } from "../plugin/system-tools/index.js";
import { workspaceKnowledgePlugin } from "../plugin/workspace-knowledge/index.js";
import { getRuntimeVersion } from "../_runtime-version.js";
import { SYSTEM_INSTANCE_SLUG } from "../../core/system-instance.js";
import { startHeartbeatRunner } from "../heartbeat/runner.js";
// getRegisteredHooks import removed — routes hook was removed (YAGNI)
import { registerMiddleware, clearMiddlewares } from "../middleware/index.js";
import { guardrailMiddleware } from "../middleware/built-in/guardrail.js";
import { multimodalMiddleware } from "../middleware/built-in/multimodal.js";
import { toolErrorRecoveryMiddleware } from "../middleware/built-in/tool-error-recovery.js";
import { createSuggestionMiddleware } from "../middleware/built-in/suggestions.js";
import { cleanupEphemeralSessions } from "../session/cleanup.js";
import { wireEventPersistence } from "./event-persistence.js";
import { wireNotificationEmitter } from "./notification-emitter.js";
import { notifyNewNotification } from "../../lib/notification-bridge.js";
import { wireTaskNotifications } from "./task-wiring.js";
import { pruneRtEvents } from "../../core/repositories/rt-event-repository.js";
import {
  resetExpiredMonthlyBudgets,
  getBudgetsForInstance,
  reconcileBudget,
} from "../../core/repositories/budget-repository.js";
import { Registry } from "../../core/registry.js";
import { logger, type Logger } from "../../lib/logger.js";
import {
  deriveInternalApiPort,
  resolveInternalApiToken,
  writePortFile,
  removePortFile,
} from "../../lib/platform.js";
import {
  InternalApiServer,
  type ChatRequest,
  type ChatResponse,
  type WakeRequest,
  type FlowRunRequest,
  type InternalApiHandlers,
} from "./internal-api.js";
import { createUserMessage } from "../session/message.js";
import { runPromptLoop } from "../session/prompt-loop.js";
import { runMiddlewarePipeline } from "../middleware/pipeline.js";
import { resolveModelForAgent } from "../channel/router.js";
import { startFlowRun } from "../flow/engine.js";
import { resolveQuestion as resolveQuestionFn } from "../tool/built-in/question.js";
import type { ProfileResolver } from "../profile/types.js";

// ---------------------------------------------------------------------------
// ClawRuntime
// ---------------------------------------------------------------------------

export class ClawRuntime {
  private _state: RuntimeInstanceState = "stopped";
  private _channels: Channel[] = [];
  private _mcpRegistry: McpRegistry | undefined;
  private _pluginUnsubscribers: Array<() => void> = [];
  private _subagentUnsubscribe: (() => void) | undefined;
  private _stopHeartbeat: (() => void) | undefined;
  private _eventPersistenceUnsub: (() => void) | undefined;
  private _taskWiringUnsub: (() => void) | undefined;
  private _notificationEmitterUnsub: (() => void) | undefined;
  private _cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private _internalApi: InternalApiServer | undefined;
  private _abortControllers = new Map<string, AbortController>();
  private _registry: Registry | undefined;
  private _error: string | undefined;
  readonly log: Logger;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly db: Database.Database,
    private readonly instanceSlug: InstanceSlug,
    private readonly workDir: string | undefined = undefined,
    private readonly profileResolver: ProfileResolver | undefined = undefined,
  ) {
    this.log = logger.child({ slug: instanceSlug });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get state(): RuntimeInstanceState {
    return this._state;
  }

  get error(): string | undefined {
    return this._error;
  }

  /**
   * Start the runtime.
   * Idempotent — calling start() on a running instance is a no-op.
   */
  async start(): Promise<void> {
    if (this._state === "running" || this._state === "starting") return;

    this._setState("starting");

    try {
      // 0. Clear workspace file cache — fresh start after daemon restart
      clearWorkspaceCache();

      // 1. Init agents, permanent sessions, and middlewares
      this._initAgentsAndSessions();

      // 2. Init MCP and plugins
      await this._initMcpAndPlugins();

      // 3. Wire bus subscriptions (plugins, heartbeat, event persistence, tasks)
      this._initBusWiring();

      // 4. Create channels and start internal API
      await this._initChannelsAndApi();

      this._setState("running");
      this.log.info("runtime_started", { event: "runtime_started" });

      // 5. Initial cleanup on startup (catch-up after prolonged stop)
      this._runCleanup();

      // Periodic cleanup every 6 hours
      this._cleanupTimer = setInterval(() => this._runCleanup(), 6 * 3_600_000);

      const bus = getBus(this.instanceSlug);
      bus.publish(RuntimeStarted, { slug: this.instanceSlug });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error = msg;
      this._setState("error");

      const bus = getBus(this.instanceSlug);
      const stack = err instanceof Error ? err.stack : undefined;
      bus.publish(RuntimeError, {
        slug: this.instanceSlug,
        error: msg,
        ...(stack !== undefined ? { stack } : {}),
      });

      throw err;
    }
  }

  /**
   * Stop the runtime gracefully.
   * Idempotent — calling stop() on a stopped instance is a no-op.
   */
  async stop(): Promise<void> {
    if (this._state === "stopped" || this._state === "stopping") return;

    this._setState("stopping");

    // Stop cleanup timer before shutting down
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = undefined;
    }

    const errors: string[] = [];

    // 0. Stop internal API server
    await this._shutdownSubsystem("internal-api", async () => this._internalApi?.stop(), errors);
    this._internalApi = undefined;

    // 1. Disconnect channels
    for (const channel of this._channels) {
      await this._shutdownSubsystem(`channel[${channel.type}]`, () => channel.disconnect(), errors);
    }
    this._channels = [];

    // 1b. Remove port files
    if (this.workDir) {
      removePortFile(this.workDir, "webchat");
      removePortFile(this.workDir, "api");
    }

    // 2. Dispose MCP
    await this._shutdownSubsystem("mcp", async () => this._mcpRegistry?.dispose(), errors);
    this._mcpRegistry = undefined;

    // 3. Unsubscribe plugin wiring and reset the global plugin registry.
    for (const unsub of this._pluginUnsubscribers) {
      unsub();
    }
    this._pluginUnsubscribers = [];
    resetPlugins();

    // 3b–3e. Unsubscribe sync handlers
    this._clearOptionalUnsub("_subagentUnsubscribe");
    this._clearOptionalUnsub("_stopHeartbeat");
    this._clearOptionalUnsub("_eventPersistenceUnsub");
    this._clearOptionalUnsub("_taskWiringUnsub");
    this._clearOptionalUnsub("_notificationEmitterUnsub");

    // 3f. Clear middleware registry
    clearMiddlewares();

    this._setState("stopped");
    this.log.info("runtime_stopped", { event: "runtime_stopped" });

    const bus = getBus(this.instanceSlug);
    const stopReason = errors.length > 0 ? errors.join("; ") : undefined;
    bus.publish(RuntimeStopped, {
      slug: this.instanceSlug,
      ...(stopReason !== undefined ? { reason: stopReason } : {}),
    });

    // Dispose bus last (after publishing stopped event)
    disposeBus(this.instanceSlug);
  }

  /**
   * Send an inbound message directly (bypasses channel transport).
   * Useful for programmatic use and testing.
   */
  async send(message: InboundMessage): Promise<void> {
    if (this._state !== "running") {
      throw new Error(`ClawRuntime is not running (state: ${this._state})`);
    }
    await this._buildMessageHandler()(message);
  }

  /**
   * Get the MCP registry (if MCP is enabled and started).
   */
  getMcpRegistry(): McpRegistry | undefined {
    return this._mcpRegistry;
  }

  /**
   * Get the status of all connected channels.
   * Returns a map of channel type → status.
   */
  getChannelStatuses(): Record<string, "connected" | "disconnected" | "not_configured"> {
    const result: Record<string, "connected" | "disconnected" | "not_configured"> = {};
    for (const channel of this._channels) {
      if (
        "getStatus" in channel &&
        typeof (channel as Record<string, unknown>).getStatus === "function"
      ) {
        result[channel.type] = (
          channel as unknown as {
            getStatus(): "connected" | "disconnected" | "not_configured";
          }
        ).getStatus();
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Start sub-steps
  // -------------------------------------------------------------------------

  /** Init agent registry, permanent sessions, and built-in middlewares. */
  private _initAgentsAndSessions(): void {
    // 1. Init agent registry (loads built-in agents + config agents)
    initAgentRegistry(this.config.agents);

    // 1b. Pre-create permanent sessions for all permanent agents
    //     Ensures they appear in the session tree before any A2A delegation.
    for (const agentConfig of this.config.agents) {
      const agentInfo = getAgent(agentConfig.id);
      const isPermanent =
        resolveEffectivePersistence(
          agentInfo ?? {
            kind: "primary",
            category: "user",
            archetype: null,
            name: agentConfig.id,
            permission: [],
            mode: "all",
            options: {},
          },
          agentConfig,
        ) === "permanent";
      if (isPermanent) {
        getOrCreatePermanentSession(this.db, {
          instanceSlug: this.instanceSlug,
          agentId: agentConfig.id,
          channel: "web",
        });
      }
    }

    // 1c. Register built-in middlewares
    clearMiddlewares();
    registerMiddleware(guardrailMiddleware);
    registerMiddleware(multimodalMiddleware);
    registerMiddleware(toolErrorRecoveryMiddleware);
    if (this.config.artifacts?.suggestionsEnabled !== false) {
      registerMiddleware(
        createSuggestionMiddleware({
          ...(this.config.artifacts?.suggestionsModel !== undefined
            ? { suggestionsModel: this.config.artifacts.suggestionsModel }
            : {}),
          maxSuggestions: this.config.artifacts?.maxSuggestions ?? 3,
          ...(this.config.models !== undefined && this.config.models.length > 0
            ? { modelAliases: this.config.models }
            : {}),
          runtimeConfig: this.config,
        }),
      );
    }
  }

  /** Init MCP registry and plugin system. */
  private async _initMcpAndPlugins(): Promise<void> {
    // 2. Init MCP if enabled
    if (this.config.mcpEnabled && this.config.mcpServers.length > 0) {
      this._mcpRegistry = new McpRegistry();
      const enabledServers = this.config.mcpServers.filter((s) => s.enabled);
      await this._mcpRegistry.init(enabledServers, this.instanceSlug);
    }

    // 2b. Register system tools plugin for cp-system instance (DB-direct, no HTTP proxy)
    if (this.instanceSlug === SYSTEM_INSTANCE_SLUG) {
      registerPlugin("system-tools", systemToolsPlugin);
    }

    // 2c. Register workspace knowledge plugin for every instance — exposes
    //     ws_list_files and ws_search_files so agents can discover user-created
    //     files without those files inflating the system prompt.
    registerPlugin("workspace-knowledge", workspaceKnowledgePlugin);

    // 2d. Initialize all registered plugins — invokes factories, registers hooks.
    //     Without this, plugin tools (e.g. cp_create_instance) are never loaded
    //     into the tool registry and agents silently fall back to the `invalid`
    //     tool when trying to call them.
    await initPlugins({
      instanceSlug: this.instanceSlug,
      workDir: this.workDir,
      version: getRuntimeVersion(),
      db: this.db,
    });
  }

  /** Wire bus subscriptions: plugins, workspace, heartbeat, event persistence, tasks. */
  private _initBusWiring(): void {
    // 3. Wire plugin hooks to bus events
    this._pluginUnsubscribers = wirePluginsToBus(this.instanceSlug);

    // 3a. Subscribe to workspace file changes — invalidate cache + rebuild prompts
    {
      const wsBus = getBus(this.instanceSlug);
      const wsUnsub = wsBus.subscribe(WorkspaceFileChanged, (payload) => {
        invalidateWorkspaceCache(payload.filePath);
        markAllDirty("workspace");
        this.log.debug("[engine] workspace file changed, cache invalidated", {
          agentId: payload.agentId,
          filename: payload.filename,
        });
      });
      this._pluginUnsubscribers.push(wsUnsub);
    }

    // 3a2. For cp-system: invalidate prompt cache when platform state changes
    if (this.instanceSlug === SYSTEM_INSTANCE_SLUG) {
      const sysBus = getBus(this.instanceSlug);
      const sysUnsub = sysBus.subscribe(SystemStateChanged, (payload) => {
        markAllDirty("system-state");
        this.log.debug("[engine] cp-system state changed, prompts invalidated", {
          resource: payload.resource,
          action: payload.action,
        });
      });
      this._pluginUnsubscribers.push(sysUnsub);
    }

    // 3b. Register async subagent result handler
    this._subagentUnsubscribe = registerSubagentCompletedHandler(
      this.db,
      this.instanceSlug,
      this.config,
      this.workDir,
    );

    // 3c. Start heartbeat runner for agents with heartbeat config
    this._stopHeartbeat = startHeartbeatRunner(this.config.agents, {
      db: this.db,
      instanceSlug: this.instanceSlug,
      runtimeConfig: this.config,
      workDir: this.workDir,
    });

    // 3d. Wire event persistence to rt_events table
    this._eventPersistenceUnsub = wireEventPersistence(this.db, this.instanceSlug);

    // 3e. Wire notification emitter (bus → persistent notifications)
    this._notificationEmitterUnsub = wireNotificationEmitter(this.db, this.instanceSlug, (row) =>
      notifyNewNotification(row),
    );

    // 3f. Wire task assignment notifications
    this._taskWiringUnsub = wireTaskNotifications({
      db: this.db,
      instanceSlug: this.instanceSlug,
      config: this.config,
      workDir: this.workDir,
    });
  }

  /** Create and connect channels, start internal API server. */
  private async _initChannelsAndApi(): Promise<void> {
    // 4. Create and connect channels
    this._channels = createChannels(this.config, this.instanceSlug, this.db);
    const messageHandler = this._buildMessageHandler();
    for (const channel of this._channels) {
      channel.onMessage(messageHandler);
      await channel.connect();
    }

    // 4a. Write web-chat port file for dashboard discovery
    if (this.workDir) {
      for (const channel of this._channels) {
        if (channel instanceof WebChatChannel) {
          writePortFile(this.workDir, "webchat", channel.boundPort);
        }
      }
    }

    // 4b. Start internal API server for dashboard IPC
    try {
      this._internalApi = new InternalApiServer({
        port: deriveInternalApiPort(this.instanceSlug),
        token: resolveInternalApiToken(this.instanceSlug),
        slug: this.instanceSlug,
        handlers: this._buildInternalApiHandlers(),
      });
      await this._internalApi.start();

      // Write internal API port file for dashboard discovery
      if (this.workDir) {
        writePortFile(this.workDir, "api", this._internalApi.boundPort);
      }
    } catch (apiErr) {
      // Non-fatal: internal API server may fail to bind in test environments
      // or when multiple runtimes with the same slug hash collide.
      this.log.warn("internal_api_start_skipped", {
        event: "internal_api_start_skipped",
        error: apiErr instanceof Error ? apiErr.message : String(apiErr),
      });
      this._internalApi = undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Stop helpers
  // -------------------------------------------------------------------------

  /** Try to shut down a subsystem, collecting errors instead of throwing. */
  private async _shutdownSubsystem(
    name: string,
    fn: () => Promise<void> | undefined,
    errors: string[],
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Call and clear an optional unsubscribe function stored on this instance. */
  private _clearOptionalUnsub(
    key:
      | "_subagentUnsubscribe"
      | "_stopHeartbeat"
      | "_eventPersistenceUnsub"
      | "_taskWiringUnsub"
      | "_notificationEmitterUnsub",
  ): void {
    const fn = this[key];
    if (fn) {
      fn();
      this[key] = undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private _buildMessageHandler(): (message: InboundMessage) => Promise<void> {
    return async (message: InboundMessage) => {
      try {
        const result = await ChannelRouter.route({
          db: this.db,
          instanceSlug: this.instanceSlug,
          config: this.config,
          message,
          ...(this.workDir !== undefined ? { workDir: this.workDir } : {}),
          ...(this._mcpRegistry !== undefined ? { mcpRegistry: this._mcpRegistry } : {}),
          ...(this.profileResolver !== undefined ? { profileResolver: this.profileResolver } : {}),
        });

        // Send response back through the originating channel
        const channel = this._channels.find((c) => c.type === message.channelType);
        if (channel) {
          await channel.send(result.response);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const bus = getBus(this.instanceSlug);
        const routeStack = err instanceof Error ? err.stack : undefined;
        bus.publish(RuntimeError, {
          slug: this.instanceSlug,
          error: `Message routing failed: ${msg}`,
          ...(routeStack !== undefined ? { stack: routeStack } : {}),
        });
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Internal API handlers (dashboard IPC)
  // ---------------------------------------------------------------------------

  private _buildInternalApiHandlers(): InternalApiHandlers {
    return {
      handleChat: async (body: ChatRequest): Promise<ChatResponse> => {
        // Race the full route vs the first `question.asked` event. When the
        // prompt loop hits a pending question tool, it blocks on the user's
        // answer — waiting for ChannelRouter.route() to resolve would hang
        // HTTP /chat indefinitely and freeze the UI on "sending". Instead we
        // return early with `pendingQuestion: true` so the UI can unblock
        // and render the question card; SSE events continue delivering live
        // updates while the loop remains suspended in the background.
        const bus = getBus(this.instanceSlug);
        let unsubQuestion: (() => void) | undefined;
        const questionAskedPromise = new Promise<{ sessionId: string }>((resolve) => {
          unsubQuestion = bus.subscribe(QuestionAsked, (payload) => {
            resolve({ sessionId: payload.sessionId });
          });
        });

        const routePromise = ChannelRouter.route({
          db: this.db,
          instanceSlug: this.instanceSlug,
          config: this.config,
          message: {
            channelType: "web",
            peerId: "dashboard",
            text: body.message,
          },
          ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
          ...(this.workDir !== undefined ? { workDir: this.workDir } : {}),
          ...(this._mcpRegistry !== undefined ? { mcpRegistry: this._mcpRegistry } : {}),
          ...(this.profileResolver !== undefined ? { profileResolver: this.profileResolver } : {}),
        });

        // Keep the route running in the background if a question wins the race.
        routePromise.catch((err: unknown) => {
          this.log.warn("handle_chat_background_loop_error", {
            error: err instanceof Error ? err.message : String(err),
          });
        });

        const winner = await Promise.race([
          routePromise.then((r) => ({ kind: "route" as const, result: r })),
          questionAskedPromise.then((q) => ({ kind: "question" as const, ...q })),
        ]);

        // Race winner decided — the question subscription is no longer needed.
        unsubQuestion?.();

        if (winner.kind === "question") {
          return {
            sessionId: winner.sessionId,
            messageId: "",
            text: "",
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            costUsd: 0,
            steps: 0,
            pendingQuestion: true,
          };
        }

        const { result } = winner;
        return {
          sessionId: result.sessionId,
          messageId: result.response.text ? result.sessionId : "",
          text: result.response.text,
          tokens: result.tokens,
          costUsd: result.costUsd,
          steps: 1,
        };
      },

      handleWake: (body: WakeRequest): void => {
        const session = getOrCreatePermanentSession(this.db, {
          instanceSlug: this.instanceSlug,
          agentId: body.agentId,
          channel: "internal",
        });
        createUserMessage(this.db, { sessionId: session.id, text: body.messageText });

        // Fire-and-forget prompt loop
        const agentCfg = this.config.agents.find((a) => a.id === body.agentId);
        if (!agentCfg) {
          this.log.warn("internal_api_wake_agent_not_found", { agentId: body.agentId });
          return;
        }
        const resolvedModel = resolveModelForAgent(
          this.db,
          this.instanceSlug,
          agentCfg,
          this.config,
        );

        void runMiddlewarePipeline({
          ctx: {
            db: this.db,
            instanceSlug: this.instanceSlug,
            sessionId: session.id,
            agentConfig: agentCfg,
            message: { text: body.messageText, channelType: "web", peerId: "task-board" },
          },
          runLoop: () =>
            runPromptLoop({
              db: this.db,
              instanceSlug: this.instanceSlug,
              sessionId: session.id,
              userText: body.messageText,
              agentConfig: agentCfg,
              resolvedModel,
              workDir: this.workDir,
              runtimeAgents: this.config.agents.map((a) => ({ id: a.id, name: a.name })),
              runtimeConfig: this.config,
              compactionConfig: this.config.compaction,
              subagentsConfig: this.config.subagents,
              resolveTargetModel: (targetCfg) =>
                resolveModelForAgent(this.db, this.instanceSlug, targetCfg, this.config),
            }),
        }).catch((err: unknown) => {
          this.log.error("internal_api_wake_failed", {
            event: "internal_api_wake_failed",
            agentId: body.agentId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },

      handleFlowRun: (flowId: number, body: FlowRunRequest): number => {
        if (!this._registry) this._registry = new Registry(this.db);
        return startFlowRun(
          {
            db: this.db,
            instanceSlug: this.instanceSlug,
            registry: this._registry,
            config: this.config,
            workDir: this.workDir,
          },
          flowId,
          body.triggerType ?? "manual",
          body.triggerDetail,
        );
      },

      handleQuestionAnswer: (questionId: string, answer: string): boolean => {
        return resolveQuestionFn(questionId, answer);
      },

      handleAbort: (sessionId: string): boolean => {
        const controller = this._abortControllers.get(sessionId);
        if (controller) {
          controller.abort();
          this._abortControllers.delete(sessionId);
          return true;
        }
        return false;
      },
    };
  }

  private _runCleanup(): void {
    const retentionHours = this.config.subagents?.retentionHours ?? 72;

    setImmediate(() => {
      // 1. Cleanup ephemeral sessions
      if (retentionHours > 0) {
        try {
          const result = cleanupEphemeralSessions(this.db, this.instanceSlug, retentionHours);
          if (result.sessionsDeleted > 0) {
            this.log.info("session_cleanup", {
              event: "session_cleanup",
              sessionsDeleted: result.sessionsDeleted,
              messagesDeleted: result.messagesDeleted,
              partsDeleted: result.partsDeleted,
              durationMs: result.durationMs,
            });
          }
        } catch (err) {
          this.log.error("session_cleanup_error", {
            event: "session_cleanup_error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 2. Prune old rt_events (keep 7 days)
      try {
        const eventsDeleted = pruneRtEvents(this.db, this.instanceSlug, 7);
        if (eventsDeleted > 0) {
          this.log.info("rt_events_prune", {
            event: "rt_events_prune",
            eventsDeleted,
          });
        }
      } catch (err) {
        this.log.error("rt_events_prune_error", {
          event: "rt_events_prune_error",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // 3. Budget monthly reset + reconciliation
      try {
        const resets = resetExpiredMonthlyBudgets(this.db, this.instanceSlug);
        if (resets > 0) {
          this.log.info("budget_monthly_reset", {
            event: "budget_monthly_reset",
            budgetsReset: resets,
          });
        }
        const budgets = getBudgetsForInstance(this.db, this.instanceSlug);
        for (const budget of budgets) {
          const { drift, corrected } = reconcileBudget(this.db, budget.id);
          if (corrected) {
            this.log.info("budget_reconciled", {
              event: "budget_reconciled",
              budgetId: budget.id,
              drift: Math.round(drift * 10_000) / 10_000,
            });
          }
        }
      } catch (err) {
        this.log.error("budget_cleanup_error", {
          event: "budget_cleanup_error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  private _setState(next: RuntimeInstanceState): void {
    const previous = this._state;
    this._state = next;

    if (previous !== next) {
      const bus = getBus(this.instanceSlug);
      bus.publish(RuntimeStateChanged, {
        slug: this.instanceSlug,
        state: next,
        previous,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Re-export for convenience
// ---------------------------------------------------------------------------

export type { RuntimeInstanceState };
