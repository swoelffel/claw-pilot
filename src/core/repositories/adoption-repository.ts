import type Database from "better-sqlite3";

type BusinessTaskOrigin =
  | "HUMAN_REQUEST"
  | "SCHEDULED_WORKFLOW"
  | "API_REQUEST"
  | "AGENT_DELEGATION"
  | "SYSTEM_OPERATION";
type ReviewStatus = "ACCEPTED" | "NEEDS_REVISION" | "REJECTED" | "NOT_EVALUATED";

export interface AdoptionFilters {
  startDate?: string | undefined;
  endDate?: string | undefined;
  teamId?: string | undefined;
  useCaseId?: string | undefined;
  workflowId?: number | undefined;
  origin?: BusinessTaskOrigin | undefined;
  outcome?: ReviewStatus | undefined;
  /** Team ids the caller is authorized to report. Empty means no team data. */
  authorizedTeamIds?: readonly string[];
}

export interface AdoptionMetrics {
  activeHumanUsers: number;
  firstCompletions: number;
  returningUsers: number;
  completedTasks: number;
  acceptedResults: number;
  automationRate: number | null;
  costPerAcceptedTaskUsd: number | null;
  effort: {
    manualMinutes: number | null;
    assistedMinutes: number | null;
    revisions: number | null;
    reportedTimeSavedMinutes: number | null;
  };
  coverage: {
    knownInitiatorPct: number;
    reviewedOutcomePct: number;
    attributedCostPct: number;
    effortReportedPct: number;
  };
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

function buildWhere(filters: AdoptionFilters): { sql: string; params: unknown[] } {
  const where = ["bt.origin NOT IN ('AGENT_DELEGATION','SYSTEM_OPERATION')"];
  const params: unknown[] = [];
  if (filters.startDate) {
    where.push("bt.created_at >= ?");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    where.push("bt.created_at < ?");
    params.push(filters.endDate);
  }
  if (filters.teamId) {
    where.push("bt.team_id = ?");
    params.push(filters.teamId);
  }
  if (filters.useCaseId) {
    where.push("bt.use_case_id = ?");
    params.push(filters.useCaseId);
  }
  if (filters.origin) {
    where.push("bt.origin = ?");
    params.push(filters.origin);
  }
  if (filters.outcome) {
    where.push("bt.review_status = ?");
    params.push(filters.outcome);
  }
  if (filters.workflowId !== undefined) {
    where.push(
      "EXISTS (SELECT 1 FROM rt_flow_runs fr WHERE fr.business_task_id = bt.id AND fr.flow_id = ?)",
    );
    params.push(filters.workflowId);
  }
  if (filters.authorizedTeamIds !== undefined) {
    if (filters.authorizedTeamIds.length === 0) where.push("0 = 1");
    else {
      where.push(`bt.team_id IN (${filters.authorizedTeamIds.map(() => "?").join(",")})`);
      params.push(...filters.authorizedTeamIds);
    }
  }
  return { sql: where.join(" AND "), params };
}

export function getAdoptionMetrics(
  db: Database.Database,
  filters: AdoptionFilters = {},
): AdoptionMetrics {
  const { sql, params } = buildWhere(filters);
  const summary = db
    .prepare(
      `SELECT
       count(*) AS total,
       count(DISTINCT CASE WHEN bt.initiator_user_id IS NOT NULL THEN bt.initiator_user_id END) AS active_users,
       sum(bt.completed_at IS NOT NULL) AS completed,
       sum(bt.review_status = 'ACCEPTED') AS accepted,
       sum(bt.origin = 'SCHEDULED_WORKFLOW' AND bt.completed_at IS NOT NULL) AS automated,
       sum(bt.initiator_user_id IS NOT NULL) AS known_initiator,
       sum(bt.review_status != 'NOT_EVALUATED') AS reviewed,
       sum(bt.time_saved_minutes IS NOT NULL OR bt.review_effort_minutes IS NOT NULL) AS effort_reported,
       sum(bt.time_saved_minutes) AS time_saved,
       sum(bt.review_effort_minutes) AS review_effort
       FROM rt_business_tasks bt WHERE ${sql}`,
    )
    .get(...params) as {
    total: number;
    active_users: number;
    completed: number;
    accepted: number;
    automated: number;
    known_initiator: number;
    reviewed: number;
    effort_reported: number;
    time_saved: number | null;
    review_effort: number | null;
  };

  const firstCompletions = (
    db
      .prepare(
        `SELECT count(*) AS total FROM rt_business_tasks bt WHERE ${sql}
       AND bt.completed_at IS NOT NULL AND bt.initiator_user_id IS NOT NULL
       AND bt.completed_at = (SELECT MIN(first.completed_at) FROM rt_business_tasks first
         WHERE first.initiator_user_id = bt.initiator_user_id AND first.completed_at IS NOT NULL
         AND first.origin NOT IN ('AGENT_DELEGATION','SYSTEM_OPERATION'))`,
      )
      .get(...params) as { total: number }
  ).total;
  const returningUsers = (
    db
      .prepare(
        `SELECT count(*) AS total FROM (
       SELECT bt.initiator_user_id FROM rt_business_tasks bt WHERE ${sql}
       AND bt.initiator_user_id IS NOT NULL
       GROUP BY bt.initiator_user_id HAVING count(DISTINCT date(bt.created_at)) >= 2)`,
      )
      .get(...params) as { total: number }
  ).total;

  const acceptedCost = db
    .prepare(
      `SELECT COALESCE(SUM(ca.amount_usd), 0) AS cost,
       COALESCE(SUM(ca.amount_usd), 0) + COALESCE((SELECT SUM(amount_usd)
         FROM rt_cost_attributions WHERE category = 'UNATTRIBUTED'), 0) AS all_cost
       FROM rt_cost_attributions ca JOIN rt_business_tasks bt ON bt.id = ca.business_task_id
       WHERE ${sql} AND bt.review_status = 'ACCEPTED'`,
    )
    .get(...params) as { cost: number; all_cost: number };
  const effort = db
    .prepare(
      `SELECT SUM(ae.manual_effort_minutes) AS manual_minutes,
       SUM(ae.assisted_effort_minutes) AS assisted_minutes,
       SUM(ae.revision_count) AS revisions,
       SUM(ae.reported_time_saved_minutes) AS time_saved
       FROM rt_adoption_events ae JOIN rt_business_tasks bt ON bt.id = ae.business_task_id
       WHERE ${sql}`,
    )
    .get(...params) as {
    manual_minutes: number | null;
    assisted_minutes: number | null;
    revisions: number | null;
    time_saved: number | null;
  };
  const total = summary.total || 0;
  const completed = summary.completed || 0;
  const accepted = summary.accepted || 0;
  const knownInitiatorPct = total ? (summary.known_initiator || 0) / total : 0;
  const reviewedOutcomePct = total ? (summary.reviewed || 0) / total : 0;
  const effortReportedPct = total ? (summary.effort_reported || 0) / total : 0;
  const attributedCostPct = acceptedCost.all_cost ? acceptedCost.cost / acceptedCost.all_cost : 1;
  const coverageScore = (knownInitiatorPct + reviewedOutcomePct + attributedCostPct) / 3;

  return {
    activeHumanUsers: summary.active_users || 0,
    firstCompletions,
    returningUsers,
    completedTasks: completed,
    acceptedResults: accepted,
    automationRate: completed ? (summary.automated || 0) / completed : null,
    costPerAcceptedTaskUsd: accepted ? acceptedCost.cost / accepted : null,
    effort: {
      manualMinutes: effort.manual_minutes,
      assistedMinutes: effort.assisted_minutes ?? summary.review_effort,
      revisions: effort.revisions,
      reportedTimeSavedMinutes: effort.time_saved ?? summary.time_saved,
    },
    coverage: {
      knownInitiatorPct,
      reviewedOutcomePct,
      attributedCostPct,
      effortReportedPct,
    },
    confidence: coverageScore >= 0.85 ? "HIGH" : coverageScore >= 0.6 ? "MEDIUM" : "LOW",
  };
}

export function listMetricDefinitions(db: Database.Database): Array<Record<string, string | null>> {
  return db.prepare("SELECT * FROM rt_metric_definitions ORDER BY metric_key").all() as Array<
    Record<string, string | null>
  >;
}

export function recordAdoptionEvent(
  db: Database.Database,
  input: {
    userId?: number;
    teamId?: string;
    useCaseId?: string;
    workflowId?: number;
    businessTaskId?: string;
    origin: BusinessTaskOrigin;
    eventName:
      | "FIRST_COMPLETION"
      | "TASK_COMPLETED"
      | "OUTCOME_ACCEPTED"
      | "RETURNED"
      | "AUTOMATION_COMPLETED";
    manualEffortMinutes?: number;
    assistedEffortMinutes?: number;
    revisionCount?: number;
    reportedTimeSavedMinutes?: number;
  },
): void {
  db.prepare(
    `INSERT INTO rt_adoption_events
      (user_id, team_id, use_case_id, workflow_id, business_task_id, origin, event_name,
       manual_effort_minutes, assisted_effort_minutes, revision_count, reported_time_saved_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.userId ?? null,
    input.teamId ?? null,
    input.useCaseId ?? null,
    input.workflowId ?? null,
    input.businessTaskId ?? null,
    input.origin,
    input.eventName,
    input.manualEffortMinutes ?? null,
    input.assistedEffortMinutes ?? null,
    input.revisionCount ?? null,
    input.reportedTimeSavedMinutes ?? null,
  );
}
