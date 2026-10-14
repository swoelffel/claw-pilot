import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  MatchedGrant,
  PermissionChecker,
  PermissionContext,
  PermissionDecision,
} from "../../dashboard/middleware/permission.js";

export const TEAM_ROLES = [
  "PLATFORM_ADMIN",
  "TEAM_ADMIN",
  "WORKFLOW_MAINTAINER",
  "OPERATOR",
  "MEMBER",
  "VIEWER",
] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: number | null;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMembershipRow {
  team_id: string;
  user_id: number;
  role: TeamRole;
  source: "MANUAL" | "SSO_GROUP";
  created_at: string;
  updated_at: string;
}

const ROLE_ACTIONS: Record<TeamRole, readonly string[]> = {
  PLATFORM_ADMIN: ["*"],
  TEAM_ADMIN: ["*"],
  WORKFLOW_MAINTAINER: [
    "flow.*",
    "trigger.*",
    "execution.*",
    "agent.*",
    "use-case.*",
    "artifact.*",
    "business-task.*",
    "instance.read",
    "instance.runtime-*",
    "instance.costs-*",
    "instance.budget-*",
  ],
  OPERATOR: [
    "*.read",
    "*.list",
    "*.counts",
    "*.analytics",
    "flow.run",
    "flow.run-*",
    "trigger.fire",
    "execution.recover",
    "business-task.review",
    "artifact.transition",
  ],
  MEMBER: [
    "*.read",
    "*.list",
    "*.counts",
    "task.*",
    "runtime.chat*",
    "business-task.create",
    "business-task.review",
    "artifact.create",
    "artifact.transition",
    "flow.run",
  ],
  VIEWER: ["*.read", "*.list", "*.counts", "*.analytics", "instance.health"],
};

function patternMatches(pattern: string, action: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === action;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(action);
}

