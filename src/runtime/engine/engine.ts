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
import type { Hono } from "hono";
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
} from "../bus/events.js";
import { initAgentRegistry } from "../agent/registry.js";
import { McpRegistry } from "../mcp/registry.js";
import { ChannelRouter, registerSubagentCompletedHandler } from "../channel/router.js";
import { createChannels } from "./channel-factory.js";
import { wirePluginsToBus } from "./plugin-wiring.js";
import { startHeartbeatRunner } from "../heartbeat/runner.js";
import { getRegisteredHooks } from "../plugin/hooks.js";

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
  private _error: string | undefined;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly db: Database.Database,
    private readonly instanceSlug: InstanceSlug,
  ) {}

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
      );

      // 3c. Start heartbeat runner for agents with heartbeat config
      this._stopHeartbeat = startHeartbeatRunner(this.config.agents, {
        db: this.db,
        instanceSlug: this.instanceSlug,
        resolveModel: (_agent) => {
          // Minimal resolver: use the agent's model string directly
          // The full resolver is in the channel router — here we just need a basic one
          // This will be improved when the provider registry is accessible from the engine
          throw new Error(
            "HeartbeatRunner.resolveModel not yet wired — use heartbeat.model override",
          );
        },
        workDir: undefined,
      });

      // 4. Create and connect channels
      this._channels = createChannels(this.config, this.instanceSlug);
      const messageHandler = this._buildMessageHandler();
      for (const channel of this._channels) {
        channel.onMessage(messageHandler);
        await channel.connect();
      }

      this._setState("running");

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

    this._setState("stopped");

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
   * Register plugin routes on the given Hono app.
   * Must be called after initPlugins() and before start().
   * Plugins can use this to expose additional HTTP endpoints.
   */
  registerPluginRoutes(app: Hono): void {
    const hooks = getRegisteredHooks();
    for (const hook of hooks) {
      if (hook.routes) {
        try {
          hook.routes(app);
        } catch (err) {
          console.warn("[claw-runtime] Plugin hook routes threw:", err);
        }
      }
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
          ...(this._mcpRegistry !== undefined ? { mcpRegistry: this._mcpRegistry } : {}),
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
