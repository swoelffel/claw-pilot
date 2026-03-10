// src/lib/workspace-templates.ts
// Shared helper for loading and applying workspace file templates.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Template directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to the templates/workspace/ directory.
 * Works both in dev (src/) and prod (dist/) layouts.
 */
export function getTemplateDir(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../templates/workspace",
  );
}

// ---------------------------------------------------------------------------
// Template substitution
// ---------------------------------------------------------------------------

export interface TemplateVars {
  agentId: string;
  agentName: string;
  instanceSlug?: string;
  instanceName?: string;
  date?: string;
  agents?: Array<{ id: string; name: string }>;
}

/**
 * Apply simple template substitutions to a workspace file content string.
 * Handles {{agentId}}, {{agentName}}, {{instanceSlug}}, {{instanceName}},
 * {{date}}, and {{#each agents}}...{{/each}} blocks.
 */
export function applyTemplateVars(content: string, vars: TemplateVars): string {
  const date = vars.date ?? new Date().toISOString().split("T")[0]!;

  let result = content
    .replace(/\{\{agentId\}\}/g, vars.agentId)
    .replace(/\{\{agentName\}\}/g, vars.agentName)
    .replace(/\{\{instanceSlug\}\}/g, vars.instanceSlug ?? "blueprint")
    .replace(/\{\{instanceName\}\}/g, vars.instanceName ?? "Blueprint")
    .replace(/\{\{date\}\}/g, date);

  if (vars.agents && vars.agents.length > 0) {
    result = result.replace(
      /\{\{#each agents\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (_match, capturedBlock: string) =>
        vars.agents!
          .map((a) =>
            capturedBlock
              .replace(/\{\{this\.id\}\}/g, a.id)
              .replace(/\{\{this\.name\}\}/g, a.name),
          )
          .join(""),
    );
  } else {
    // Strip {{#each agents}}...{{/each}} blocks when no agents list
    result = result.replace(/\{\{#each agents\}\}[\s\S]*?\{\{\/each\}\}/g, "");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Template loading
// ---------------------------------------------------------------------------

/**
 * Load a single workspace template file from disk and apply substitutions.
 * Returns the processed content, or a minimal fallback if the template is missing.
 */
export async function loadWorkspaceTemplate(
  filename: string,
  vars: TemplateVars,
  templateDir?: string,
): Promise<string> {
  const dir = templateDir ?? getTemplateDir();
  let content: string;
  try {
    content = await fs.readFile(path.join(dir, filename), "utf-8");
  } catch {
    content = `# ${filename}\n`;
  }
  return applyTemplateVars(content, vars);
}
