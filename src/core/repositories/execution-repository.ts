import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

// cspell:ignore julianday

export type ExecutionStatus =
  | "accepted"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";
export type BusinessOutcome = "useful" | "partial" | "not_useful";
export type CircuitState = "closed" | "open" | "half_open";

export interface ExecutionRow {
  id: string;
  correlation_id: string;
  instance_slug: string;
  session_id: string;
  agent_id: string;
  kind: string;
  source: string;
  status: ExecutionStatus;
  attempt: number;
  max_attempts: number;
  timeout_ms: number;
  task_id: number | null;
  result_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  outcome: BusinessOutcome | null;
  outcome_value: number | null;
  metadata_json: string | null;
  org_id: string | null;
  accepted_at: string;
  started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  request_id: string | null;
  trace_id: string | null;
  parent_execution_id: string | null;
}

export interface CircuitBreakerRow {
  instance_slug: string;
  resource_key: string;
  state: CircuitState;
  failure_count: number;
  threshold: number;
  cooldown_ms: number;
  opened_at: string | null;
  retry_at: string | null;
  last_error: string | null;
  org_id: string | null;
  updated_at: string;
}

export interface CreateExecutionInput {
  instanceSlug: string;
  sessionId: string;
  agentId: string;
  timeoutMs: number;
  correlationId?: string;
  kind?: string;
  source?: string;
  taskId?: number;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
  requestId?: string;
  traceId?: string;
  parentExecutionId?: string;
}

export function createExecution(db: Database.Database, input: CreateExecutionInput): ExecutionRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO rt_executions
      (id, correlation_id, instance_slug, session_id, agent_id, kind, source,
       timeout_ms, task_id, max_attempts, metadata_json, request_id, trace_id, parent_execution_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.correlationId ?? id,
    input.instanceSlug,
    input.sessionId,
    input.agentId,
    input.kind ?? "prompt",
    input.source ?? "runtime",
    input.timeoutMs,
    input.taskId ?? null,
    input.maxAttempts ?? 1,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.requestId ?? null,
    input.traceId ?? input.correlationId ?? id,
    input.parentExecutionId ?? null,
  );
  return getExecution(db, id)!;
}

export function getExecution(db: Database.Database, id: string): ExecutionRow | undefined {
  return db.prepare("SELECT * FROM rt_executions WHERE id = ?").get(id) as ExecutionRow | undefined;
}

export function startExecution(db: Database.Database, id: string): void {
  db.prepare(
    `UPDATE rt_executions SET status = 'running', started_at = datetime('now'),
       heartbeat_at = datetime('now') WHERE id = ? AND status = 'accepted'`,
  ).run(id);
}

export function completeExecution(
  db: Database.Database,
  id: string,
  result: {
    messageId: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  },
): void {
  db.prepare(
    `UPDATE rt_executions SET status = 'succeeded', result_message_id = ?,
       input_tokens = ?, output_tokens = ?, cost_usd = ?, heartbeat_at = datetime('now'),
       completed_at = datetime('now') WHERE id = ? AND status IN ('accepted','running')`,
  ).run(result.messageId, result.inputTokens, result.outputTokens, result.costUsd, id);
}

export function failExecution(
  db: Database.Database,
  id: string,
  error: unknown,
  status: "failed" | "timed_out" | "cancelled" = "failed",
): void {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error && "code" in error ? String(error.code) : null;
  db.prepare(
    `UPDATE rt_executions SET status = ?, error_code = ?, error_message = ?,
       heartbeat_at = datetime('now'), completed_at = datetime('now')
     WHERE id = ? AND status IN ('accepted','running')`,
  ).run(status, code, message.slice(0, 2000), id);
}

export function listExecutions(
  db: Database.Database,
  instanceSlug: string,
  options: { status?: ExecutionStatus; limit?: number } = {},
): ExecutionRow[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  if (options.status) {
    return db
      .prepare(
        `SELECT * FROM rt_executions WHERE instance_slug = ? AND status = ?
         ORDER BY accepted_at DESC, rowid DESC LIMIT ?`,
      )
      .all(instanceSlug, options.status, limit) as ExecutionRow[];
  }
  return db
    .prepare(
      `SELECT * FROM rt_executions WHERE instance_slug = ?
       ORDER BY accepted_at DESC, rowid DESC LIMIT ?`,
    )
    .all(instanceSlug, limit) as ExecutionRow[];
}

