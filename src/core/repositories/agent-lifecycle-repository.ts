import type Database from "better-sqlite3";
import { logger } from "../../lib/logger.js";

export type AgentLifecycle =
  | "EXPERIMENTAL"
  | "DEVELOPMENT"
  | "TESTING"
  | "PRODUCTION"
  | "DEPRECATED"
  | "ARCHIVED";

export interface AgentVersionRow {
  id: number;
  instance_slug: string;
  agent_id: string;
  version: number;
  lifecycle: AgentLifecycle;
  config_json: string;
  prompt_snapshot_json: string;
  tools_json: string;
  permissions_json: string;
  dependencies_json: string;
  created_by_user_id: number | null;
  created_at: string;
}

export interface AgentComparison {
  left: { agentId: string; version: number };
  right: { agentId: string; version: number };
  differences: Array<{ path: string; left: unknown; right: unknown }>;
}

function parseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (err) {
    logger.debug("agent_lifecycle_config_parse_failed", { error: String(err) });
    return {};
  }
}

export function snapshotAgentVersion(
  db: Database.Database,
  instanceSlug: string,
  agentId: string,
  createdByUserId?: number,
): AgentVersionRow | undefined {
  const agent = db
    .prepare(
      `SELECT a.* FROM agents a JOIN instances i ON i.id = a.instance_id
       WHERE i.slug = ? AND a.agent_id = ?`,
    )
    .get(instanceSlug, agentId) as
    | {
        config_json: string | null;
        lifecycle: AgentLifecycle;
        version: number;
        dependencies_json: string;
        model: string | null;
      }
    | undefined;
  if (!agent) return undefined;
  const config = parseObject(agent.config_json);
  db.prepare(
    `INSERT INTO rt_agent_versions
      (instance_slug, agent_id, version, lifecycle, config_json, prompt_snapshot_json,
       tools_json, permissions_json, dependencies_json, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    instanceSlug,
    agentId,
    agent.version,
    agent.lifecycle,
    JSON.stringify(config),
    JSON.stringify(config["prompt"] ?? config["systemPrompt"] ?? {}),
    JSON.stringify(config["tools"] ?? []),
    JSON.stringify(config["permissions"] ?? []),
    agent.dependencies_json,
    createdByUserId ?? null,
  );
  return db
    .prepare(
      "SELECT * FROM rt_agent_versions WHERE instance_slug = ? AND agent_id = ? AND version = ?",
    )
    .get(instanceSlug, agentId, agent.version) as AgentVersionRow;
}

export function createAgentVersion(
  db: Database.Database,
  instanceSlug: string,
  agentId: string,
  config: Record<string, unknown>,
  createdByUserId?: number,
): AgentVersionRow | undefined {
  const agent = db
    .prepare(
      `SELECT a.lifecycle, a.version FROM agents a JOIN instances i ON i.id = a.instance_id
       WHERE i.slug = ? AND a.agent_id = ?`,
    )
    .get(instanceSlug, agentId) as { lifecycle: AgentLifecycle; version: number } | undefined;
  if (!agent) return undefined;
  const version = agent.version + 1;
  const dependencies = config["dependencies"] ?? [];
  db.transaction(() => {
    db.prepare(
      `INSERT INTO rt_agent_versions
        (instance_slug, agent_id, version, lifecycle, config_json, prompt_snapshot_json,
         tools_json, permissions_json, dependencies_json, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      instanceSlug,
      agentId,
      version,
      agent.lifecycle,
      JSON.stringify(config),
      JSON.stringify(config["prompt"] ?? config["systemPrompt"] ?? {}),
      JSON.stringify(config["tools"] ?? []),
      JSON.stringify(config["permissions"] ?? []),
      JSON.stringify(dependencies),
      createdByUserId ?? null,
    );
    db.prepare(
      `UPDATE agents SET version = ?, config_json = ?, dependencies_json = ?
       WHERE instance_id = (SELECT id FROM instances WHERE slug = ?) AND agent_id = ?`,
    ).run(version, JSON.stringify(config), JSON.stringify(dependencies), instanceSlug, agentId);
  })();
  return db
    .prepare(
      "SELECT * FROM rt_agent_versions WHERE instance_slug = ? AND agent_id = ? AND version = ?",
    )
    .get(instanceSlug, agentId, version) as AgentVersionRow;
}

