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
  MultiEditTool,
} from "./built-in/index.js";
import type { McpRegistry } from "../mcp/index.js";
import { getRegisteredHooks } from "../plugin/hooks.js";
import type { PluginInput } from "../plugin/types.js";

// ---------------------------------------------------------------------------
// Tool profiles
// ---------------------------------------------------------------------------

export const TOOL_PROFILES: Record<string, string[]> = {
  minimal: ["question"],
  messaging: ["question", "webfetch"],
  coding: [
    "read",
    "write",
    "edit",
    "multiedit",
    "bash",
    "glob",
    "grep",
    "webfetch",
    "question",
    "todowrite",
    "todoread",
    "skill",
  ],
  full: [
    "read",
    "write",
    "edit",
    "multiedit",
    "bash",
    "glob",
    "grep",
    "webfetch",
    "question",
    "todowrite",
    "todoread",
    "skill",
    "task",
  ],
};

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
  MultiEditTool,
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
  /** Tool profile to apply (filters built-in tools) */
  toolProfile?: string;
  /** Additional tool IDs to include beyond the profile */
  alsoAllow?: string[];
  /** Plugin input — if provided, plugin-declared tools are appended to the list */
  pluginInput?: PluginInput;
}

/**
 * Return the list of available tools for an agent.
 * Combines built-ins + custom tools loaded from customToolsDir (if provided).
 * Applies toolProfile filter if specified.
 */
export async function getTools(options?: ToolRegistryOptions): Promise<Tool.Info[]> {
  let tools: Tool.Info[] = [...BUILTIN_TOOLS];

  // Apply tool profile filter
  if (options?.toolProfile && TOOL_PROFILES[options.toolProfile]) {
    const allowed = new Set(TOOL_PROFILES[options.toolProfile]);
    tools = tools.filter((t) => allowed.has(t.id));
  }

  // Add extra allowed tools (beyond profile)
  if (options?.alsoAllow && options.alsoAllow.length > 0) {
    const extraIds = new Set(options.alsoAllow);
    const extra = BUILTIN_TOOLS.filter(
      (t) => extraIds.has(t.id) && !tools.find((e) => e.id === t.id),
    );
    tools = [...tools, ...extra];
  }

  if (options?.customToolsDir) {
    const custom = await loadCustomTools(options.customToolsDir);
    tools.push(...custom);
  }

  if (options?.mcpRegistry) {
    const mcpTools = await options.mcpRegistry.getTools();
    tools.push(...mcpTools);
  }

  // Append tools declared by plugins (after built-in and MCP tools)
  if (options?.pluginInput) {
    const hooks = getRegisteredHooks();
    for (const hook of hooks) {
      if (hook.tools) {
        try {
          const pluginTools = await hook.tools(options.pluginInput);
          for (const tool of pluginTools) {
            // Deduplication: do not overwrite existing tools
            if (!tools.find((t) => t.id === tool.id)) {
              tools.push(tool);
            } else {
              console.warn(
                `[claw-runtime] Plugin tool '${tool.id}' conflicts with existing tool — skipped`,
              );
            }
          }
        } catch (err) {
          console.warn("[claw-runtime] Plugin hook tools threw:", err);
        }
      }
    }
  }

  if (options?.exclude && options.exclude.length > 0) {
    const excluded = new Set(options.exclude);
    return tools.filter((t) => !excluded.has(t.id));
  }

  return tools;
}

/**
 * Returns the tools available for an agent based on its profile and kind.
 * Subagents (kind: "subagent") never have access to the task tool,
 * regardless of their configured toolProfile.
 *
 * This is a thin wrapper over getTools() that enforces the hard rule:
 * subagents cannot spawn — the task tool is always removed for them.
 */
export async function getToolsForAgent(
  options: ToolRegistryOptions & { agentKind?: "primary" | "subagent" },
): Promise<Tool.Info[]> {
  const { agentKind, ...toolOptions } = options;
  const tools = await getTools(toolOptions);

  if (agentKind === "subagent") {
    // Hard rule: subagents can never spawn — remove task tool
    return tools.filter((t) => t.id !== "task");
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
 * @public
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
