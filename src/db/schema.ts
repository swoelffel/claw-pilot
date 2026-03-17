// src/db/schema.ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import * as path from "node:path";

// Base schema version — bump only when adding new migrations (migrations tracked separately)
const BASE_SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

-- Physical server (V1: always a single "local" record)
CREATE TABLE IF NOT EXISTS servers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hostname        TEXT NOT NULL,
  ip              TEXT,
  ssh_user        TEXT,
  ssh_port        INTEGER DEFAULT 22,
  openclaw_home   TEXT NOT NULL,
  openclaw_bin    TEXT,
  openclaw_version TEXT,
  os              TEXT,
  created_at      TEXT,
  updated_at      TEXT
);

-- OpenClaw instance
CREATE TABLE IF NOT EXISTS instances (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id       INTEGER NOT NULL REFERENCES servers(id),
  slug            TEXT NOT NULL UNIQUE,
  display_name    TEXT,
  port            INTEGER NOT NULL UNIQUE,
  state           TEXT DEFAULT 'unknown' CHECK(state IN ('running','stopped','error','unknown')),
  config_path     TEXT NOT NULL,
  state_dir       TEXT NOT NULL,
  systemd_unit    TEXT NOT NULL,
  telegram_bot    TEXT,
  default_model   TEXT,
  discovered      INTEGER DEFAULT 0,
  created_at      TEXT,
  updated_at      TEXT
);

-- Instance agents
CREATE TABLE IF NOT EXISTS agents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  model           TEXT,
  workspace_path  TEXT NOT NULL,
  is_default      INTEGER DEFAULT 0,
  UNIQUE(instance_id, agent_id)
);

-- Allocated port registry
CREATE TABLE IF NOT EXISTS ports (
  server_id       INTEGER NOT NULL REFERENCES servers(id),
  port            INTEGER NOT NULL,
  instance_slug   TEXT,
  PRIMARY KEY (server_id, port)
);

-- Global key-value configuration
CREATE TABLE IF NOT EXISTS config (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL
);

