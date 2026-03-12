/**
 * runtime/tool/registry.ts
 *
 * Tool registry — built-in tools + optional custom tools loaded from a directory.
 *
 * Phase 2: built-in tools are fully implemented in ./built-in/.
 */

import { Tool } from "./tool.js";
import {
  ReadTool,
  WriteTool,
  EditTool,
  BashTool,
  GlobTool,
  GrepTool,
  WebFetchTool,
  QuestionTool,
  TodoWriteTool,
  TodoReadTool,
  SkillTool,
} from "./built-in/index.js";
import type { McpRegistry } from "../mcp/index.js";

// ---------------------------------------------------------------------------
// Built-in tools
// ---------------------------------------------------------------------------

const BUILTIN_TOOLS: Tool.Info[] = [
  ReadTool,
  WriteTool,
  EditTool,
  BashTool,
  GlobTool,
  GrepTool,
  WebFetchTool,
  QuestionTool,
  TodoWriteTool,
  TodoReadTool,
  SkillTool,
];

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

export interface ToolRegistryOptions {
  /** Directory to scan for custom tools (*.js / *.ts files) */
  customToolsDir?: string;
  /** Tool IDs to exclude (e.g. based on agent permissions) */
  exclude?: string[];
  /** MCP registry — if provided, MCP tools are appended to the list */
  mcpRegistry?: McpRegistry;
}

/**
 * Return the list of available tools for an agent.
 * Combines built-ins + custom tools loaded from customToolsDir (if provided).
 */
export async function getTools(options?: ToolRegistryOptions): Promise<Tool.Info[]> {
  const tools: Tool.Info[] = [...BUILTIN_TOOLS];

  if (options?.customToolsDir) {
    const custom = await loadCustomTools(options.customToolsDir);
    tools.push(...custom);
  }

  if (options?.mcpRegistry) {
    const mcpTools = await options.mcpRegistry.getTools();
    tools.push(...mcpTools);
  }

  if (options?.exclude && options.exclude.length > 0) {
    const excluded = new Set(options.exclude);
    return tools.filter((t) => !excluded.has(t.id));
  }

  return tools;
}

/**
 * Return only the built-in tools (no custom tools).
 */
export function getBuiltinTools(): Tool.Info[] {
  return [...BUILTIN_TOOLS];
}

/**
 * Get a single built-in tool by ID.
 */
export function getBuiltinTool(id: string): Tool.Info | undefined {
  return BUILTIN_TOOLS.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Custom tool loader
// ---------------------------------------------------------------------------

async function loadCustomTools(dir: string): Promise<Tool.Info[]> {
  const { existsSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  if (!existsSync(dir)) return [];

  const tools: Tool.Info[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.endsWith(".js") && !entry.endsWith(".ts")) continue;

    const filePath = join(dir, entry);
    try {
      const mod = (await import(pathToFileURL(filePath).href)) as Record<string, unknown>;
      for (const exported of Object.values(mod)) {
        if (isToolInfo(exported)) {
          tools.push(exported);
        }
      }
    } catch (err) {
      console.warn(`[claw-runtime] Failed to load custom tool from ${filePath}:`, err);
    }
  }

  return tools;
}

function isToolInfo(value: unknown): value is Tool.Info {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Tool.Info).id === "string" &&
    typeof (value as Tool.Info).init === "function"
  );
}
