// src/core/repositories/flow-repository.ts
//
// Repository for flow orchestration — CRUD for definitions, run tracking,
// step execution records, and DAG-aware queries.

import type Database from "better-sqlite3";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type FlowStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface FlowDefinitionRow {
  id: number;
  instance_slug: string;
  name: string;
  description: string | null;
  steps_json: string;
  trigger_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface FlowRunRow {
  id: number;
  flow_id: number;
  instance_slug: string;
  status: FlowRunStatus;
  trigger_type: string;
  trigger_detail: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  error: string | null;
}

export interface FlowStepRunRow {
  id: number;
  run_id: number;
  step_id: string;
  agent_id: string;
  status: FlowStepStatus;
  session_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  sitrep_json: string | null;
  result_text: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  error: string | null;
  retry_count: number;
}

export interface CreateFlowDefinitionInput {
  instanceSlug: string;
  name: string;
  description?: string;
  stepsJson: string;
  triggerJson?: string;
  enabled?: boolean;
}

export interface UpdateFlowDefinitionInput {
  name?: string;
  description?: string | null;
  stepsJson?: string;
  triggerJson?: string;
  enabled?: boolean;
}

export interface CreateFlowRunInput {
  flowId: number;
  instanceSlug: string;
  triggerType: string;
  triggerDetail?: string;
}

// ---------------------------------------------------------------------------
// Flow definitions CRUD
// ---------------------------------------------------------------------------

/** Create a flow definition for an instance. */
export function createFlowDefinition(
  db: Database.Database,
  input: CreateFlowDefinitionInput,
): FlowDefinitionRow {
  const result = db
    .prepare(
      `INSERT INTO rt_flow_definitions (instance_slug, name, description, steps_json, trigger_json, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.instanceSlug,
      input.name,
      input.description ?? null,
      input.stepsJson,
      input.triggerJson ?? '{"type":"manual"}',
      input.enabled === false ? 0 : 1,
    );
  return getFlowDefinition(db, Number(result.lastInsertRowid))!;
}

/** Get a single flow definition by id. */
export function getFlowDefinition(
  db: Database.Database,
  id: number,
): FlowDefinitionRow | undefined {
  return db.prepare("SELECT * FROM rt_flow_definitions WHERE id = ?").get(id) as
    | FlowDefinitionRow
    | undefined;
}

/** List flow definitions for an instance. */
export function listFlowDefinitions(db: Database.Database, slug: string): FlowDefinitionRow[] {
  return db
    .prepare("SELECT * FROM rt_flow_definitions WHERE instance_slug = ? ORDER BY created_at ASC")
    .all(slug) as FlowDefinitionRow[];
}

/** Update a flow definition. */
export function updateFlowDefinition(
  db: Database.Database,
  id: number,
  updates: UpdateFlowDefinitionInput,
): FlowDefinitionRow | undefined {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    params.push(updates.description);
  }
  if (updates.stepsJson !== undefined) {
    sets.push("steps_json = ?");
    params.push(updates.stepsJson);
  }
  if (updates.triggerJson !== undefined) {
    sets.push("trigger_json = ?");
    params.push(updates.triggerJson);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(updates.enabled ? 1 : 0);
  }

  if (sets.length === 0) return getFlowDefinition(db, id);

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE rt_flow_definitions SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getFlowDefinition(db, id);
}

/** Delete a flow definition and all its runs (CASCADE). */
export function deleteFlowDefinition(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM rt_flow_definitions WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Flow runs
// ---------------------------------------------------------------------------

/** Create a flow run. */
export function createFlowRun(db: Database.Database, input: CreateFlowRunInput): FlowRunRow {
  const result = db
    .prepare(
      `INSERT INTO rt_flow_runs (flow_id, instance_slug, trigger_type, trigger_detail)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.flowId, input.instanceSlug, input.triggerType, input.triggerDetail ?? null);
  return getFlowRun(db, Number(result.lastInsertRowid))!;
}

/** Get a single flow run by id. */
export function getFlowRun(db: Database.Database, id: number): FlowRunRow | undefined {
  return db.prepare("SELECT * FROM rt_flow_runs WHERE id = ?").get(id) as FlowRunRow | undefined;
}

/** List flow runs, optionally filtered by flow id and/or status. */
export function listFlowRuns(
  db: Database.Database,
  slug: string,
  opts?: { flowId?: number; status?: FlowRunStatus; limit?: number },
): FlowRunRow[] {
  const clauses = ["instance_slug = ?"];
  const params: unknown[] = [slug];

  if (opts?.flowId !== undefined) {
    clauses.push("flow_id = ?");
    params.push(opts.flowId);
  }
  if (opts?.status !== undefined) {
    clauses.push("status = ?");
    params.push(opts.status);
  }

  const limit = opts?.limit ?? 50;
  params.push(limit);

  return db
    .prepare(
      `SELECT * FROM rt_flow_runs WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params) as FlowRunRow[];
}

/** Update flow run status and related timestamps. */
export function updateFlowRunStatus(
  db: Database.Database,
  id: number,
  status: FlowRunStatus,
  error?: string,
): FlowRunRow | undefined {
  const sets = ["status = ?"];
  const params: unknown[] = [status];

  if (status === "running") {
    sets.push("started_at = COALESCE(started_at, datetime('now'))");
  }
  if (status === "completed" || status === "failed" || status === "cancelled") {
    sets.push("finished_at = datetime('now')");
  }
  if (error !== undefined) {
    sets.push("error = ?");
    params.push(error);
  }

  params.push(id);
  db.prepare(`UPDATE rt_flow_runs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getFlowRun(db, id);
}

// ---------------------------------------------------------------------------
// Step runs
// ---------------------------------------------------------------------------

/** Create a step run record. */
export function createStepRun(
  db: Database.Database,
  input: { runId: number; stepId: string; agentId: string },
): FlowStepRunRow {
  const result = db
    .prepare("INSERT INTO rt_flow_step_runs (run_id, step_id, agent_id) VALUES (?, ?, ?)")
    .run(input.runId, input.stepId, input.agentId);
  return db
    .prepare("SELECT * FROM rt_flow_step_runs WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as FlowStepRunRow;
}

/** Update step run fields. */
export function updateStepRun(
  db: Database.Database,
  id: number,
  updates: Partial<{
    status: FlowStepStatus;
    sessionId: string;
    resultText: string;
    sitrepJson: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    error: string;
    retryCount: number;
  }>,
): FlowStepRunRow | undefined {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    params.push(updates.status);
    if (updates.status === "running") {
      sets.push("started_at = COALESCE(started_at, datetime('now'))");
    }
    if (
      updates.status === "completed" ||
      updates.status === "failed" ||
      updates.status === "skipped"
    ) {
      sets.push("finished_at = datetime('now')");
    }
  }
  if (updates.sessionId !== undefined) {
    sets.push("session_id = ?");
    params.push(updates.sessionId);
  }
  if (updates.resultText !== undefined) {
    sets.push("result_text = ?");
    params.push(updates.resultText);
  }
  if (updates.sitrepJson !== undefined) {
    sets.push("sitrep_json = ?");
    params.push(updates.sitrepJson);
  }
  if (updates.tokensIn !== undefined) {
    sets.push("tokens_in = ?");
    params.push(updates.tokensIn);
  }
  if (updates.tokensOut !== undefined) {
    sets.push("tokens_out = ?");
    params.push(updates.tokensOut);
  }
  if (updates.costUsd !== undefined) {
    sets.push("cost_usd = ?");
    params.push(updates.costUsd);
  }
  if (updates.error !== undefined) {
    sets.push("error = ?");
    params.push(updates.error);
  }
  if (updates.retryCount !== undefined) {
    sets.push("retry_count = ?");
    params.push(updates.retryCount);
  }

  if (sets.length === 0) return undefined;

  params.push(id);
  db.prepare(`UPDATE rt_flow_step_runs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return db.prepare("SELECT * FROM rt_flow_step_runs WHERE id = ?").get(id) as
    | FlowStepRunRow
    | undefined;
}

/** Get all step runs for a given flow run. */
export function getStepRunsForRun(db: Database.Database, runId: number): FlowStepRunRow[] {
  return db
    .prepare("SELECT * FROM rt_flow_step_runs WHERE run_id = ? ORDER BY id ASC")
    .all(runId) as FlowStepRunRow[];
}

/** Get a single step run by run id and step id. */
export function getStepRun(
  db: Database.Database,
  runId: number,
  stepId: string,
): FlowStepRunRow | undefined {
  return db
    .prepare("SELECT * FROM rt_flow_step_runs WHERE run_id = ? AND step_id = ?")
    .get(runId, stepId) as FlowStepRunRow | undefined;
}

// ---------------------------------------------------------------------------
// DAG-aware queries
// ---------------------------------------------------------------------------

/**
 * Get steps that are pending and whose dependencies are all in a terminal
 * state suitable for the step to run.
 *
 * For a regular step: every dependency must be `completed` (engine ensures
 * that sitrep outcome=success, because non-success upstreams eagerly mark
 * dependents as `skipped`).
 *
 * For a step with `continueOnFailure: true`: dependencies may be in any
 * terminal state (`completed`, `failed`, `skipped`). This lets trailing
 * `notify` / cleanup steps run whatever happened upstream.
 */
export function getReadySteps(
  db: Database.Database,
  runId: number,
  stepsJson: string,
): FlowStepRunRow[] {
  const stepDefs = JSON.parse(stepsJson) as Array<{
    id: string;
    dependsOn?: string[];
    continueOnFailure?: boolean;
  }>;
  const stepRuns = getStepRunsForRun(db, runId);

  const statusMap = new Map<string, FlowStepStatus>();
  for (const sr of stepRuns) {
    statusMap.set(sr.step_id, sr.status);
  }

  const terminalStatuses: FlowStepStatus[] = ["completed", "failed", "skipped"];

  const readyIds: string[] = [];
  for (const def of stepDefs) {
    if (statusMap.get(def.id) !== "pending") continue;
    const deps = def.dependsOn ?? [];
    const allDepsSatisfied = def.continueOnFailure
      ? deps.every((d) => {
          const s = statusMap.get(d);
          return s !== undefined && terminalStatuses.includes(s);
        })
      : deps.every((d) => statusMap.get(d) === "completed");
    if (allDepsSatisfied) readyIds.push(def.id);
  }

  return stepRuns.filter((sr) => readyIds.includes(sr.step_id));
}

/** Check if all step runs for a flow run are in a terminal state. */
export function allStepsTerminal(db: Database.Database, runId: number): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM rt_flow_step_runs
       WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'skipped')`,
    )
    .get(runId) as { cnt: number };
  return row.cnt === 0;
}

// ---------------------------------------------------------------------------
// Flow sessions (cross-join through runs → step runs → sessions)
// ---------------------------------------------------------------------------

export interface FlowSessionRow {
  id: string;
  agent_id: string;
  state: string;
  label: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  total_tokens: number;
  total_cost_usd: number;
  prompt_loops: number;
}

/** Count distinct sessions linked to a flow definition. */
export function countFlowSessions(db: Database.Database, flowId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT fsr.session_id) AS cnt
       FROM rt_flow_runs fr
       JOIN rt_flow_step_runs fsr ON fsr.run_id = fr.id
       WHERE fr.flow_id = ? AND fsr.session_id IS NOT NULL`,
    )
    .get(flowId) as { cnt: number };
  return row.cnt;
}

/** List sessions linked to a flow, most-recent-first, with message stats. */
export function listFlowSessions(
  db: Database.Database,
  flowId: number,
  opts?: { limit?: number; before?: string },
): { sessions: FlowSessionRow[]; hasMore: boolean } {
  const limit = opts?.limit ?? 30;
  const params: unknown[] = [flowId];

  let cursorClause = "";
  if (opts?.before) {
    cursorClause = "AND s.created_at < ?";
    params.push(opts.before);
  }

  params.push(limit + 1);

  const rows = db
    .prepare(
      `SELECT DISTINCT
         s.id,
         s.agent_id,
         s.state,
         s.label,
         s.created_at,
         s.updated_at,
         COALESCE(stats.message_count, 0) AS message_count,
         COALESCE(stats.total_tokens, 0) AS total_tokens,
         COALESCE(stats.total_cost_usd, 0) AS total_cost_usd,
         COALESCE(stats.prompt_loops, 0) AS prompt_loops
       FROM rt_flow_runs fr
       JOIN rt_flow_step_runs fsr ON fsr.run_id = fr.id
       JOIN rt_sessions s ON s.id = fsr.session_id
       LEFT JOIN (
         SELECT m.session_id,
           COUNT(*) AS message_count,
           SUM(COALESCE(m.tokens_in, 0) + COALESCE(m.tokens_out, 0)) AS total_tokens,
           SUM(COALESCE(m.cost_usd, 0)) AS total_cost_usd,
           SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END) AS prompt_loops
         FROM rt_messages m
         GROUP BY m.session_id
       ) stats ON stats.session_id = s.id
       WHERE fr.flow_id = ?
         AND fsr.session_id IS NOT NULL
         ${cursorClause}
       ORDER BY s.created_at DESC
       LIMIT ?`,
    )
    .all(...params) as FlowSessionRow[];

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  return { sessions: rows, hasMore };
}

/** Check if any step run has failed. */
export function hasFailedSteps(db: Database.Database, runId: number): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS cnt FROM rt_flow_step_runs WHERE run_id = ? AND status = 'failed'")
    .get(runId) as { cnt: number };
  return row.cnt > 0;
}

/**
 * Check whether any completed step has a sitrep outcome other than "success"
 * (i.e., `failure` or `partial`). A completed step whose sitrep is missing or
 * malformed is also treated as unsuccessful, since the engine requires a
 * parseable success marker to consider a step truly successful.
 *
 * This complements `hasFailedSteps()` (which only covers thrown exceptions)
 * to give the engine a complete picture when computing the final run status.
 */
export function hasUnsuccessfulSteps(db: Database.Database, runId: number): boolean {
  const rows = db
    .prepare(
      "SELECT step_id, sitrep_json FROM rt_flow_step_runs WHERE run_id = ? AND status = 'completed'",
    )
    .all(runId) as Array<{ step_id: string; sitrep_json: string | null }>;
  for (const row of rows) {
    if (!row.sitrep_json) return true;
    let outcome: string | undefined;
    try {
      outcome = (JSON.parse(row.sitrep_json) as { outcome?: string }).outcome;
    } catch (err) {
      logger.debug("flow_sitrep_parse_failed_in_aggregation", {
        runId,
        stepId: row.step_id,
        error: String(err),
      });
      return true;
    }
    if (outcome !== "success") return true;
  }
  return false;
}