-- Event/history log (audit trail)
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_slug   TEXT,
  event_type      TEXT NOT NULL,
  detail          TEXT,
  created_at      TEXT
);
`;

const DEFAULT_CONFIG: Record<string, string> = {
  port_range_start: "18789",
  port_range_end: "18838",
  dashboard_port: "19000",
  health_check_interval_ms: "10000",
  openclaw_user: "openclaw",
};

// ---------------------------------------------------------------------------
// Migration framework
// ---------------------------------------------------------------------------

interface Migration {
  version: number;
  /**
   * Set to true for migrations that need PRAGMA foreign_keys = OFF.
   * SQLite does not allow changing foreign_keys pragma inside a transaction,
   * so the migration framework will disable FK enforcement before starting
   * the transaction and re-enable it after.
   */
  disableFk?: boolean;
  up(db: Database.Database): void;
}

/**
 * Ordered list of migrations. Each migration must have a unique, monotonically
 * increasing version number greater than BASE_SCHEMA_VERSION (1).
 * Migrations are applied in order, inside individual transactions.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 2,
    up(db) {
      db.exec(`
        -- Agent workspace files (AGENTS.md, SOUL.md, etc.)
        CREATE TABLE IF NOT EXISTS agent_files (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id        INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          filename        TEXT NOT NULL,
          content         TEXT,
          content_hash    TEXT,
          updated_at      TEXT,
          UNIQUE(agent_id, filename)
        );

        -- Agent-to-agent links (a2a or spawn) scoped to an instance
        CREATE TABLE IF NOT EXISTS agent_links (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
          source_agent_id TEXT NOT NULL,
          target_agent_id TEXT NOT NULL,
          link_type       TEXT NOT NULL CHECK(link_type IN ('a2a', 'spawn')),
          UNIQUE(instance_id, source_agent_id, target_agent_id, link_type)
        );

        -- Enriched agent metadata columns (added by v2 migration)
        ALTER TABLE agents ADD COLUMN role         TEXT;
        ALTER TABLE agents ADD COLUMN tags         TEXT;
        ALTER TABLE agents ADD COLUMN notes        TEXT;
        ALTER TABLE agents ADD COLUMN position_x   REAL;
        ALTER TABLE agents ADD COLUMN position_y   REAL;
        ALTER TABLE agents ADD COLUMN config_hash  TEXT;
        ALTER TABLE agents ADD COLUMN synced_at    TEXT;
      `);
    },
  },
  {
    version: 3,
    up(db) {
      db.exec(`
        -- 1. Table blueprints
        CREATE TABLE IF NOT EXISTS blueprints (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          name         TEXT NOT NULL UNIQUE,
          description  TEXT,
          icon         TEXT,
          tags         TEXT,
          color        TEXT,
          created_at   TEXT,
          updated_at   TEXT
        );

        -- 2. Recréer agents avec FK polymorphe
        CREATE TABLE agents_v3 (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id     INTEGER REFERENCES instances(id) ON DELETE CASCADE,
          blueprint_id    INTEGER REFERENCES blueprints(id) ON DELETE CASCADE,
          agent_id        TEXT NOT NULL,
          name            TEXT NOT NULL,
          model           TEXT,
          workspace_path  TEXT NOT NULL,
          is_default      INTEGER DEFAULT 0,
          role            TEXT,
          tags            TEXT,
          notes           TEXT,
          position_x      REAL,
          position_y      REAL,
          config_hash     TEXT,
          synced_at       TEXT,
          CHECK (
            (instance_id IS NOT NULL AND blueprint_id IS NULL) OR
            (instance_id IS NULL AND blueprint_id IS NOT NULL)
          ),
          UNIQUE(instance_id, agent_id),
          UNIQUE(blueprint_id, agent_id)
        );

        INSERT INTO agents_v3
          SELECT id, instance_id, NULL, agent_id, name, model, workspace_path,
                 is_default, role, tags, notes, position_x, position_y,
                 config_hash, synced_at
          FROM agents;

        DROP TABLE agents;
        ALTER TABLE agents_v3 RENAME TO agents;

        -- 3. Recréer agent_links avec FK polymorphe
        CREATE TABLE agent_links_v3 (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id     INTEGER REFERENCES instances(id) ON DELETE CASCADE,
          blueprint_id    INTEGER REFERENCES blueprints(id) ON DELETE CASCADE,
          source_agent_id TEXT NOT NULL,
          target_agent_id TEXT NOT NULL,
          link_type       TEXT NOT NULL CHECK(link_type IN ('a2a', 'spawn')),
          CHECK (
            (instance_id IS NOT NULL AND blueprint_id IS NULL) OR
            (instance_id IS NULL AND blueprint_id IS NOT NULL)
          ),
          UNIQUE(instance_id, source_agent_id, target_agent_id, link_type),
          UNIQUE(blueprint_id, source_agent_id, target_agent_id, link_type)
        );

        INSERT INTO agent_links_v3
          SELECT id, instance_id, NULL, source_agent_id, target_agent_id, link_type
          FROM agent_links;

        DROP TABLE agent_links;
        ALTER TABLE agent_links_v3 RENAME TO agent_links;
      `);
    },
  },
  {
    // v4: remove nginx_domain column from instances table.
    // SQLite < 3.35.0 does not support DROP COLUMN, so we recreate the table.
    // FK enforcement must be disabled to allow DROP TABLE instances without
    // cascading deletes to agents/agent_links (which reference instances via
    // ON DELETE CASCADE). PRAGMA foreign_keys cannot be changed inside a
    // transaction, so disableFk=true tells initDatabase to set it before
    // starting the transaction.
    version: 4,
    disableFk: true,
    up(db) {
      db.exec(`
        CREATE TABLE instances_v4 (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id       INTEGER NOT NULL REFERENCES servers(id),
          slug            TEXT NOT NULL UNIQUE,
          display_name    TEXT,
          port            INTEGER NOT NULL UNIQUE,
          state           TEXT DEFAULT 'unknown' CHECK(state IN ('running','stopped','error','unknown')),
          config_path     TEXT NOT NULL,
          state_dir       TEXT NOT NULL,
          systemd_unit    TEXT NOT NULL,
          telegram_bot    TEXT,
          default_model   TEXT,
          discovered      INTEGER DEFAULT 0,
          created_at      TEXT,
          updated_at      TEXT
        );
        INSERT INTO instances_v4
          SELECT id, server_id, slug, display_name, port, state,
                 config_path, state_dir, systemd_unit, telegram_bot,
                 default_model, discovered, created_at, updated_at
          FROM instances;
        DROP TABLE instances;
        ALTER TABLE instances_v4 RENAME TO instances;
      `);
    },
  },
  {
    // v5: align port_range_end default with constants.ts (18838 instead of 18799).
    // Only updates existing DBs where the value is still the old default (<18838).
    version: 5,
    up(db) {
      db.exec(`
        UPDATE config SET value = '18838'
        WHERE key = 'port_range_end' AND CAST(value AS INTEGER) < 18838;
      `);
    },
  },
  {
    // v6: add users and sessions tables for dashboard authentication.
    // users: single admin account in v1, prepared for multi-user (role column).
    // sessions: server-side sessions with TTL, sliding window, audit fields.
    version: 6,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          username      TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role          TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'operator', 'viewer')),
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id            TEXT PRIMARY KEY,
          user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at    TEXT NOT NULL,
          last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
          ip_address    TEXT,
          user_agent    TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
      `);
    },
  },
  {
    // v7: add skills column to agents table.
    // TEXT nullable — JSON array string (e.g. '["weather","gemini"]') or NULL
    // (NULL = access to all skills, same convention as tags).
    version: 7,
    up(db) {
      db.exec(`
        ALTER TABLE agents ADD COLUMN skills TEXT;
      `);
    },
  },
  {
    // v8: claw-runtime foundation tables (prefixed rt_).
    // These tables support the native agent runtime engine being developed
    // in src/runtime/ as a replacement for OpenClaw instances.
    //
    // All tables are additive (CREATE TABLE IF NOT EXISTS) — safe to apply
    // on existing DBs without data loss.
    version: 8,
    up(db) {
      db.exec(`
        -- Add instance_type column to instances table.
        -- 'openclaw' = legacy OpenClaw instance (default)
        -- 'claw-runtime' = native claw-runtime instance
        ALTER TABLE instances ADD COLUMN instance_type TEXT NOT NULL DEFAULT 'openclaw'
          CHECK(instance_type IN ('openclaw', 'claw-runtime'));

        -- Runtime sessions (one per conversation / channel peer)
        CREATE TABLE IF NOT EXISTS rt_sessions (
          id            TEXT PRIMARY KEY,
          instance_slug TEXT NOT NULL REFERENCES instances(slug) ON DELETE CASCADE,
          parent_id     TEXT REFERENCES rt_sessions(id),
          agent_id      TEXT NOT NULL,
          channel       TEXT NOT NULL DEFAULT 'web',
          peer_id       TEXT,
          title         TEXT,
          state         TEXT NOT NULL DEFAULT 'active'
            CHECK(state IN ('active', 'archived')),
          permissions   TEXT,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_rt_sessions_instance
          ON rt_sessions(instance_slug);
        CREATE INDEX IF NOT EXISTS idx_rt_sessions_parent
          ON rt_sessions(parent_id);

        -- Runtime messages (user + assistant turns)
        CREATE TABLE IF NOT EXISTS rt_messages (
          id            TEXT PRIMARY KEY,
          session_id    TEXT NOT NULL REFERENCES rt_sessions(id) ON DELETE CASCADE,
          role          TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
          agent_id      TEXT,
          model         TEXT,
          tokens_in     INTEGER,
          tokens_out    INTEGER,
          cost_usd      REAL,
          finish_reason TEXT,
          is_compaction INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_rt_messages_session
          ON rt_messages(session_id);

        -- Runtime message parts (atomic content units within a message)
        CREATE TABLE IF NOT EXISTS rt_parts (
          id            TEXT PRIMARY KEY,
          message_id    TEXT NOT NULL REFERENCES rt_messages(id) ON DELETE CASCADE,
          type          TEXT NOT NULL,
          state         TEXT CHECK(state IN ('pending', 'running', 'completed', 'error')),
          content       TEXT,
          metadata      TEXT,
          sort_order    INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_rt_parts_message
          ON rt_parts(message_id);

        -- Runtime permission rules (persisted approvals)
        CREATE TABLE IF NOT EXISTS rt_permissions (
          id            TEXT PRIMARY KEY,
          instance_slug TEXT NOT NULL REFERENCES instances(slug) ON DELETE CASCADE,
          scope         TEXT NOT NULL,
          permission    TEXT NOT NULL,
          pattern       TEXT NOT NULL,
          action        TEXT NOT NULL CHECK(action IN ('allow', 'deny', 'ask')),
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_rt_permissions_scope
          ON rt_permissions(instance_slug, scope);

        -- Runtime auth profiles (API key rotation per provider)
        CREATE TABLE IF NOT EXISTS rt_auth_profiles (
          id              TEXT PRIMARY KEY,
          instance_slug   TEXT NOT NULL REFERENCES instances(slug) ON DELETE CASCADE,
          provider_id     TEXT NOT NULL,
          api_key_env_var TEXT NOT NULL,
          priority        INTEGER NOT NULL DEFAULT 0,
          cooldown_until  TEXT,
          failure_count   INTEGER NOT NULL DEFAULT 0,
          last_error      TEXT,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_rt_auth_profiles_provider
          ON rt_auth_profiles(instance_slug, provider_id);
      `);
    },
  },
  {
    // v9: device pairing codes for web-chat channel.
    // Short-lived 8-char codes that pair a browser session to a runtime instance.
    version: 9,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rt_pairing_codes (
          code          TEXT PRIMARY KEY,
          instance_slug TEXT NOT NULL REFERENCES instances(slug) ON DELETE CASCADE,
          channel       TEXT NOT NULL DEFAULT 'web',
          peer_id       TEXT,
          used          INTEGER NOT NULL DEFAULT 0,
          expires_at    TEXT NOT NULL,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_rt_pairing_codes_instance
          ON rt_pairing_codes(instance_slug);

        CREATE INDEX IF NOT EXISTS idx_rt_pairing_codes_expires
          ON rt_pairing_codes(expires_at);
      `);
    },
  },
  {
    // v10: normalize blueprint tags to JSON array format.
    // Converts plain string tags (e.g., "tag1") to JSON array format (e.g., '["tag1"]').
    version: 10,
    up(db) {
      // Get all blueprints with tags
      const blueprints = db
        .prepare("SELECT id, tags FROM blueprints WHERE tags IS NOT NULL")
        .all() as Array<{ id: number; tags: string }>;

      // Normalize each blueprint's tags
      const updateStmt = db.prepare("UPDATE blueprints SET tags = ? WHERE id = ?");
      for (const bp of blueprints) {
        try {
          // Try to parse as JSON — if it works, it's already in the right format
          JSON.parse(bp.tags);
        } catch {
          // If JSON parse fails, it's a plain string — convert to JSON array
          const normalizedTags = JSON.stringify([bp.tags]);
          updateStmt.run(normalizedTags, bp.id);
        }
      }
    },
  },
  {
    // v11: session enrichment — session_key, spawn_depth, label, metadata.
    //
    // session_key: business identifier "<instanceSlug>:<agentId>:<channel>:<peerId>"
    //   Allows O(1) lookup instead of full table scan in findOrCreateSession().
    //   Backfill is done BEFORE creating the UNIQUE index.
    //
    // spawn_depth: depth in the session tree (0 = root, 1 = first sub-agent, etc.)
    //   Used to enforce maxSpawnDepth limits.
    //
    // label: optional human-readable label (assignable by agent or user).
    //
    // metadata: extensible JSON blob (skillsSnapshot, promptReport, etc.)
    version: 11,
    up(db) {
      db.exec(`
        -- session_key: identifiant métier lisible "<instanceSlug>:<agentId>:<channel>:<peerId>"
        ALTER TABLE rt_sessions ADD COLUMN session_key TEXT;

        -- Backfill des sessions existantes (AVANT la création de l'index UNIQUE)
        UPDATE rt_sessions
        SET session_key = instance_slug || ':' || agent_id || ':' || channel || ':' || COALESCE(peer_id, 'unknown')
        WHERE session_key IS NULL;

        -- Index unique sur les sessions racines uniquement (parent_id IS NULL)
        -- Les sessions enfants (fork, sub-agent) peuvent partager la même clé métier
        CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_sessions_key ON rt_sessions(session_key) WHERE parent_id IS NULL;

        -- spawn_depth: profondeur dans l'arbre de sessions (0 = racine)
        ALTER TABLE rt_sessions ADD COLUMN spawn_depth INTEGER NOT NULL DEFAULT 0;

        -- label: label humain optionnel (assignable par l'agent ou l'utilisateur)
        ALTER TABLE rt_sessions ADD COLUMN label TEXT;

        -- metadata: JSON extensible (skillsSnapshot, promptReport, etc.)
        ALTER TABLE rt_sessions ADD COLUMN metadata TEXT;

        -- Index sur (parent_id, state) pour countActiveChildren()
        CREATE INDEX IF NOT EXISTS idx_rt_sessions_parent_state
          ON rt_sessions(parent_id, state);
      `);
    },
  },
  {
    // v12: add meta column to rt_pairing_codes.
    // Stores channel-specific metadata as a JSON blob (e.g. Telegram username).
    // Nullable TEXT — existing rows default to NULL.
    version: 12,
    up(db) {
      db.exec(`ALTER TABLE rt_pairing_codes ADD COLUMN meta TEXT`);
    },
  },
  {
    // v13: persistent sessions + agent creation date.
    //
    // rt_sessions.persistent: distinguishes permanent sessions (long-lived, never archived)
    //   from ephemeral sessions (per-task, archived after completion).
    //   INTEGER NOT NULL DEFAULT 0 — existing sessions are ephemeral by default (backward-compat).
    //
    // agents.created_at: date the agent was provisioned, injected into the generic identity
    //   block of the system prompt (§5 of PLAN-15a).
    //   Nullable TEXT — backfilled with current datetime for existing agents.
    version: 13,
    up(db) {
      // 1. Colonne persistent sur rt_sessions
      db.exec(`
        ALTER TABLE rt_sessions
        ADD COLUMN persistent INTEGER NOT NULL DEFAULT 0;
      `);

      // 2. Index partiel pour le lookup rapide des sessions permanentes actives
      // SQLite supporte les index partiels (WHERE clause) depuis 3.8.0
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_rt_sessions_permanent
          ON rt_sessions(instance_slug, agent_id, peer_id)
          WHERE persistent = 1 AND state = 'active';
      `);

      // 3. Colonne created_at sur agents (si absente)
      // Verifier d'abord — la colonne peut exister selon les migrations precedentes
      const agentCols = db.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
      const hasCreatedAt = agentCols.some((c) => c.name === "created_at");
      if (!hasCreatedAt) {
        db.exec(`
          ALTER TABLE agents
          ADD COLUMN created_at TEXT;
        `);
        // Backfill avec la date courante pour les agents existants
        db.exec(`
          UPDATE agents SET created_at = datetime('now') WHERE created_at IS NULL;
        `);
      }
    },
  },
  {
    // v14: composite index on rt_messages(session_id, role) for heartbeat alert queries.
    //
    // countHeartbeatAlerts() in monitor.ts JOINs rt_messages with a role='assistant' filter.
    // The existing idx_rt_messages_session covers session_id only, forcing a full scan of
    // all messages per session to apply the role filter.
    // This composite index lets SQLite satisfy both predicates in one index scan.
    //
    // Defensive: check table existence first (for partial-schema test environments).
    version: 14,
    up(db) {
      const hasTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rt_messages'")
        .get();
      if (hasTable) {
        db.exec(`
           CREATE INDEX IF NOT EXISTS idx_rt_messages_session_role
             ON rt_messages(session_id, role);
         `);
      }

      // PLAN-16: recalculate permanent session keys (remove peerId from key).
      // Changes the permanent session key from "<slug>:<agentId>:<peerId>"
      // to "<slug>:<agentId>" — a single session per agent, shared across all channels and peers.

      // Step 1: Archive duplicate permanent sessions
      // For each (instance_slug, agent_id) with multiple persistent=1 sessions,
      // keep the oldest (MIN(id)) and archive the rest.
      const hasSessions = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rt_sessions'")
        .get();
      if (hasSessions) {
        db.exec(`
           UPDATE rt_sessions
           SET state = 'archived', updated_at = CURRENT_TIMESTAMP
           WHERE persistent = 1
             AND id NOT IN (
               SELECT MIN(id) FROM rt_sessions
               WHERE persistent = 1
               GROUP BY instance_slug, agent_id
             );
         `);

        // Step 2: Recalculate session_key for all persistent sessions
        // New format: "<instance_slug>:<agent_id>" (no peerId, no channel)
        db.exec(`
           UPDATE rt_sessions
           SET session_key = instance_slug || ':' || agent_id
           WHERE persistent = 1;
         `);

        // Step 3: Recreate the partial unique index on session_key
        // Only apply if parent_id column exists (defensive for partial-schema test environments)
        const hasParentId = db
          .prepare("PRAGMA table_info(rt_sessions)")
          .all()
          .some((col: any) => col.name === "parent_id");

        if (hasParentId) {
          db.exec(`
             DROP INDEX IF EXISTS idx_rt_sessions_key;
             CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_sessions_key
               ON rt_sessions(session_key) WHERE parent_id IS NULL;
           `);
        }

        // Step 4: Drop the old permanent sessions index (no longer needed)
        db.exec(`
           DROP INDEX IF EXISTS idx_rt_sessions_permanent;
         `);
      }
    },
  },
  {
    // v15: relocate instance state directories from ~/.runtime-<slug>/ to ~/.claw-pilot/instances/<slug>/
    //
    // Recalculates state_dir and config_path for all instances based on the new directory structure.
    // Workspace paths for agents are also updated to reflect the new state_dir location.
    //
    // Note: This migration updates the database paths only. The actual files on disk must be
    // moved manually (or via deployment script) after the migration runs.
    version: 15,
    up(db) {
      // Helper to compute the new state_dir path
      // In the migration context, we can't import getInstancesDir() directly,
      // so we compute it inline: ~/.claw-pilot/instances/<slug>
      // We use a placeholder that will be replaced by the actual path at runtime.
      // For now, we'll compute relative to the data dir which is ~/.claw-pilot/

      const instances = db.prepare("SELECT id, slug FROM instances").all() as Array<{
        id: number;
        slug: string;
      }>;

      const updateInstance = db.prepare(
        "UPDATE instances SET state_dir = ?, config_path = ? WHERE id = ?",
      );

      for (const inst of instances) {
        // New path: ~/.claw-pilot/instances/<slug>
        // We use a relative computation: dataDir/instances/slug
        // Since we can't access getDataDir() here, we'll use a pattern that works:
        // Extract the old state_dir, replace .runtime-<slug> with instances/<slug>

        const oldStateDir = db
          .prepare("SELECT state_dir FROM instances WHERE id = ?")
          .get(inst.id) as { state_dir: string } | undefined;

        if (oldStateDir) {
          // Replace ~/.runtime-<slug> with ~/.claw-pilot/instances/<slug>
          const newStateDir = oldStateDir.state_dir
            .replace(/\.runtime-[^/]+$/, `instances/${inst.slug}`)
            .replace(/\/\.runtime-[^/]+$/, `/instances/${inst.slug}`);

          const newConfigPath = `${newStateDir}/runtime.json`;
          updateInstance.run(newStateDir, newConfigPath, inst.id);
        }
      }

      // Update agent workspace paths
      const agents = db.prepare("SELECT id, workspace_path FROM agents").all() as Array<{
        id: number;
        workspace_path: string;
      }>;

      const updateAgent = db.prepare("UPDATE agents SET workspace_path = ? WHERE id = ?");

      for (const agent of agents) {
        // Replace ~/.runtime-<slug> with ~/.claw-pilot/instances/<slug> in workspace paths
        const newWorkspacePath = agent.workspace_path
          .replace(/\.runtime-([^/]+)/, "instances/$1")
          .replace(/\/\.runtime-([^/]+)/, "/instances/$1");

        if (newWorkspacePath !== agent.workspace_path) {
          updateAgent.run(newWorkspacePath, agent.id);
        }
      }
    },
  },
];

