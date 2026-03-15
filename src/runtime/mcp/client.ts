/**
 * runtime/mcp/client.ts
 *
 * Wraps a single MCP server connection (stdio or HTTP).
 * Converts MCP tool definitions into claw-runtime Tool.Info objects.
 *
 * V1 scope: tools only (no prompts, no resources, no OAuth).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { RuntimeMcpServerConfig } from "../config/index.js";
import { Tool } from "../tool/tool.js";
import { getDescendants } from "../../lib/process.js";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type McpClientStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string };

/** Callback invoked when the server's tool list changes (ToolListChanged notification). */
export type McpToolsChangedCallback = (serverId: string, toolCount: number) => void;

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 30_000;

/**
 * Manages a single MCP server connection.
 * Call connect() once, then listTools() to get Tool.Info[].
 * Call close() to shut down.
 */
export class McpClient {
  readonly id: string;
  private _client: Client | undefined;
  private _transport: StdioClientTransport | undefined;
  private _status: McpClientStatus = { status: "failed", error: "not connected" };
  /** Last known config — used for reconnection */
  private _config: RuntimeMcpServerConfig | undefined;
  /** Cached tool list — refreshed on ToolListChanged notification */
  private _cachedTools: Tool.Info[] = [];
  /** Optional callback invoked when the tool list changes */
  private _onToolsChanged: McpToolsChangedCallback | undefined;

  constructor(id: string, onToolsChanged?: McpToolsChangedCallback) {
    this.id = id;
    this._onToolsChanged = onToolsChanged;
  }

  get status(): McpClientStatus {
    return this._status;
  }

  get connected(): boolean {
    return this._status.status === "connected";
  }

  /** Expose the stored config (for reconnection from registry) */
  get config(): RuntimeMcpServerConfig | undefined {
    return this._config;
  }

  // -------------------------------------------------------------------------
  // connect
  // -------------------------------------------------------------------------

