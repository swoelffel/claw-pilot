// src/core/skills/_skill-migration.ts
//
// One-shot migration from legacy filesystem-style skills stored in
// `agent_files` into the structured `skills` / `skill_files` / `agent_skills`
// tables. Idempotent: re-running it does not duplicate rows. Non-destructive:
// `agent_files` entries are not deleted (rollback safety per spec §4.2).
//
// Legacy layout: `.opencode/skill/<skill-name>/<rel-path>` (e.g. SKILL.md plus
// any number of referenced tool files). Each `(agent_id, skill-name)` pair
// becomes one skill row scoped to the agent's owning instance.

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { logger } from "../../lib/logger.js";
import { assignSkillToAgent, createSkill } from "../repositories/skill-repository.js";
import { SkillManifestError, parseSkillManifest } from "./_skill-manifest.js";

export interface MigrationReport {
  migrated: number;
  skipped: number;
  errors: Array<{ agentId: string; dir: string; reason: string }>;
}

interface GroupedFile {
  relPath: string;
  content: string;
}

interface SkillGroup {
  agentSlug: string;
  skillName: string;
  instanceSlug: string;
  files: GroupedFile[];
}

const SKILL_DIR_RE = /^\.opencode\/skill\/([^/]+)\/(.+)$/;

export function migrateLegacySkills(db: Database.Database): MigrationReport {
  const report: MigrationReport = { migrated: 0, skipped: 0, errors: [] };

  // Skip cleanly if the legacy table doesn't exist (defensive — should always
  // exist post-v2, but keeps the helper safe for unit tests on bare schemas).
  const hasLegacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_files'")
    .get();
  if (!hasLegacy) {
    return report;
  }

  // `agent_files.agent_id` is an INTEGER FK to `agents.id` — JOIN through
  // `agents` to recover the TEXT slug (agents.agent_id) and through
  // `instances` for the scoping slug.
  const rawRows = db
    .prepare(
      `SELECT a.agent_id    AS agent_slug,
              i.slug        AS instance_slug,
              af.filename   AS filename,
              af.content    AS content
         FROM agent_files af
         INNER JOIN agents a ON a.id = af.agent_id
         INNER JOIN instances i ON i.id = a.instance_id
         WHERE af.filename LIKE '.opencode/skill/%'
           AND af.content IS NOT NULL`,
    )
    .all() as Array<{
    agent_slug: string;
    instance_slug: string;
    filename: string;
    content: string;
  }>;

  // Group by (agent_slug, skill_dir_name).
  const groups = new Map<string, SkillGroup>();
  for (const row of rawRows) {
    const m = SKILL_DIR_RE.exec(row.filename);
    if (!m) continue;
    const skillName = m[1];
    const relPath = m[2];
    if (skillName === undefined || relPath === undefined) continue;
    const key = `${row.agent_slug}::${skillName}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        agentSlug: row.agent_slug,
        skillName,
        instanceSlug: row.instance_slug,
        files: [],
      };
      groups.set(key, group);
    }
    group.files.push({ relPath, content: row.content });
  }

  for (const group of groups.values()) {
    const { agentSlug, skillName, instanceSlug, files } = group;
    const skillMd = files.find((f) => f.relPath === "SKILL.md");
    if (!skillMd) {
      report.skipped++;
      report.errors.push({
        agentId: agentSlug,
        dir: skillName,
        reason: "SKILL.md missing (cannot migrate without manifest)",
      });
      continue;
    }

    // Idempotency: a skill with the same (instance_slug, name) already bound
    // to this agent indicates a previous migration run.
    const existing = db
      .prepare(
        `SELECT s.id FROM skills s
           INNER JOIN agent_skills ax ON ax.skill_id = s.id
          WHERE s.instance_slug = ? AND s.name = ? AND ax.agent_id = ?`,
      )
      .get(instanceSlug, skillName, agentSlug);
    if (existing) continue;

    try {
      const parsed = parseSkillManifest(skillMd.content);
      const id = randomUUID();
      const configJson =
        Object.keys(parsed.extras).length > 0 ? JSON.stringify(parsed.extras) : null;
      createSkill(db, {
        id,
        instanceSlug,
        name: parsed.meta.name,
        description: parsed.meta.description ?? null,
        version: parsed.meta.version ?? null,
        source: "blank", // provenance not preserved for legacy
        configJson,
        files: files.map((f) => ({ path: f.relPath, content: f.content })),
      });
      assignSkillToAgent(db, id, agentSlug);
      report.migrated++;
    } catch (err) {
      report.skipped++;
      report.errors.push({
        agentId: agentSlug,
        dir: skillName,
        reason: err instanceof SkillManifestError ? err.message : String(err),
      });
    }
  }

  writeAuditEvent(db, report);
  logger.info("[skills-migration] complete", {
    migrated: report.migrated,
    skipped: report.skipped,
    errors: report.errors.length,
  });
  return report;
}

function writeAuditEvent(db: Database.Database, report: MigrationReport): void {
  const hasAudit = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rt_audit_events'")
    .get();
  if (!hasAudit) return;
  try {
    db.prepare(
      `INSERT INTO rt_audit_events (kind, timestamp, server_id, payload)
         VALUES ('skills_migration', datetime('now'), 'local', ?)`,
    ).run(JSON.stringify(report));
  } catch (err) {
    logger.warn("[skills-migration] audit insert skipped", { error: String(err) });
  }
}
