// src/core/repositories/skill-repository.ts
//
// CRUD on the three SKILLS-002 tables (`skills`, `skill_files`, `agent_skills`).
// All writes update `skills.updated_at` and recompute `skill_files.hash`
// (sha256). Pure functions taking a better-sqlite3 Database — follows the
// convention of sibling repositories in this directory.

import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed UTF-8 byte length for a single skill file (1 MB). */
export const SKILL_FILE_MAX_BYTES = 1_048_576;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillRow {
  id: string;
  instance_slug: string;
  name: string;
  description: string | null;
  version: string | null;
  source: string | null;
  source_url: string | null;
  config_json: string | null;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillFileRow {
  id: number;
  skill_id: string;
  path: string;
  content: string;
  hash: string;
}

export interface SkillSummary {
  id: string;
  instanceSlug: string;
  name: string;
  description: string | null;
  version: string | null;
  source: string | null;
  sourceUrl: string | null;
  fileCount: number;
  agentCount: number;
  updatedAt: string;
}

export interface CreateSkillInput {
  id: string;
  instanceSlug: string;
  name: string;
  description?: string | null;
  version?: string | null;
  source?: "blank" | "zip" | "github" | null;
  sourceUrl?: string | null;
  configJson?: string | null;
  files: Array<{ path: string; content: string }>;
}

export interface UpdateSkillMetaInput {
  name?: string;
  description?: string | null;
  version?: string | null;
  configJson?: string | null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function assertFileSize(filePath: string, content: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > SKILL_FILE_MAX_BYTES) {
    throw new Error(
      `Skill file "${filePath}" is too large (${bytes} bytes, max 1 MB / ${SKILL_FILE_MAX_BYTES} bytes)`,
    );
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function touchSkill(db: Database.Database, skillId: string): void {
  db.prepare("UPDATE skills SET updated_at = datetime('now') WHERE id = ?").run(skillId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Insert a new skill row plus its initial files in a single transaction.
 * Each file's content is hashed (sha256) and size-checked against 1 MB.
 */
export function createSkill(db: Database.Database, input: CreateSkillInput): SkillRow {
  for (const f of input.files) {
    assertFileSize(f.path, f.content);
  }

  const insertSkill = db.prepare(
    `INSERT INTO skills (id, instance_slug, name, description, version, source, source_url, config_json)
     VALUES (@id, @instance_slug, @name, @description, @version, @source, @source_url, @config_json)`,
  );
  const insertFile = db.prepare(
    `INSERT INTO skill_files (skill_id, path, content, hash)
     VALUES (?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    insertSkill.run({
      id: input.id,
      instance_slug: input.instanceSlug,
      name: input.name,
      description: input.description ?? null,
      version: input.version ?? null,
      source: input.source ?? null,
      source_url: input.sourceUrl ?? null,
      config_json: input.configJson ?? null,
    });
    for (const f of input.files) {
      insertFile.run(input.id, f.path, f.content, sha256(f.content));
    }
  });
  tx();

  const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(input.id) as SkillRow;
  return row;
}

/**
 * Fetch a single skill with all its files (ordered by path).
 * Returns null if the skill id is unknown.
 */
export function getSkillWithFiles(
  db: Database.Database,
  skillId: string,
): { skill: SkillRow; files: SkillFileRow[] } | null {
  const skill = db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId) as
    | SkillRow
    | undefined;
  if (!skill) return null;
  const files = db
    .prepare("SELECT * FROM skill_files WHERE skill_id = ? ORDER BY path")
    .all(skillId) as SkillFileRow[];
  return { skill, files };
}

/**
 * List every skill belonging to an instance, with denormalised file/agent
 * counts so the dashboard list view can render without an N+1.
 */
export function listSkillsByInstance(db: Database.Database, instanceSlug: string): SkillSummary[] {
  const rows = db
    .prepare(
      `SELECT
         s.id, s.instance_slug, s.name, s.description, s.version, s.source, s.source_url,
         s.updated_at,
         (SELECT COUNT(*) FROM skill_files WHERE skill_id = s.id) AS file_count,
         (SELECT COUNT(*) FROM agent_skills WHERE skill_id = s.id) AS agent_count
       FROM skills s
       WHERE s.instance_slug = ?
       ORDER BY s.name`,
    )
    .all(instanceSlug) as Array<{
    id: string;
    instance_slug: string;
    name: string;
    description: string | null;
    version: string | null;
    source: string | null;
    source_url: string | null;
    updated_at: string;
    file_count: number;
    agent_count: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    instanceSlug: r.instance_slug,
    name: r.name,
    description: r.description,
    version: r.version,
    source: r.source,
    sourceUrl: r.source_url,
    fileCount: r.file_count,
    agentCount: r.agent_count,
    updatedAt: r.updated_at,
  }));
}

/**
 * Update metadata fields on a skill (name, description, version, configJson).
 * Builds the SET clause dynamically and bumps `updated_at` when any field
 * actually changes. Returns the updated row or null if the id is unknown.
 */
export function updateSkillMeta(
  db: Database.Database,
  skillId: string,
  patch: UpdateSkillMetaInput,
): SkillRow | null {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: skillId };

  if (patch.name !== undefined) {
    sets.push("name = @name");
    params.name = patch.name;
  }
  if (patch.description !== undefined) {
    sets.push("description = @description");
    params.description = patch.description;
  }
  if (patch.version !== undefined) {
    sets.push("version = @version");
    params.version = patch.version;
  }
  if (patch.configJson !== undefined) {
    sets.push("config_json = @config_json");
    params.config_json = patch.configJson;
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE skills SET ${sets.join(", ")} WHERE id = @id`).run(params);
  }

  const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId) as SkillRow | undefined;
  return row ?? null;
}

/**
 * Insert or update a single file by `(skill_id, path)`. Recomputes the sha256
 * hash and touches the parent skill's `updated_at`.
 */
export function upsertSkillFile(
  db: Database.Database,
  skillId: string,
  filePath: string,
  content: string,
): SkillFileRow {
  assertFileSize(filePath, content);
  const hash = sha256(content);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO skill_files (skill_id, path, content, hash)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(skill_id, path) DO UPDATE SET
         content = excluded.content,
         hash    = excluded.hash`,
    ).run(skillId, filePath, content, hash);
    touchSkill(db, skillId);
  });
  tx();

  const row = db
    .prepare("SELECT * FROM skill_files WHERE skill_id = ? AND path = ?")
    .get(skillId, filePath) as SkillFileRow;
  return row;
}

/**
 * Remove a single file from a skill. Touches the parent skill's `updated_at`.
 */
export function deleteSkillFile(db: Database.Database, skillId: string, filePath: string): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM skill_files WHERE skill_id = ? AND path = ?").run(skillId, filePath);
    touchSkill(db, skillId);
  });
  tx();
}

/**
 * Delete a skill. `skill_files` and `agent_skills` cascade via foreign keys.
 */
export function deleteSkill(db: Database.Database, skillId: string): void {
  db.prepare("DELETE FROM skills WHERE id = ?").run(skillId);
}

/**
 * Bind a skill to an agent (idempotent — re-assigning is a no-op).
 */
export function assignSkillToAgent(db: Database.Database, skillId: string, agentId: string): void {
  db.prepare("INSERT OR IGNORE INTO agent_skills (agent_id, skill_id) VALUES (?, ?)").run(
    agentId,
    skillId,
  );
}

/**
 * Remove the binding between a skill and an agent. No-op if absent.
 */
export function unassignSkillFromAgent(
  db: Database.Database,
  skillId: string,
  agentId: string,
): void {
  db.prepare("DELETE FROM agent_skills WHERE agent_id = ? AND skill_id = ?").run(agentId, skillId);
}

/**
 * Return every skill assigned to the given agent, each with its full file set.
 */
export function listSkillsByAgent(
  db: Database.Database,
  agentId: string,
): Array<{ skill: SkillRow; files: SkillFileRow[] }> {
  const skills = db
    .prepare(
      `SELECT s.*
       FROM skills s
       INNER JOIN agent_skills a ON a.skill_id = s.id
       WHERE a.agent_id = ?
       ORDER BY s.name`,
    )
    .all(agentId) as SkillRow[];

  return skills.map((skill) => {
    const files = db
      .prepare("SELECT * FROM skill_files WHERE skill_id = ? ORDER BY path")
      .all(skill.id) as SkillFileRow[];
    return { skill, files };
  });
}

/**
 * Return every agent_id bound to a given skill.
 */
export function listAgentsForSkill(db: Database.Database, skillId: string): string[] {
  const rows = db
    .prepare("SELECT agent_id FROM agent_skills WHERE skill_id = ? ORDER BY agent_id")
    .all(skillId) as Array<{ agent_id: string }>;
  return rows.map((r) => r.agent_id);
}
