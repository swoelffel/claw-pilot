// src/runtime/session/skill-loader.ts
//
// SKILLS-002 — per-agent in-memory cache of DB-backed skills.
// Subscribes to the instance bus and invalidates cache entries on
// skill.* and agent_skill.* events. Consulted by the prompt loop
// alongside (or instead of) the filesystem-based listAvailableSkills
// during the transition window.

import type Database from "better-sqlite3";
import { listSkillsByAgent } from "../../core/repositories/skill-repository.js";
import { getBus } from "../bus/index.js";
import {
  SkillCreated,
  SkillUpdated,
  SkillDeleted,
  SkillFileUpserted,
  SkillFileDeleted,
  AgentSkillAssigned,
  AgentSkillUnassigned,
} from "../bus/events.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A DB-backed skill loaded by SkillLoader for an agent. */
export interface SkillLoaderEntry {
  id: string;
  name: string;
  description: string | null;
  /** Concatenated file content (used for TF-IDF ranking + injection). */
  content: string;
  files: Array<{ path: string; content: string }>;
}

// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------

/**
 * Per-agent in-memory cache of DB-backed skills. Subscribes to the instance
 * bus on construction and invalidates the cache on any skill mutation event:
 * - Per-agent invalidation when the event carries an `agentId`
 *   (`agent_skill.assigned` / `agent_skill.unassigned`).
 * - Full cache flush for all skill content events
 *   (`skill.*`, `skill.file.*`) since they may affect every agent that has
 *   the skill assigned.
 *
 * The loader does NOT own the database — callers must keep `db` alive.
 * `dispose()` must be called to detach the bus subscriptions.
 */
export class SkillLoader {
  private readonly cache = new Map<string, SkillLoaderEntry[]>();
  private readonly db: Database.Database;
  private readonly slug: string;
  private readonly unsubscribes: Array<() => void> = [];

  constructor(db: Database.Database, instanceSlug: string) {
    this.db = db;
    this.slug = instanceSlug;
    const bus = getBus(instanceSlug);

    // Per-agent invalidation events.
    this.unsubscribes.push(
      bus.subscribe(AgentSkillAssigned, (payload) => this.invalidateAgent(payload.agentId)),
      bus.subscribe(AgentSkillUnassigned, (payload) => this.invalidateAgent(payload.agentId)),
    );

    // Skill content events — cannot cheaply map skillId → agentIds without a
    // DB query, so flush the whole cache. Safe because the cache is rebuilt
    // lazily on next access.
    this.unsubscribes.push(
      bus.subscribe(SkillCreated, () => this.invalidateAll("skill.created")),
      bus.subscribe(SkillUpdated, () => this.invalidateAll("skill.updated")),
      bus.subscribe(SkillDeleted, () => this.invalidateAll("skill.deleted")),
      bus.subscribe(SkillFileUpserted, () => this.invalidateAll("skill.file.upserted")),
      bus.subscribe(SkillFileDeleted, () => this.invalidateAll("skill.file.deleted")),
    );
  }

  /** Returns the list of skills assigned to the agent (cached). */
  getEntriesForAgent(agentId: string): SkillLoaderEntry[] {
    const cached = this.cache.get(agentId);
    if (cached) return cached;
    const rows = listSkillsByAgent(this.db, agentId);
    const entries: SkillLoaderEntry[] = rows.map(({ skill, files }) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      content: files.map((f) => `# ${f.path}\n${f.content}`).join("\n\n"),
      files: files.map((f) => ({ path: f.path, content: f.content })),
    }));
    this.cache.set(agentId, entries);
    return entries;
  }

  /** Detach all bus subscriptions and clear the cache. */
  dispose(): void {
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes.length = 0;
    this.cache.clear();
  }

  // --------------------------------------------------------------- private

  private invalidateAgent(agentId: string): void {
    this.cache.delete(agentId);
  }

  private invalidateAll(reason: string): void {
    logger.debug(`[skill-loader:${this.slug}] full invalidation (${reason})`);
    this.cache.clear();
  }
}
