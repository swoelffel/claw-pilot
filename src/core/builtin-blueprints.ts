/**
 * core/builtin-blueprints.ts
 *
 * Discovery and loading of built-in team blueprint YAML files
 * shipped in templates/blueprints/.
 *
 * These blueprints are not stored in the DB by default — they are
 * loaded from disk on demand (wizard, dashboard listing).
 * When a user deploys one, it flows through the existing team-import pipeline.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAndValidateTeam } from "./team-import.js";
import type { TeamFile } from "./team-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuiltinBlueprint {
  /** Slug derived from filename (e.g. "dev-harness") */
  slug: string;
  /** Human-readable name (from source field or slug) */
  name: string;
  /** Description (from default agent's meta.notes or generated) */
  description: string;
  /** Number of agents in the blueprint */
  agentCount: number;
  /** Agent names for display */
  agentNames: string[];
  /** Parsed and validated team file, ready for import */
  teamFile: TeamFile;
}

// ---------------------------------------------------------------------------
// Template directory resolution
// ---------------------------------------------------------------------------

function getBlueprintTemplateDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../../templates/blueprints");
}

// ---------------------------------------------------------------------------
// Description helpers
// ---------------------------------------------------------------------------

/** Blueprint descriptions keyed by slug (hardcoded for built-in blueprints). */
const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  "dev-harness":
    "GAN-inspired dev team: Planner decomposes demands, Developer implements, QA validates with feedback loops.",
  "design-studio":
    "Iterative design team: Designer generates interfaces, Critic evaluates with weighted quality criteria.",
  "team-architect":
    "Meta-team that helps design other agent teams: Architect proposes topologies, Validator checks coherence.",
};

function descriptionForSlug(slug: string, team: TeamFile): string {
  return (
    BUILTIN_DESCRIPTIONS[slug] ??
    `Team with ${team.agents.length} agent${team.agents.length > 1 ? "s" : ""}`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all built-in blueprint YAML files from templates/blueprints/.
 * Each file is parsed and validated against TeamFileSchema.
 * Invalid files are silently skipped.
 */
export async function listBuiltinBlueprints(): Promise<BuiltinBlueprint[]> {
  const dir = getBlueprintTemplateDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return []; // templates/blueprints/ does not exist
  }

  const yamlFiles = entries.filter((f) => f.endsWith(".team.yaml")).sort();
  const results: BuiltinBlueprint[] = [];

  for (const filename of yamlFiles) {
    const content = await fs.readFile(path.join(dir, filename), "utf-8");
    const parsed = parseAndValidateTeam(content);
    if (!parsed.success) continue;

    const slug = filename.replace(/\.team\.yaml$/, "");
    const team = parsed.data;

    results.push({
      slug,
      name: formatName(slug),
      description: descriptionForSlug(slug, team),
      agentCount: team.agents.length,
      agentNames: team.agents.map((a) => a.name),
      teamFile: team,
    });
  }
  return results;
}

/**
 * Load a single built-in blueprint by slug.
 * Returns undefined if not found or invalid.
 */
export async function loadBuiltinBlueprint(slug: string): Promise<BuiltinBlueprint | undefined> {
  const all = await listBuiltinBlueprints();
  return all.find((b) => b.slug === slug);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a kebab-case slug to a human-readable title. */
function formatName(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
