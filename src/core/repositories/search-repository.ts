// src/core/repositories/search-repository.ts
//
// Repository for the global search index — FTS5-backed cross-entity search.

import type Database from "better-sqlite3";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchEntityType = "instance" | "agent" | "task" | "blueprint" | "agent_blueprint";

export interface SearchEntry {
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  subtitle: string;
  routeHash: string;
}

export interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  route: string;
  rank: number;
}

// ---------------------------------------------------------------------------
// Upsert / Remove
// ---------------------------------------------------------------------------

/** Insert or update a single entity in the search index. */
export function upsertSearchEntry(db: Database.Database, entry: SearchEntry): void {
  // 1. Check if entry already exists in the map
  const existing = db
    .prepare(
      "SELECT fts_rowid, title, subtitle, route_hash FROM search_index_map WHERE entity_type = ? AND entity_id = ?",
    )
    .get(entry.entityType, entry.entityId) as
    | { fts_rowid: number; title: string; subtitle: string; route_hash: string }
    | undefined;

  if (existing) {
    // 2. Delete old FTS5 row (contentless requires exact original values)
    db.prepare(
      `INSERT INTO search_index(search_index, rowid, entity_type, entity_id, title, subtitle, route_hash)
       VALUES('delete', ?, ?, ?, ?, ?, ?)`,
    ).run(
      existing.fts_rowid,
      entry.entityType,
      entry.entityId,
      existing.title,
      existing.subtitle,
      existing.route_hash,
    );

    // 3. Insert new FTS5 row
    const result = db
      .prepare(
        `INSERT INTO search_index(entity_type, entity_id, title, subtitle, route_hash)
         VALUES(?, ?, ?, ?, ?)`,
      )
      .run(entry.entityType, entry.entityId, entry.title, entry.subtitle, entry.routeHash);

    // 4. Update map
    db.prepare(
      `UPDATE search_index_map SET fts_rowid = ?, title = ?, subtitle = ?, route_hash = ?
       WHERE entity_type = ? AND entity_id = ?`,
    ).run(
      result.lastInsertRowid,
      entry.title,
      entry.subtitle,
      entry.routeHash,
      entry.entityType,
      entry.entityId,
    );
  } else {
    // Insert new FTS5 row
    const result = db
      .prepare(
        `INSERT INTO search_index(entity_type, entity_id, title, subtitle, route_hash)
         VALUES(?, ?, ?, ?, ?)`,
      )
      .run(entry.entityType, entry.entityId, entry.title, entry.subtitle, entry.routeHash);

    // Insert into map
    db.prepare(
      `INSERT INTO search_index_map(entity_type, entity_id, fts_rowid, title, subtitle, route_hash)
       VALUES(?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.entityType,
      entry.entityId,
      result.lastInsertRowid,
      entry.title,
      entry.subtitle,
      entry.routeHash,
    );
  }
}

/** Remove an entity from the search index. */
export function removeSearchEntry(
  db: Database.Database,
  entityType: SearchEntityType,
  entityId: string,
): void {
  const existing = db
    .prepare(
      "SELECT fts_rowid, title, subtitle, route_hash FROM search_index_map WHERE entity_type = ? AND entity_id = ?",
    )
    .get(entityType, entityId) as
    | { fts_rowid: number; title: string; subtitle: string; route_hash: string }
    | undefined;

  if (!existing) return;

  // Delete from FTS5 (contentless requires exact original values)
  db.prepare(
    `INSERT INTO search_index(search_index, rowid, entity_type, entity_id, title, subtitle, route_hash)
     VALUES('delete', ?, ?, ?, ?, ?, ?)`,
  ).run(
    existing.fts_rowid,
    entityType,
    entityId,
    existing.title,
    existing.subtitle,
    existing.route_hash,
  );

  // Delete from map
  db.prepare("DELETE FROM search_index_map WHERE entity_type = ? AND entity_id = ?").run(
    entityType,
    entityId,
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Sanitize a user query for FTS5 prefix matching. */
function sanitizeQuery(raw: string): string {
  // Split on whitespace, escape FTS5 special chars, suffix each token with *
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => {
      // Remove FTS5 special characters
      const escaped = t.replace(/["*(){}[\]:^~!@#$%&|\\<>]/g, "");
      return escaped.length > 0 ? `"${escaped}"*` : "";
    })
    .filter((t) => t.length > 0);

  return tokens.join(" ");
}

/** Full-text search with BM25 ranking. Returns flat results sorted by relevance. */
export function searchEntities(db: Database.Database, query: string, limit = 15): SearchResult[] {
  const sanitized = sanitizeQuery(query);
  if (!sanitized) return [];

  const effectiveLimit = Math.min(Math.max(limit, 1), 50);

  try {
    // Contentless FTS5 cannot return stored text — join with shadow map for values
    const rows = db
      .prepare(
        `SELECT m.entity_type, m.entity_id, m.title, m.subtitle, m.route_hash, si.rank
         FROM search_index si
         JOIN search_index_map m ON m.fts_rowid = si.rowid
         WHERE search_index MATCH ?
         ORDER BY si.rank
         LIMIT ?`,
      )
      .all(sanitized, effectiveLimit) as Array<{
      entity_type: string;
      entity_id: string;
      title: string;
      subtitle: string;
      route_hash: string;
      rank: number;
    }>;

    return rows.map((r) => ({
      type: r.entity_type,
      id: r.entity_id,
      title: r.title,
      subtitle: r.subtitle,
      route: r.route_hash,
      rank: r.rank,
    }));
  } catch (err) {
    // Graceful fallback for malformed FTS5 queries
    logger.debug("Search query failed", { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Full rebuild
// ---------------------------------------------------------------------------

/** Rebuild the entire search index from source tables. */
export function rebuildSearchIndex(db: Database.Database): void {
  const tx = db.transaction(() => {
    // Clear everything
    db.exec("DELETE FROM search_index_map");
    // For contentless FTS5, use the special 'delete-all' command
    db.exec("INSERT INTO search_index(search_index) VALUES('delete-all')");

    // 1. Instances
    const instances = db.prepare("SELECT slug, display_name, state FROM instances").all() as Array<{
      slug: string;
      display_name: string | null;
      state: string;
    }>;
    for (const inst of instances) {
      insertAndMap(db, {
        entityType: "instance",
        entityId: inst.slug,
        title: inst.display_name ?? inst.slug,
        subtitle: inst.state ?? "",
        routeHash: `/instances/${inst.slug}/builder`,
      });
    }

    // 2. Agents (instance agents only — blueprint agents are not navigable)
    const agents = db
      .prepare(
        `SELECT a.agent_id, a.name, i.slug AS instance_slug
         FROM agents a
         JOIN instances i ON a.instance_id = i.id
         WHERE a.instance_id IS NOT NULL`,
      )
      .all() as Array<{ agent_id: string; name: string; instance_slug: string }>;
    for (const agent of agents) {
      insertAndMap(db, {
        entityType: "agent",
        entityId: `${agent.instance_slug}:${agent.agent_id}`,
        title: agent.name || agent.agent_id,
        subtitle: agent.instance_slug,
        routeHash: `/instances/${agent.instance_slug}/builder`,
      });
    }

    // 3. Tasks
    const tasks = db
      .prepare("SELECT id, title, instance_slug, status FROM rt_tasks")
      .all() as Array<{ id: number; title: string; instance_slug: string; status: string }>;
    for (const task of tasks) {
      insertAndMap(db, {
        entityType: "task",
        entityId: String(task.id),
        title: task.title,
        subtitle: `${task.instance_slug} · ${task.status}`,
        routeHash: `/instances/${task.instance_slug}/tasks`,
      });
    }

    // 4. Blueprints
    const blueprints = db.prepare("SELECT id, name, description FROM blueprints").all() as Array<{
      id: number;
      name: string;
      description: string | null;
    }>;
    for (const bp of blueprints) {
      insertAndMap(db, {
        entityType: "blueprint",
        entityId: String(bp.id),
        title: bp.name,
        subtitle: bp.description ?? "",
        routeHash: `/blueprints/${bp.id}/builder`,
      });
    }

    // 5. Agent blueprints (templates)
    const agentBlueprints = db
      .prepare("SELECT id, name, category FROM agent_blueprints")
      .all() as Array<{ id: string; name: string; category: string | null }>;
    for (const ab of agentBlueprints) {
      insertAndMap(db, {
        entityType: "agent_blueprint",
        entityId: ab.id,
        title: ab.name,
        subtitle: ab.category ?? "",
        routeHash: `/agent-templates/${ab.id}`,
      });
    }
  });

  tx();
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/** Insert into FTS5 + map in one step (used during rebuild). */
function insertAndMap(db: Database.Database, entry: SearchEntry): void {
  const result = db
    .prepare(
      `INSERT INTO search_index(entity_type, entity_id, title, subtitle, route_hash)
       VALUES(?, ?, ?, ?, ?)`,
    )
    .run(entry.entityType, entry.entityId, entry.title, entry.subtitle, entry.routeHash);

  db.prepare(
    `INSERT INTO search_index_map(entity_type, entity_id, fts_rowid, title, subtitle, route_hash)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.entityType,
    entry.entityId,
    result.lastInsertRowid,
    entry.title,
    entry.subtitle,
    entry.routeHash,
  );
}
