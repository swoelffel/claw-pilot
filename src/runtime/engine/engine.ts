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
import { resolveModel } from "../provider/provider.js";
import {
  RuntimeStarted,
  RuntimeStopped,
  RuntimeStateChanged,
  RuntimeError,
} from "../bus/events.js";
import { initAgentRegistry, resolveEffectivePersistence, getAgent } from "../agent/registry.js";
import { getOrCreatePermanentSession } from "../session/session.js";
import { McpRegistry } from "../mcp/registry.js";
import { ChannelRouter, registerSubagentCompletedHandler } from "../channel/router.js";
import { createChannels } from "./channel-factory.js";
import { wirePluginsToBus } from "./plugin-wiring.js";
import { startHeartbeatRunner } from "../heartbeat/runner.js";
// getRegisteredHooks import removed — routes hook was removed (YAGNI)
import { registerMiddleware, clearMiddlewares } from "../middleware/index.js";
import { guardrailMiddleware } from "../middleware/built-in/guardrail.js";
import { multimodalMiddleware } from "../middleware/built-in/multimodal.js";
import { toolErrorRecoveryMiddleware } from "../middleware/built-in/tool-error-recovery.js";
import { createSuggestionMiddleware } from "../middleware/built-in/suggestions.js";
import { cleanupEphemeralSessions } from "../session/cleanup.js";
import { wireEventPersistence } from "./event-persistence.js";
import { pruneRtEvents } from "../../core/repositories/rt-event-repository.js";
import { logger, type Logger } from "../../lib/logger.js";
import { buildResolvedEnv } from "../../lib/env-reader.js";
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
  private _cleanupTimer: ReturnType<typeof setInterval> | undefined;
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
          }),
        );
      }

      // 2. Init MCP if enabled
      if (this.config.mcpEnabled && this.config.mcpServers.length > 0) {
        this._mcpRegistry = new McpRegistry();
        const enabledServers = this.config.mcpServers.filter((s) => s.enabled);
        await this._mcpRegistry.init(enabledServers, this.instanceSlug);
      }

      // 3. Wire plugin hooks to bus events
      this._pluginUnsubscribers = wirePluginsToBus(this.instanceSlug);

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
        resolveModel: (agentConfig) => {
          const env = this.workDir ? buildResolvedEnv(this.workDir) : undefined;
          const envOpts = env !== undefined ? { env } : {};
          const modelStr = agentConfig.model;
          // Try named alias first
          const alias = this.config.models?.find((a) => a.id === modelStr);
          if (alias) return resolveModel(alias.provider, alias.model, envOpts);
          // Standard "provider/model" format
          const slashIdx = modelStr.indexOf("/");
          if (slashIdx === -1)
            throw new Error(`Invalid model ref "${modelStr}": expected "provider/model" format`);
          return resolveModel(modelStr.slice(0, slashIdx), modelStr.slice(slashIdx + 1), envOpts);
        },
        workDir: this.workDir,
      });

      // 3d. Wire event persistence to rt_events table
      this._eventPersistenceUnsub = wireEventPersistence(this.db, this.instanceSlug);

      // 4. Create and connect channels
      this._channels = createChannels(this.config, this.instanceSlug, this.db);
      const messageHandler = this._buildMessageHandler();
      for (const channel of this._channels) {
        channel.onMessage(messageHandler);
        await channel.connect();
      }

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

    // 1. Disconnect channels
    for (const channel of this._channels) {
      try {
        await channel.disconnect();
      } catch (err) {
        errors.push(
          `channel[${channel.type}]: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this._channels = [];

    // 2. Dispose MCP
    if (this._mcpRegistry) {
      try {
        await this._mcpRegistry.dispose();
      } catch (err) {
        errors.push(`mcp: ${err instanceof Error ? err.message : String(err)}`);
      }
      this._mcpRegistry = undefined;
    }

    // 3. Unsubscribe plugin wiring
    for (const unsub of this._pluginUnsubscribers) {
      unsub();
    }
    this._pluginUnsubscribers = [];

    // 3b. Unsubscribe async subagent result handler
    if (this._subagentUnsubscribe) {
      this._subagentUnsubscribe();
      this._subagentUnsubscribe = undefined;
    }

    // 3c. Stop heartbeat runner
    if (this._stopHeartbeat) {
      this._stopHeartbeat();
      this._stopHeartbeat = undefined;
    }

    // 3d. Unsubscribe event persistence
    if (this._eventPersistenceUnsub) {
      this._eventPersistenceUnsub();
      this._eventPersistenceUnsub = undefined;
    }

    // 3e. Clear middleware registry
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
