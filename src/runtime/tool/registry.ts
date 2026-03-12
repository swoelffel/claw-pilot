/**
 * runtime/tool/registry.ts
 *
 * Tool registry — built-in tools + optional custom tools loaded from a directory.
 *
 * Phase 1: built-in tools are functional stubs (validate args, return placeholder).
 * Full implementations are in Phase 2.
 */

import { z } from "zod";
import { Tool } from "./tool.js";

// ---------------------------------------------------------------------------
// Built-in tool stubs
// ---------------------------------------------------------------------------

function makeStub(toolId: string, parameters: z.ZodType): Tool.Info {
  return Tool.define(toolId, {
    description: `[stub] ${toolId} — not yet implemented`,
    parameters,
    async execute(args) {
      return {
        title: `${toolId}: ${JSON.stringify(args)}`,
        output: `[stub] Tool "${toolId}" not yet implemented`,
        truncated: false,
      };
    },
  });
}

const BUILTIN_TOOLS: Tool.Info[] = [
  makeStub("read", z.object({ path: z.string() })),
  makeStub("write", z.object({ path: z.string(), content: z.string() })),
  makeStub(
    "bash",
    z.object({
      command: z.string(),
      timeout: z.number().optional(),
    }),
  ),
  makeStub(
    "glob",
    z.object({
      pattern: z.string(),
      cwd: z.string().optional(),
    }),
  ),
  makeStub(
    "grep",
    z.object({
      pattern: z.string(),
      path: z.string().optional(),
    }),
  ),
];

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

export interface ToolRegistryOptions {
  /** Directory to scan for custom tools (*.js / *.ts files) */
  customToolsDir?: string;
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

  return tools;
}

/**
 * Return only the built-in tools (no custom tools).
 */
export function getBuiltinTools(): Tool.Info[] {
  return [...BUILTIN_TOOLS];
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
      // Log warning but don't crash — custom tool loading is best-effort
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