// ---------------------------------------------------------------------------
// initDatabase
// ---------------------------------------------------------------------------

export function initDatabase(dbPath: string): Database.Database {
  // Ensure parent directory exists
  const dirPath = path.dirname(dbPath);
  try {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  } catch {
    // Directory already exists
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Check if schema exists (fresh DB vs existing DB)
  const hasSchema = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();

  if (!hasSchema) {
    // --- Fresh database: create base schema + seed config ---
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(BASE_SCHEMA_VERSION);

    // Insert default config
    const insert = db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      insert.run(key, value);
    }
  }

  // --- Run pending migrations (applies to both fresh and existing DBs) ---
  const row = db.prepare("SELECT version FROM schema_version").get() as
    | { version: number }
    | undefined;
  const currentVersion = row?.version ?? BASE_SCHEMA_VERSION;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    // Migrations that need FK disabled must set disableFk=true.
    // PRAGMA foreign_keys cannot be changed inside a transaction (SQLite
    // silently ignores it), so we disable it before starting the transaction
    // and restore it after.
    if (migration.disableFk) {
      db.pragma("foreign_keys = OFF");
    }

    try {
      // Each migration runs in its own transaction so a failure is atomic
      db.transaction(() => {
        migration.up(db);
        db.prepare("UPDATE schema_version SET version = ?").run(migration.version);
      })();
    } finally {
      if (migration.disableFk) {
        db.pragma("foreign_keys = ON");
      }
    }
  }

  return db;
}