export function requestAgentPromotion(
  db: Database.Database,
  input: {
    instanceSlug: string;
    agentId: string;
    toState: AgentLifecycle;
    requestedByUserId?: number | undefined;
    reason?: string | undefined;
  },
): number {
  const agent = db
    .prepare(
      `SELECT a.lifecycle, a.version FROM agents a JOIN instances i ON i.id = a.instance_id
       WHERE i.slug = ? AND a.agent_id = ?`,
    )
    .get(input.instanceSlug, input.agentId) as
    | { lifecycle: AgentLifecycle; version: number }
    | undefined;
  if (!agent) throw new Error("Agent not found");
  if (agent.lifecycle === "ARCHIVED") throw new Error("Archived agents cannot be promoted");
  const result = db
    .prepare(
      `INSERT INTO rt_agent_promotion_approvals
       (instance_slug, agent_id, version, from_state, to_state, requested_by_user_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.instanceSlug,
      input.agentId,
      agent.version,
      agent.lifecycle,
      input.toState,
      input.requestedByUserId ?? null,
      input.reason ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function decideAgentPromotion(
  db: Database.Database,
  approvalId: number,
  approved: boolean,
  decidedByUserId: number,
  reason?: string,
): boolean {
  const approval = db
    .prepare("SELECT * FROM rt_agent_promotion_approvals WHERE id = ? AND status = 'PENDING'")
    .get(approvalId) as
    | { instance_slug: string; agent_id: string; version: number; to_state: AgentLifecycle }
    | undefined;
  if (!approval) return false;
  db.transaction(() => {
    db.prepare(
      `UPDATE rt_agent_promotion_approvals SET status = ?, decided_by_user_id = ?,
       reason = COALESCE(?, reason), decided_at = datetime('now') WHERE id = ?`,
    ).run(approved ? "APPROVED" : "REJECTED", decidedByUserId, reason ?? null, approvalId);
    if (approved) {
      db.prepare(
        `UPDATE agents SET lifecycle = ?
         WHERE instance_id = (SELECT id FROM instances WHERE slug = ?)
         AND agent_id = ? AND version = ?`,
      ).run(approval.to_state, approval.instance_slug, approval.agent_id, approval.version);
    }
  })();
  return true;
}

export function rollbackAgentVersion(
  db: Database.Database,
  instanceSlug: string,
  agentId: string,
  targetVersion: number,
  actorUserId?: number,
): AgentVersionRow | undefined {
  const target = db
    .prepare(
      "SELECT * FROM rt_agent_versions WHERE instance_slug = ? AND agent_id = ? AND version = ?",
    )
    .get(instanceSlug, agentId, targetVersion) as AgentVersionRow | undefined;
  if (!target) return undefined;
  const config = parseObject(target.config_json);
  config["rollbackOfVersion"] = targetVersion;
  return createAgentVersion(db, instanceSlug, agentId, config, actorUserId);
}

function collectDifferences(
  left: unknown,
  right: unknown,
  path: string,
  output: AgentComparison["differences"],
): void {
  if (Object.is(left, right)) return;
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const keys = new Set([
      ...Object.keys(left as Record<string, unknown>),
      ...Object.keys(right as Record<string, unknown>),
    ]);
    for (const key of [...keys].sort()) {
      collectDifferences(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        output,
      );
    }
    return;
  }
  if (JSON.stringify(left) !== JSON.stringify(right)) output.push({ path, left, right });
}

export function compareAgents(
  db: Database.Database,
  input: {
    instanceSlug: string;
    leftAgentId: string;
    rightAgentId: string;
    leftVersion?: number;
    rightVersion?: number;
  },
): AgentComparison | undefined {
  const read = (agentId: string, version?: number) => {
    if (version !== undefined) {
      return db
        .prepare(
          `SELECT agent_id, version, config_json FROM rt_agent_versions
           WHERE instance_slug = ? AND agent_id = ? AND version = ?`,
        )
        .get(input.instanceSlug, agentId, version) as
        | { agent_id: string; version: number; config_json: string }
        | undefined;
    }
    return db
      .prepare(
        `SELECT a.agent_id, a.version, COALESCE(a.config_json, '{}') AS config_json
         FROM agents a JOIN instances i ON i.id = a.instance_id
         WHERE i.slug = ? AND a.agent_id = ?`,
      )
      .get(input.instanceSlug, agentId) as
      | { agent_id: string; version: number; config_json: string }
      | undefined;
  };
  const left = read(input.leftAgentId, input.leftVersion);
  const right = read(input.rightAgentId, input.rightVersion);
  if (!left || !right) return undefined;
  const differences: AgentComparison["differences"] = [];
  collectDifferences(
    parseObject(left.config_json),
    parseObject(right.config_json),
    "",
    differences,
  );
  return {
    left: { agentId: left.agent_id, version: left.version },
    right: { agentId: right.agent_id, version: right.version },
    differences,
  };
}

export function listUnusedAgents(
  db: Database.Database,
  instanceSlug: string,
  inactiveDays = 90,
): Array<{
  agent_id: string;
  name: string;
  lifecycle: AgentLifecycle;
  last_used_at: string | null;
}> {
  return db
    .prepare(
      `SELECT a.agent_id, a.name, a.lifecycle, a.last_used_at FROM agents a
       JOIN instances i ON i.id = a.instance_id
       WHERE i.slug = ? AND a.lifecycle != 'ARCHIVED'
       AND (a.last_used_at IS NULL OR a.last_used_at < datetime('now', ?))
       ORDER BY a.last_used_at`,
    )
    .all(instanceSlug, `-${Math.max(1, inactiveDays)} days`) as Array<{
    agent_id: string;
    name: string;
    lifecycle: AgentLifecycle;
    last_used_at: string | null;
  }>;
}
