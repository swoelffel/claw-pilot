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

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type McpClientStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string };

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
  private _status: McpClientStatus = { status: "failed", error: "not connected" };

  constructor(id: string) {
    this.id = id;
  }

  get status(): McpClientStatus {
    return this._status;
  }

  // -------------------------------------------------------------------------
  // connect
  // -------------------------------------------------------------------------

  async connect(config: RuntimeMcpServerConfig): Promise<McpClientStatus> {
    if (config.enabled === false) {
      this._status = { status: "disabled" };
      return this._status;
    }

    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    try {
      if (config.type === "local") {
        this._status = await this._connectStdio(config, timeout);
      } else {
        this._status = await this._connectHttp(config, timeout);
      }
    } catch (err) {
      this._status = {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return this._status;
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

    return mcpTools.map((def) => this._convertTool(def));
  }

  // -------------------------------------------------------------------------
  // close
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    if (!this._client) return;
    try {
      await this._client.close();
    } catch {
      // ignore close errors
    }
    this._client = undefined;
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

  private _convertTool(def: MCPToolDef): Tool.Info {
    const toolId = `${sanitize(this.id)}_${sanitize(def.name)}`;
    const client = this._client!;
    const mcpName = def.name;
    const description = def.description ?? `MCP tool ${def.name} (server: ${this.id})`;

    // Use a passthrough record schema — MCP params are validated by the server
    const parameters = z.record(z.string(), z.unknown());

    return Tool.define(toolId, {
      description,
      parameters,
      async execute(params, _ctx): Promise<Tool.Result> {
        const result = await client.callTool({
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
