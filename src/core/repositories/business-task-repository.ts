import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { logger } from "../../lib/logger.js";
import { recordAdoptionEvent } from "./adoption-repository.js";

export const BUSINESS_TASK_ORIGINS = [
  "HUMAN_REQUEST",
  "SCHEDULED_WORKFLOW",
  "API_REQUEST",
  "AGENT_DELEGATION",
  "SYSTEM_OPERATION",
] as const;
export type BusinessTaskOrigin = (typeof BUSINESS_TASK_ORIGINS)[number];

export const REVIEW_STATUSES = ["ACCEPTED", "NEEDS_REVISION", "REJECTED", "NOT_EVALUATED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const ARTIFACT_STATES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "ACCEPTED",
  "REJECTED",
  "SUPERSEDED",
] as const;
export type ArtifactState = (typeof ARTIFACT_STATES)[number];

export interface BusinessTaskRow {
  id: string;
  instance_slug: string;
  initiator_user_id: number | null;
  initiator_display: string;
  team_id: string | null;
  use_case_id: string | null;
  objective: string;
  origin: BusinessTaskOrigin;
  parent_business_task_id: string | null;
  outcome: string | null;
  review_status: ReviewStatus;
  cost_usd: number;
  time_saved_minutes: number | null;
  review_effort_minutes: number | null;
  feedback: string | null;
  org_id: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface ArtifactRow {
  id: string;
  instance_slug: string;
  business_task_id: string | null;
  request_id: string | null;
  message_id: string | null;
  title: string;
  artifact_type: string;
  content_ref: string | null;
  state: ArtifactState;
  superseded_by_id: string | null;
  owner_user_id: number | null;
  team_id: string | null;
  metadata_json: string | null;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export function createBusinessTask(
  db: Database.Database,
  input: {
    instanceSlug: string;
    objective: string;
    origin: BusinessTaskOrigin;
    initiatorUserId?: number | undefined;
    initiatorDisplay?: string | undefined;
    teamId?: string | undefined;
    useCaseId?: string | undefined;
    parentBusinessTaskId?: string | undefined;
    outcome?: string | undefined;
  },
): BusinessTaskRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO rt_business_tasks
      (id, instance_slug, initiator_user_id, initiator_display, team_id, use_case_id,
       objective, origin, parent_business_task_id, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.instanceSlug,
    input.initiatorUserId ?? null,
    input.initiatorDisplay?.trim() || "UNKNOWN",
    input.teamId ?? null,
    input.useCaseId ?? null,
    input.objective,
    input.origin,
    input.parentBusinessTaskId ?? null,
    input.outcome ?? null,
  );
  return getBusinessTask(db, id)!;
}

export function getBusinessTask(db: Database.Database, id: string): BusinessTaskRow | undefined {
  return db.prepare("SELECT * FROM rt_business_tasks WHERE id = ?").get(id) as
    | BusinessTaskRow
    | undefined;
}

export function listBusinessTasks(
  db: Database.Database,
  instanceSlug: string,
  options: {
    teamId?: string | undefined;
    origin?: BusinessTaskOrigin | undefined;
    reviewStatus?: ReviewStatus | undefined;
    limit?: number | undefined;
  } = {},
): BusinessTaskRow[] {
  const where = ["instance_slug = ?"];
  const params: unknown[] = [instanceSlug];
  if (options.teamId) {
    where.push("team_id = ?");
    params.push(options.teamId);
  }
  if (options.origin) {
    where.push("origin = ?");
    params.push(options.origin);
  }
  if (options.reviewStatus) {
    where.push("review_status = ?");
    params.push(options.reviewStatus);
  }
  params.push(Math.min(Math.max(options.limit ?? 50, 1), 200));
  return db
    .prepare(
      `SELECT * FROM rt_business_tasks WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(...params) as BusinessTaskRow[];
}

export function completeBusinessTask(
  db: Database.Database,
  id: string,
  outcome?: string,
): BusinessTaskRow | undefined {
  const existing = getBusinessTask(db, id);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE rt_business_tasks SET outcome = COALESCE(?, outcome),
       completed_at = COALESCE(completed_at, datetime('now')), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(outcome ?? null, id);
  syncBusinessTaskCost(db, id);
  const task = getBusinessTask(db, id);
  if (task && !existing.completed_at) {
    recordAdoptionEvent(db, {
      ...(task.initiator_user_id ? { userId: task.initiator_user_id } : {}),
      ...(task.team_id ? { teamId: task.team_id } : {}),
      ...(task.use_case_id ? { useCaseId: task.use_case_id } : {}),
      businessTaskId: task.id,
      origin: task.origin,
      eventName: task.origin === "SCHEDULED_WORKFLOW" ? "AUTOMATION_COMPLETED" : "TASK_COMPLETED",
    });
  }
  return task;
}

export function reviewBusinessTask(
  db: Database.Database,
  id: string,
  input: {
    status: ReviewStatus;
    reviewerUserId?: number | undefined;
    feedback?: string | undefined;
    timeSavedMinutes?: number | undefined;
    reviewEffortMinutes?: number | undefined;
  },
): BusinessTaskRow | undefined {
  const task = getBusinessTask(db, id);
  if (!task) return undefined;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO rt_business_task_reviews
        (business_task_id, reviewer_user_id, status, feedback, time_saved_minutes,
         review_effort_minutes) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.reviewerUserId ?? null,
      input.status,
      input.feedback ?? null,
      input.timeSavedMinutes ?? null,
      input.reviewEffortMinutes ?? null,
    );
    db.prepare(
      `UPDATE rt_business_tasks SET review_status = ?, feedback = ?,
       time_saved_minutes = ?, review_effort_minutes = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      input.status,
      input.feedback ?? null,
      input.timeSavedMinutes ?? null,
      input.reviewEffortMinutes ?? null,
      id,
    );
    if (input.status === "ACCEPTED") {
      const launches = db
        .prepare("SELECT id FROM rt_use_case_launches WHERE business_task_id = ?")
        .all(id) as Array<{ id: string }>;
      const insertEvent = db.prepare(
        `INSERT INTO rt_use_case_events (launch_id, event_name)
         SELECT ?, 'OUTCOME_ACCEPTED' WHERE NOT EXISTS (
           SELECT 1 FROM rt_use_case_events WHERE launch_id = ? AND event_name = 'OUTCOME_ACCEPTED')`,
      );
      for (const launch of launches) insertEvent.run(launch.id, launch.id);
    }
    if (input.status === "ACCEPTED" && task.review_status !== "ACCEPTED") {
      recordAdoptionEvent(db, {
        ...(task.initiator_user_id ? { userId: task.initiator_user_id } : {}),
        ...(task.team_id ? { teamId: task.team_id } : {}),
        ...(task.use_case_id ? { useCaseId: task.use_case_id } : {}),
        businessTaskId: task.id,
        origin: task.origin,
        eventName: "OUTCOME_ACCEPTED",
        ...(input.reviewEffortMinutes !== undefined
          ? { assistedEffortMinutes: input.reviewEffortMinutes }
          : {}),
        ...(input.timeSavedMinutes !== undefined
          ? { reportedTimeSavedMinutes: input.timeSavedMinutes }
          : {}),
      });
    }
  })();
  return getBusinessTask(db, id);
}

