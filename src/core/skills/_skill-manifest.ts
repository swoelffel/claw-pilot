// src/core/skills/_skill-manifest.ts
//
// Parse and validate the YAML frontmatter of a skill's SKILL.md.
// Known fields land on `meta`; unknown keys are preserved in `extras`
// and persisted in skills.config_json (extension without migration).

import { parse as parseYaml } from "yaml";
import { z } from "zod";

export class SkillManifestError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SkillManifestError";
    this.code = code;
  }
}

export const SkillFrontmatterSchema = z
  .object({
    name: z.string().min(1).max(64),
    description: z.string().max(500).optional(),
    version: z.string().max(64).optional(),
    tags: z.array(z.string().max(64)).optional(),
  })
  .passthrough();

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface ParsedManifest {
  meta: {
    name: string;
    description?: string;
    version?: string;
    tags?: string[];
  };
  extras: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillManifest(skillMd: string): ParsedManifest {
  const match = FRONTMATTER_RE.exec(skillMd);
  if (!match) {
    throw new SkillManifestError(
      "SKILL.md must start with a YAML frontmatter block delimited by '---'",
      "MANIFEST_MISSING",
    );
  }

  const yamlBlock = match[1] ?? "";
  const body = match[2] ?? "";

  let raw: unknown;
  try {
    raw = parseYaml(yamlBlock);
  } catch (err) {
    throw new SkillManifestError(`Frontmatter is not valid YAML: ${String(err)}`, "MANIFEST_YAML");
  }

  if (typeof raw !== "object" || raw === null) {
    throw new SkillManifestError("Frontmatter must be a YAML mapping", "MANIFEST_SHAPE");
  }

  const parsed = SkillFrontmatterSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SkillManifestError(
      `Frontmatter validation failed: ${parsed.error.message}`,
      "MANIFEST_INVALID",
    );
  }

  const { name, description, version, tags, ...extras } = parsed.data;
  return {
    meta: {
      name,
      ...(description !== undefined ? { description } : {}),
      ...(version !== undefined ? { version } : {}),
      ...(tags !== undefined ? { tags } : {}),
    },
    extras,
    body,
  };
}