export function createTeam(
  db: Database.Database,
  input: { name: string; description?: string | undefined; ownerUserId?: number | undefined },
): TeamRow {
  const id = randomUUID();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO org_teams (id, name, description, owner_user_id) VALUES (?, ?, ?, ?)`,
    ).run(id, input.name, input.description ?? null, input.ownerUserId ?? null);
    if (input.ownerUserId !== undefined) {
      db.prepare(
        `INSERT INTO org_team_memberships (team_id, user_id, role)
         VALUES (?, ?, 'TEAM_ADMIN')`,
      ).run(id, input.ownerUserId);
      db.prepare(
        `INSERT INTO org_membership_audit
          (team_id, user_id, actor_user_id, new_role, action)
         VALUES (?, ?, ?, 'TEAM_ADMIN', 'ADDED')`,
      ).run(id, input.ownerUserId, input.ownerUserId);
    }
  })();
  return getTeam(db, id)!;
}

export function getTeam(db: Database.Database, id: string): TeamRow | undefined {
  return db.prepare("SELECT * FROM org_teams WHERE id = ?").get(id) as TeamRow | undefined;
}

export function listTeams(db: Database.Database, userId?: number): TeamRow[] {
  if (userId === undefined) {
    return db.prepare("SELECT * FROM org_teams ORDER BY name").all() as TeamRow[];
  }
  return db
    .prepare(
      `SELECT t.* FROM org_teams t JOIN org_team_memberships m ON m.team_id = t.id
       WHERE m.user_id = ? ORDER BY t.name`,
    )
    .all(userId) as TeamRow[];
}

export function setTeamMembership(
  db: Database.Database,
  input: {
    teamId: string;
    userId: number;
    role: TeamRole;
    actorUserId?: number | undefined;
    source?: "MANUAL" | "SSO_GROUP" | undefined;
  },
): TeamMembershipRow {
  const existing = db
    .prepare("SELECT * FROM org_team_memberships WHERE team_id = ? AND user_id = ?")
    .get(input.teamId, input.userId) as TeamMembershipRow | undefined;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO org_team_memberships (team_id, user_id, role, source)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role,
       source = excluded.source, updated_at = datetime('now')`,
    ).run(input.teamId, input.userId, input.role, input.source ?? "MANUAL");
    db.prepare(
      `INSERT INTO org_membership_audit
        (team_id, user_id, actor_user_id, old_role, new_role, action, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.teamId,
      input.userId,
      input.actorUserId ?? null,
      existing?.role ?? null,
      input.role,
      existing ? "ROLE_CHANGED" : "ADDED",
      input.source ?? "MANUAL",
    );
  })();
  return db
    .prepare("SELECT * FROM org_team_memberships WHERE team_id = ? AND user_id = ?")
    .get(input.teamId, input.userId) as TeamMembershipRow;
}

export function removeTeamMembership(
  db: Database.Database,
  teamId: string,
  userId: number,
  actorUserId?: number,
): boolean {
  const existing = db
    .prepare("SELECT * FROM org_team_memberships WHERE team_id = ? AND user_id = ?")
    .get(teamId, userId) as TeamMembershipRow | undefined;
  if (!existing) return false;
  db.transaction(() => {
    db.prepare("DELETE FROM org_team_memberships WHERE team_id = ? AND user_id = ?").run(
      teamId,
      userId,
    );
    db.prepare(
      `INSERT INTO org_membership_audit
        (team_id, user_id, actor_user_id, old_role, action, source)
       VALUES (?, ?, ?, ?, 'REMOVED', ?)`,
    ).run(teamId, userId, actorUserId ?? null, existing.role, existing.source);
  })();
  return true;
}

export function listMemberships(db: Database.Database, teamId: string): TeamMembershipRow[] {
  return db
    .prepare("SELECT * FROM org_team_memberships WHERE team_id = ? ORDER BY user_id")
    .all(teamId) as TeamMembershipRow[];
}

export function previewEffectiveGrant(
  db: Database.Database,
  input: { userId: number; teamId: string; action: string; resourceKind?: string | undefined },
): PermissionDecision {
  const membership = db
    .prepare("SELECT role FROM org_team_memberships WHERE team_id = ? AND user_id = ?")
    .get(input.teamId, input.userId) as { role: TeamRole } | undefined;
  if (!membership) return { allow: false, reason: "User is not a member of the owning team" };

  const explicit = db
    .prepare(
      `SELECT id, action_pattern, resource_kind, effect FROM org_role_grants
       WHERE role = ? AND (team_id = ? OR team_id IS NULL)
         AND (resource_kind = ? OR resource_kind = '*')
       ORDER BY effect = 'DENY' DESC, team_id IS NOT NULL DESC`,
    )
    .all(membership.role, input.teamId, input.resourceKind ?? "*") as Array<{
    id: string;
    action_pattern: string;
    resource_kind: string;
    effect: "ALLOW" | "DENY";
  }>;
  const grant = explicit.find((row) => patternMatches(row.action_pattern, input.action));
  if (grant) {
    const matchedGrant: MatchedGrant = {
      id: grant.id,
      role: membership.role,
      action: grant.action_pattern,
      resource: grant.resource_kind,
      effect: grant.effect === "ALLOW" ? "allow" : "deny",
    };
    return grant.effect === "ALLOW"
      ? { allow: true, matchedGrant }
      : { allow: false, reason: "Explicit team grant denies this action", matchedGrant };
  }

  const pattern = ROLE_ACTIONS[membership.role].find((candidate) =>
    patternMatches(candidate, input.action),
  );
  if (!pattern) {
    return {
      allow: false,
      reason: `Role ${membership.role} does not grant ${input.action}`,
      matchedGrant: { role: membership.role, effect: "deny" },
    };
  }
  return {
    allow: true,
    matchedGrant: {
      role: membership.role,
      action: pattern,
      resource: input.resourceKind ?? "*",
      effect: "allow",
    },
  };
}

function resolveTeamId(db: Database.Database, ctx: PermissionContext): string | undefined {
  const attributeTeam = ctx.attributes?.["teamId"];
  if (typeof attributeTeam === "string" && attributeTeam) return attributeTeam;
  const slug = ctx.attributes?.["slug"];
  if (typeof slug === "string") {
    return (
      (
        db.prepare("SELECT team_id FROM instances WHERE slug = ?").get(slug) as
          | { team_id: string | null }
          | undefined
      )?.team_id ?? undefined
    );
  }
  if (!ctx.resource.id) return undefined;
  const lookups: Record<string, string> = {
    instance: "SELECT team_id FROM instances WHERE slug = ?",
    artifact: "SELECT team_id FROM rt_artifacts WHERE id = ?",
    "business-task": "SELECT team_id FROM rt_business_tasks WHERE id = ?",
    flow: "SELECT team_id FROM rt_flow_definitions WHERE id = ?",
    team: "SELECT id AS team_id FROM org_teams WHERE id = ?",
  };
  const sql = lookups[ctx.resource.kind];
  if (!sql) return undefined;
  return (
    (db.prepare(sql).get(ctx.resource.id) as { team_id: string | null } | undefined)?.team_id ??
    undefined
  );
}

/** Enterprise checker. Registration remains opt-in so Community stays single-admin. */
export class TeamRbacPermissionChecker implements PermissionChecker {
  constructor(private readonly db: Database.Database) {}

  async check(ctx: PermissionContext): Promise<PermissionDecision> {
    if (ctx.user.role === "admin" && ctx.user.source === "bearer") {
      return {
        allow: true,
        matchedGrant: { role: "PLATFORM_ADMIN", action: "*", resource: "*", effect: "allow" },
      };
    }
    const userId = Number(ctx.user.id);
    if (!Number.isSafeInteger(userId))
      return { allow: false, reason: "Unknown enterprise principal" };
    const platformAdmin = this.db
      .prepare(
        `SELECT 1 FROM org_team_memberships WHERE user_id = ? AND role = 'PLATFORM_ADMIN' LIMIT 1`,
      )
      .get(userId);
    if (platformAdmin) {
      return {
        allow: true,
        matchedGrant: { role: "PLATFORM_ADMIN", action: "*", resource: "*", effect: "allow" },
      };
    }
    const teamId = resolveTeamId(this.db, ctx);
    if (!teamId) return { allow: false, reason: "Resource has no team ownership" };
    return previewEffectiveGrant(this.db, {
      userId,
      teamId,
      action: ctx.action,
      resourceKind: ctx.resource.kind,
    });
  }
}

export function previewSsoGroupSync(
  db: Database.Database,
  providerId: string,
  groupKeys: readonly string[],
): Array<{ groupKey: string; teamId: string; role: string; dryRun: boolean }> {
  if (groupKeys.length === 0) return [];
  const placeholders = groupKeys.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT group_key AS groupKey, team_id AS teamId, role, dry_run AS dryRun
       FROM org_sso_group_mappings WHERE provider_id = ? AND enabled = 1
       AND group_key IN (${placeholders})`,
    )
    .all(providerId, ...groupKeys)
    .map((row) => {
      const value = row as { groupKey: string; teamId: string; role: string; dryRun: number };
      return { ...value, dryRun: value.dryRun === 1 };
    });
}