  async connect(config: RuntimeMcpServerConfig): Promise<McpClientStatus> {
    if (config.enabled === false) {
      this._status = { status: "disabled" };
      return this._status;
    }

    // Store config for reconnection
    this._config = config;

    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    try {
      if (config.type === "local") {
        this._status = await this._connectStdio(config, timeout);
      } else {
        this._status = await this._connectHttp(config, timeout);
      }

      // Register ToolListChanged notification handler after successful connection
      if (this._status.status === "connected" && this._client) {
        this._registerToolListChangedHandler();
      }
    } catch (err) {
      this._status = {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return this._status;
  }

  /**
   * Reconnect using the stored config.
   * Closes the existing connection first, then reconnects.
   */
  async reconnect(): Promise<McpClientStatus> {
    if (!this._config) {
      this._status = { status: "failed", error: "no config stored for reconnection" };
      return this._status;
    }
    await this.close();
    return this.connect(this._config);
  }

  // -------------------------------------------------------------------------
  // listTools — returns Tool.Info[] ready for the tool registry
  // -------------------------------------------------------------------------

  async listTools(): Promise<Tool.Info[]> {
    if (!this._client || this._status.status !== "connected") return [];

    let mcpTools: MCPToolDef[];
    try {
      const result = await this._client.listTools();
      mcpTools = result.tools;
    } catch (err) {
      this._status = {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
      return [];
    }

    this._cachedTools = mcpTools.map((def) => this._convertTool(def));
    return this._cachedTools;
  }

  // -------------------------------------------------------------------------
  // close
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    // Kill tree of child processes (stdio transport only) — best-effort
    if (this._transport) {
      const pid = (this._transport as StdioClientTransport & { pid?: number }).pid;
      if (pid !== undefined) {
        try {
          const descendants = await getDescendants(pid);
          for (const p of [pid, ...descendants]) {
            try {
              process.kill(p, "SIGTERM");
            } catch {
              // Process may already be dead — ignore
            }
          }
        } catch {
          // getDescendants failed — ignore, proceed with close
        }
      }
      this._transport = undefined;
    }

    if (!this._client) {
      this._status = { status: "disabled" };
      return;
    }
    try {
      await this._client.close();
    } catch {
      // ignore close errors
    }
    this._client = undefined;
    this._cachedTools = [];
    this._status = { status: "disabled" };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _connectStdio(
    config: Extract<RuntimeMcpServerConfig, { type: "local" }>,
    timeout: number,
  ): Promise<McpClientStatus> {
    // Support "npx -y @foo/bar" style commands — split on first space
    const parts = config.command.split(" ");
    const cmd = parts[0] ?? config.command;
    const inlineArgs = parts.slice(1);
    const args = [...inlineArgs, ...config.args];

    // Merge process.env (filtering undefined values) with config.env overrides
    const env: Record<string, string> | undefined = config.env
      ? {
          ...(Object.fromEntries(
            Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
          ) as Record<string, string>),
          ...config.env,
        }
      : undefined;

    const transport = new StdioClientTransport({
      command: cmd,
      args,
      stderr: "pipe",
      ...(env !== undefined ? { env } : {}),
    });

    const client = new Client({ name: "claw-runtime", version: "1" });
    await withTimeout(client.connect(transport), timeout);
    this._client = client;
    this._transport = transport; // store for kill tree on close
    return { status: "connected" };
  }

  private async _connectHttp(
    config: Extract<RuntimeMcpServerConfig, { type: "remote" }>,
    timeout: number,
  ): Promise<McpClientStatus> {
    const url = new URL(config.url);
    const requestInit = config.headers ? { headers: config.headers } : undefined;

    // Try StreamableHTTP first, fall back to SSE
    const transports = [
      new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined),
      new SSEClientTransport(url, requestInit ? { requestInit } : undefined),
    ] as const;

    let lastError: Error | undefined;

    for (const transport of transports) {
      try {
        const client = new Client({ name: "claw-runtime", version: "1" });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTimeout(client.connect(transport as any), timeout);
        this._client = client;
        return { status: "connected" };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    return {
      status: "failed",
      error: lastError?.message ?? "connection failed",
    };
  }

  /**
   * Register the ToolListChanged notification handler.
   * When the MCP server signals that its tool list has changed, we refresh
   * the cached tool list and invoke the onToolsChanged callback.
   */
  private _registerToolListChangedHandler(): void {
    if (!this._client) return;
    try {
      // The MCP SDK's setNotificationHandler accepts a Zod schema as first arg.
      // We use a dynamic require to avoid a hard import-time dependency on the schema object.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdkTypes = require("@modelcontextprotocol/sdk/types.js") as Record<string, unknown>;
      const schema = sdkTypes["ToolListChangedNotificationSchema"];
      if (!schema) return; // SDK version doesn't expose this schema — skip

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this._client.setNotificationHandler(schema as any, async () => {
        if (!this._client || this._status.status !== "connected") return;
        try {
          const result = await this._client.listTools();
          this._cachedTools = result.tools.map((def) => this._convertTool(def));
          this._onToolsChanged?.(this.id, this._cachedTools.length);
        } catch {
          // Silently ignore — cached list remains valid
        }
      });
    } catch {
      // setNotificationHandler may not be available in all SDK versions — ignore
    }
  }

  private _convertTool(def: MCPToolDef): Tool.Info {
    const toolId = `${sanitize(this.id)}_${sanitize(def.name)}`;
    const mcpName = def.name;
    const description = def.description ?? `MCP tool ${def.name} (server: ${this.id})`;
    // Keep a reference to `this` for lazy reconnection in execute()
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const mcpClient = this;

    // Use a passthrough record schema — MCP params are validated by the server
    const parameters = z.record(z.string(), z.unknown());

    return Tool.define(toolId, {
      description,
      parameters,
      async execute(params, _ctx): Promise<Tool.Result> {
        // Lazy reconnection: if the client disconnected since tool list was fetched,
        // attempt to reconnect before calling the tool.
        if (!mcpClient.connected && mcpClient.config) {
          try {
            await mcpClient.reconnect();
          } catch (err) {
            throw new Error(
              `MCP server '${mcpClient.id}' is not connected and reconnection failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }

        if (!mcpClient._client) {
          throw new Error(`MCP server '${mcpClient.id}' is not connected`);
        }

        const result = await mcpClient._client.callTool({
          name: mcpName,
          arguments: params as Record<string, unknown>,
        });

        // MCP result.content is an array of content blocks
        const parts = (result.content ?? []) as Array<{ type: string; text?: string }>;
        const output = parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!)
          .join("\n");

        return {
          title: mcpName,
          output: output || "(no output)",
          truncated: false,
        };
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitize a string for use as a tool ID component (only alphanumeric + underscore) */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Promise with a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP connect timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