/** Mark running executions with an expired heartbeat as timed out. */
export function recoverStaleExecutions(
  db: Database.Database,
  instanceSlug: string,
  graceMs = 30_000,
): number {
  const result = db
    .prepare(
      `UPDATE rt_executions SET status = 'timed_out', error_code = 'EXECUTION_STALE',
         error_message = 'Execution heartbeat expired before completion', completed_at = datetime('now')
       WHERE instance_slug = ? AND status = 'running'
         AND ((julianday('now') - julianday(COALESCE(heartbeat_at, started_at, accepted_at))) * 86400000)
             > (timeout_ms + ?)`,
    )
    .run(instanceSlug, graceMs);
  return result.changes;
}

export function recordBusinessOutcome(
  db: Database.Database,
  id: string,
  outcome: BusinessOutcome,
  value?: number,
): ExecutionRow | undefined {
  db.prepare(
    `UPDATE rt_executions SET outcome = ?, outcome_value = ?
     WHERE id = ? AND status = 'succeeded'`,
  ).run(outcome, value ?? null, id);
  return getExecution(db, id);
}

export function getExecutionAnalytics(
  db: Database.Database,
  instanceSlug: string,
  days = 30,
): Record<string, number> {
  return db
    .prepare(
      `SELECT count(*) AS total,
        sum(status = 'succeeded') AS succeeded,
        sum(status = 'failed') AS failed,
        sum(status = 'timed_out') AS timed_out,
        sum(outcome = 'useful') AS useful,
        coalesce(sum(cost_usd), 0) AS cost_usd,
        coalesce(sum(outcome_value), 0) AS outcome_value,
        coalesce(avg(CASE WHEN completed_at IS NOT NULL
          THEN (julianday(completed_at) - julianday(accepted_at)) * 86400000 END), 0) AS avg_duration_ms
       FROM rt_executions WHERE instance_slug = ?
         AND accepted_at >= datetime('now', '-' || ? || ' days')`,
    )
    .get(instanceSlug, days) as Record<string, number>;
}

export function getCircuit(
  db: Database.Database,
  instanceSlug: string,
  resourceKey: string,
): CircuitBreakerRow | undefined {
  return db
    .prepare("SELECT * FROM rt_circuit_breakers WHERE instance_slug = ? AND resource_key = ?")
    .get(instanceSlug, resourceKey) as CircuitBreakerRow | undefined;
}

/** Return the effective circuit state, transitioning an elapsed open circuit to half-open. */
export function inspectCircuit(
  db: Database.Database,
  instanceSlug: string,
  resourceKey: string,
): CircuitBreakerRow | undefined {
  const row = getCircuit(db, instanceSlug, resourceKey);
  if (
    row?.state === "open" &&
    row.retry_at &&
    new Date(`${row.retry_at.replace(" ", "T")}Z`).getTime() <= Date.now()
  ) {
    db.prepare(
      `UPDATE rt_circuit_breakers SET state = 'half_open', updated_at = datetime('now')
       WHERE instance_slug = ? AND resource_key = ?`,
    ).run(instanceSlug, resourceKey);
    return getCircuit(db, instanceSlug, resourceKey);
  }
  return row;
}

export function recordCircuitFailure(
  db: Database.Database,
  instanceSlug: string,
  resourceKey: string,
  error: unknown,
  options: { threshold?: number; cooldownMs?: number } = {},
): CircuitBreakerRow {
  const threshold = options.threshold ?? 3;
  const cooldownMs = options.cooldownMs ?? 60_000;
  const message = error instanceof Error ? error.message : String(error);
  db.prepare(
    `INSERT INTO rt_circuit_breakers
       (instance_slug, resource_key, failure_count, threshold, cooldown_ms, last_error)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT(instance_slug, resource_key) DO UPDATE SET
       failure_count = failure_count + 1, threshold = excluded.threshold,
       cooldown_ms = excluded.cooldown_ms, last_error = excluded.last_error,
       updated_at = datetime('now')`,
  ).run(instanceSlug, resourceKey, threshold, cooldownMs, message.slice(0, 1000));
  db.prepare(
    `UPDATE rt_circuit_breakers SET state = 'open', opened_at = datetime('now'),
       retry_at = datetime('now', '+' || (cooldown_ms / 1000.0) || ' seconds'), updated_at = datetime('now')
     WHERE instance_slug = ? AND resource_key = ? AND failure_count >= threshold`,
  ).run(instanceSlug, resourceKey);
  return getCircuit(db, instanceSlug, resourceKey)!;
}

export function recordCircuitSuccess(
  db: Database.Database,
  instanceSlug: string,
  resourceKey: string,
): void {
  db.prepare(
    `INSERT INTO rt_circuit_breakers (instance_slug, resource_key)
     VALUES (?, ?) ON CONFLICT(instance_slug, resource_key) DO UPDATE SET
       state = 'closed', failure_count = 0, opened_at = NULL, retry_at = NULL,
       last_error = NULL, updated_at = datetime('now')`,
  ).run(instanceSlug, resourceKey);
}
