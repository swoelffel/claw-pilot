/**
 * runtime/mcp/registry.ts
 *
 * Manages multiple MCP server connections for a single runtime instance.
 * Aggregates tools from all connected servers into a flat list.
 */

import type { RuntimeMcpServerConfig } from "../config/index.js";
import { Tool } from "../tool/tool.js";
import { McpClient, type McpClientStatus } from "./client.js";

// ---------------------------------------------------------------------------
// McpRegistry
// ---------------------------------------------------------------------------

export interface McpRegistryStatus {
  [serverId: string]: McpClientStatus;
}

/**
 * Registry of MCP clients for one runtime instance.
 *
 * Usage:
 *   const registry = new McpRegistry();
 *   await registry.init(config.mcpServers);
 *   const tools = await registry.getTools();
 *   // ... use tools ...
 *   await registry.dispose();
 */
export class McpRegistry {
  private _clients: Map<string, McpClient> = new Map();

  // -------------------------------------------------------------------------
  // init — connect all enabled servers in parallel
  // -------------------------------------------------------------------------

  async init(servers: RuntimeMcpServerConfig[]): Promise<McpRegistryStatus> {
    // Close any existing clients first (re-init support)
    await this.dispose();

    const results = await Promise.all(
      servers.map(async (cfg) => {
        const client = new McpClient(cfg.id);
        this._clients.set(cfg.id, client);
        const status = await client.connect(cfg);
        return { id: cfg.id, status };
      }),
    );

    const statusMap: McpRegistryStatus = {};
    for (const { id, status } of results) {
      statusMap[id] = status;
    }
    return statusMap;
  }

  // -------------------------------------------------------------------------
  // getTools — aggregate tools from all connected clients
  // -------------------------------------------------------------------------

  async getTools(): Promise<Tool.Info[]> {
    const toolLists = await Promise.all(
      Array.from(this._clients.values()).map((client) => client.listTools()),
    );
    return toolLists.flat();
  }

  // -------------------------------------------------------------------------
  // status — snapshot of all client statuses
  // -------------------------------------------------------------------------

  getStatus(): McpRegistryStatus {
    const result: McpRegistryStatus = {};
    for (const [id, client] of this._clients) {
      result[id] = client.status;
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // getClient — access a specific client by server ID
  // -------------------------------------------------------------------------

  getClient(serverId: string): McpClient | undefined {
    return this._clients.get(serverId);
  }

  // -------------------------------------------------------------------------
  // dispose — close all connections
  // -------------------------------------------------------------------------

  async dispose(): Promise<void> {
    await Promise.all(Array.from(this._clients.values()).map((c) => c.close()));
    this._clients.clear();
  }
}
