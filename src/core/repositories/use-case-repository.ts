import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type UseCaseLifecycle = "DRAFT" | "VALIDATING" | "VALIDATED" | "DEPRECATED" | "ARCHIVED";
export type UseCaseLaunchStatus =
  | "STARTED"
  | "PREREQUISITES_PASSED"
  | "EXECUTED"
  | "COMPLETED"
  | "ABANDONED";
export type UseCaseEventName =
  | "CATALOG_VIEWED"
  | "LAUNCH_STARTED"
  | "SCOPE_DEFINED"
  | "PREREQUISITES_PASSED"
  | "EXECUTION_STARTED"
  | "RESULT_COMPLETED"
  | "OUTCOME_ACCEPTED"
  | "REPEAT_USE";

export interface UseCaseRow {
  id: string;
  name: string;
  description: string;
  owner_user_id: number | null;
  team_id: string | null;
  lifecycle: UseCaseLifecycle;
  current_version: number;
  limitations: string | null;
  troubleshooting: string | null;
  quality_rubric_json: string | null;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UseCaseVersionRow {
  use_case_id: string;
  version: number;
  prompt_template: string;
  output_validation_json: string;
  guidance_json: string;
  prerequisites_json: string;
  examples_json: string;
  created_by_user_id: number | null;
  created_at: string;
}

export interface UseCaseLaunchRow {
  id: string;
  use_case_id: string;
  version: number;
  business_task_id: string | null;
  user_id: number | null;
  team_id: string | null;
  scope_json: string;
  reporting_period_json: string | null;
  output_config_json: string;
  prerequisites_json: string;
  status: UseCaseLaunchStatus;
  created_at: string;
  completed_at: string | null;
}

export function createUseCase(
  db: Database.Database,
  input: {
    name: string;
    description: string;
    promptTemplate: string;
    ownerUserId?: number | undefined;
    teamId?: string | undefined;
    lifecycle?: UseCaseLifecycle | undefined;
    outputValidation?: unknown;
    guidance?: unknown;
    prerequisites?: unknown[] | undefined;
    examples?: unknown[] | undefined;
    limitations?: string | undefined;
    troubleshooting?: string | undefined;
    qualityRubric?: unknown;
  },
): UseCaseRow {
  const id = randomUUID();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO rt_use_cases
        (id, name, description, owner_user_id, team_id, lifecycle, limitations,
         troubleshooting, quality_rubric_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.description,
      input.ownerUserId ?? null,
      input.teamId ?? null,
      input.lifecycle ?? "DRAFT",
      input.limitations ?? null,
      input.troubleshooting ?? null,
      input.qualityRubric === undefined ? null : JSON.stringify(input.qualityRubric),
    );
    db.prepare(
      `INSERT INTO rt_use_case_versions
        (use_case_id, version, prompt_template, output_validation_json, guidance_json,
         prerequisites_json, examples_json, created_by_user_id)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.promptTemplate,
      JSON.stringify(input.outputValidation ?? {}),
      JSON.stringify(input.guidance ?? {}),
      JSON.stringify(input.prerequisites ?? []),
      JSON.stringify(input.examples ?? []),
      input.ownerUserId ?? null,
    );
  })();
  return getUseCase(db, id)!;
}

export function getUseCase(db: Database.Database, id: string): UseCaseRow | undefined {
  return db.prepare("SELECT * FROM rt_use_cases WHERE id = ?").get(id) as UseCaseRow | undefined;
}

export function listUseCases(
  db: Database.Database,
  options: { lifecycle?: UseCaseLifecycle | undefined; teamId?: string | undefined } = {},
): UseCaseRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.lifecycle) {
    where.push("lifecycle = ?");
    params.push(options.lifecycle);
  }
  if (options.teamId) {
    where.push("team_id = ?");
    params.push(options.teamId);
  }
  return db
    .prepare(
      `SELECT * FROM rt_use_cases${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
       ORDER BY name`,
    )
    .all(...params) as UseCaseRow[];
}

export function addUseCaseVersion(
  db: Database.Database,
  id: string,
  input: {
    promptTemplate: string;
    outputValidation?: unknown;
    guidance?: unknown;
    prerequisites?: unknown[] | undefined;
    examples?: unknown[] | undefined;
    createdByUserId?: number | undefined;
  },
): UseCaseVersionRow | undefined {
  const useCase = getUseCase(db, id);
  if (!useCase) return undefined;
  const version = useCase.current_version + 1;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO rt_use_case_versions
        (use_case_id, version, prompt_template, output_validation_json, guidance_json,
         prerequisites_json, examples_json, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      version,
      input.promptTemplate,
      JSON.stringify(input.outputValidation ?? {}),
      JSON.stringify(input.guidance ?? {}),
      JSON.stringify(input.prerequisites ?? []),
      JSON.stringify(input.examples ?? []),
      input.createdByUserId ?? null,
    );
    db.prepare(
      `UPDATE rt_use_cases SET current_version = ?, lifecycle = 'DRAFT',
       updated_at = datetime('now') WHERE id = ?`,
    ).run(version, id);
  })();
  return db
    .prepare("SELECT * FROM rt_use_case_versions WHERE use_case_id = ? AND version = ?")
    .get(id, version) as UseCaseVersionRow;
}

export function setUseCaseLifecycle(
  db: Database.Database,
  id: string,
  lifecycle: UseCaseLifecycle,
): UseCaseRow | undefined {
  db.prepare(
    "UPDATE rt_use_cases SET lifecycle = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(lifecycle, id);
  return getUseCase(db, id);
}

export function startUseCaseLaunch(
  db: Database.Database,
  input: {
    useCaseId: string;
    userId?: number | undefined;
    teamId?: string | undefined;
    scope: Record<string, unknown>;
    reportingPeriod?: unknown;
    outputConfig?: unknown;
    prerequisites?: Record<string, unknown> | undefined;
  },
): UseCaseLaunchRow {
  const useCase = getUseCase(db, input.useCaseId);
  if (!useCase || useCase.lifecycle !== "VALIDATED") {
    throw new Error("Only validated use cases can be launched");
  }
  const id = randomUUID();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO rt_use_case_launches
        (id, use_case_id, version, user_id, team_id, scope_json, reporting_period_json,
         output_config_json, prerequisites_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      useCase.id,
      useCase.current_version,
      input.userId ?? null,
      input.teamId ?? useCase.team_id,
      JSON.stringify(input.scope),
      input.reportingPeriod === undefined ? null : JSON.stringify(input.reportingPeriod),
      JSON.stringify(input.outputConfig ?? {}),
      JSON.stringify(input.prerequisites ?? {}),
    );
    recordUseCaseEvent(db, id, "LAUNCH_STARTED");
    recordUseCaseEvent(db, id, "SCOPE_DEFINED", { scope: input.scope });
    const prior = db
      .prepare(
        `SELECT 1 FROM rt_use_case_launches WHERE use_case_id = ? AND user_id IS ? AND id != ?
         LIMIT 1`,
      )
      .get(useCase.id, input.userId ?? null, id);
    if (prior) recordUseCaseEvent(db, id, "REPEAT_USE");
  })();
  return getUseCaseLaunch(db, id)!;
}

export function getUseCaseLaunch(db: Database.Database, id: string): UseCaseLaunchRow | undefined {
  return db.prepare("SELECT * FROM rt_use_case_launches WHERE id = ?").get(id) as
    | UseCaseLaunchRow
    | undefined;
}

export function updateUseCaseLaunch(
  db: Database.Database,
  id: string,
  input: { status: UseCaseLaunchStatus; businessTaskId?: string | undefined },
): UseCaseLaunchRow | undefined {
  db.prepare(
    `UPDATE rt_use_case_launches SET status = ?,
     business_task_id = COALESCE(?, business_task_id),
     completed_at = CASE WHEN ? IN ('COMPLETED','ABANDONED') THEN datetime('now') ELSE completed_at END
     WHERE id = ?`,
  ).run(input.status, input.businessTaskId ?? null, input.status, id);
  const eventByStatus: Partial<Record<UseCaseLaunchStatus, UseCaseEventName>> = {
    PREREQUISITES_PASSED: "PREREQUISITES_PASSED",
    EXECUTED: "EXECUTION_STARTED",
    COMPLETED: "RESULT_COMPLETED",
  };
  const event = eventByStatus[input.status];
  if (event) recordUseCaseEvent(db, id, event);
  return getUseCaseLaunch(db, id);
}

export function recordUseCaseEvent(
  db: Database.Database,
  launchId: string,
  eventName: UseCaseEventName,
  metadata?: unknown,
): void {
  db.prepare(
    `INSERT INTO rt_use_case_events (launch_id, event_name, metadata_json) VALUES (?, ?, ?)`,
  ).run(launchId, eventName, metadata === undefined ? null : JSON.stringify(metadata));
}

export function getUseCaseFunnel(
  db: Database.Database,
  useCaseId: string,
): Record<UseCaseEventName, number> {
  const rows = db
    .prepare(
      `SELECT e.event_name, count(DISTINCT e.launch_id) AS total
       FROM rt_use_case_events e JOIN rt_use_case_launches l ON l.id = e.launch_id
       WHERE l.use_case_id = ? GROUP BY e.event_name`,
    )
    .all(useCaseId) as Array<{ event_name: UseCaseEventName; total: number }>;
  const result = Object.fromEntries(
    (
      [
        "CATALOG_VIEWED",
        "LAUNCH_STARTED",
        "SCOPE_DEFINED",
        "PREREQUISITES_PASSED",
        "EXECUTION_STARTED",
        "RESULT_COMPLETED",
        "OUTCOME_ACCEPTED",
        "REPEAT_USE",
      ] satisfies UseCaseEventName[]
    ).map((key) => [key, 0]),
  ) as Record<UseCaseEventName, number>;
  for (const row of rows) result[row.event_name] = row.total;
  return result;
}