export function createArtifact(
  db: Database.Database,
  input: {
    instanceSlug: string;
    title: string;
    artifactType: string;
    businessTaskId?: string | undefined;
    requestId?: string | undefined;
    messageId?: string | undefined;
    contentRef?: string | undefined;
    state?: ArtifactState | undefined;
    ownerUserId?: number | undefined;
    teamId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  },
): ArtifactRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO rt_artifacts
      (id, instance_slug, business_task_id, request_id, message_id, title, artifact_type,
       content_ref, state, owner_user_id, team_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.instanceSlug,
    input.businessTaskId ?? null,
    input.requestId ?? null,
    input.messageId ?? null,
    input.title,
    input.artifactType,
    input.contentRef ?? null,
    input.state ?? "DRAFT",
    input.ownerUserId ?? null,
    input.teamId ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
  );
  return getArtifact(db, id)!;
}

export function getArtifact(db: Database.Database, id: string): ArtifactRow | undefined {
  return db.prepare("SELECT * FROM rt_artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
}

export function transitionArtifact(
  db: Database.Database,
  id: string,
  state: ArtifactState,
  supersededById?: string,
): ArtifactRow | undefined {
  const artifact = getArtifact(db, id);
  if (!artifact) return undefined;
  if (state === "SUPERSEDED" && !supersededById) {
    throw new Error("SUPERSEDED artifacts require supersededById");
  }
  if (supersededById) {
    const replacement = getArtifact(db, supersededById);
    if (!replacement || replacement.instance_slug !== artifact.instance_slug) {
      throw new Error("Replacement artifact must exist in the same instance");
    }
  }
  db.prepare(
    `UPDATE rt_artifacts SET state = ?, superseded_by_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(state, supersededById ?? null, id);
  return getArtifact(db, id);
}

export function listArtifacts(
  db: Database.Database,
  instanceSlug: string,
  options: {
    businessTaskId?: string | undefined;
    teamId?: string | undefined;
    state?: ArtifactState | undefined;
  } = {},
): ArtifactRow[] {
  const where = ["instance_slug = ?"];
  const params: unknown[] = [instanceSlug];
  for (const [column, value] of [
    ["business_task_id", options.businessTaskId],
    ["team_id", options.teamId],
    ["state", options.state],
  ] as const) {
    if (value) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  }
  return db
    .prepare(`SELECT * FROM rt_artifacts WHERE ${where.join(" AND ")} ORDER BY created_at DESC`)
    .all(...params) as ArtifactRow[];
}

export function syncBusinessTaskCost(db: Database.Database, id: string): number {
  const result = db
    .prepare(
      `UPDATE rt_business_tasks SET cost_usd = COALESCE(
        (SELECT SUM(cost_usd) FROM rt_executions WHERE business_task_id = ?), 0),
        updated_at = datetime('now') WHERE id = ?`,
    )
    .run(id, id);
  return result.changes;
}

/** Lift create_artifact tool calls into durable governed artifact rows. */
export function persistMessageArtifacts(
  db: Database.Database,
  input: {
    instanceSlug: string;
    messageId: string;
    requestId?: string | undefined;
    businessTaskId?: string | undefined;
    agentId?: string | undefined;
  },
): ArtifactRow[] {
  const parts = db
    .prepare(
      "SELECT id, type, content, metadata FROM rt_parts WHERE message_id = ? ORDER BY sort_order",
    )
    .all(input.messageId) as Array<{
    id: string;
    type: string;
    content: string | null;
    metadata: string | null;
  }>;
  const artifacts: ArtifactRow[] = [];
  for (const part of parts) {
    if (part.type !== "tool_call") continue;
    let metadata: { toolName?: string; toolCallId?: string; args?: Record<string, unknown> };
    try {
      metadata = JSON.parse(part.metadata ?? "{}") as typeof metadata;
    } catch (err) {
      logger.debug("governed_artifact_metadata_parse_failed", { error: String(err) });
      continue;
    }
    if (metadata.toolName !== "create_artifact") continue;
    const args = metadata.args ?? {};
    const existing = db
      .prepare("SELECT * FROM rt_artifacts WHERE message_id = ? AND content_ref = ?")
      .get(input.messageId, part.id) as ArtifactRow | undefined;
    if (existing) {
      artifacts.push(existing);
      continue;
    }
    artifacts.push(
      createArtifact(db, {
        instanceSlug: input.instanceSlug,
        title: typeof args["title"] === "string" ? args["title"] : "Artifact",
        artifactType: typeof args["artifactType"] === "string" ? args["artifactType"] : "document",
        messageId: input.messageId,
        requestId: input.requestId,
        businessTaskId: input.businessTaskId,
        contentRef: part.id,
        state: "READY_FOR_REVIEW",
        metadata: {
          ...(input.agentId ? { agentId: input.agentId } : {}),
          ...(typeof args["language"] === "string" ? { language: args["language"] } : {}),
        },
      }),
    );
  }
  return artifacts;
}
