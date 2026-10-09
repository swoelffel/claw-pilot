import type Database from "better-sqlite3";

export type ActivityKind = "human_request" | "child_agent" | "workflow" | "system";
export type ObservabilityDataClass = "logs" | "metrics" | "traces" | "conversations" | "outcomes";

export interface RecordObservabilityInput {
  instanceSlug: string;
  eventName: string;
  eventKind: "span" | "error" | "metric";
  traceId: string;
  requestId?: string | undefined;
  executionId?: string | undefined;
  sessionId?: string | undefined;
  agentId?: string | undefined;
  activityKind?: ActivityKind | undefined;
  phase?: string | undefined;
  toolName?: string | undefined;
  resource?: string | undefined;
  errorCode?: string | undefined;
  attempt?: number | undefined;
  retryable?: boolean | undefined;
  success?: boolean | undefined;
  durationMs?: number | undefined;
  costUsd?: number | undefined;
  attributes?: Record<string, unknown> | undefined;
}

export function recordObservabilityEvent(
  db: Database.Database,
  input: RecordObservabilityInput,
): void {
  db.prepare(
    `INSERT INTO rt_observability_events
    (instance_slug, event_name, event_kind, trace_id, request_id, execution_id,
     session_id, agent_id, activity_kind, phase, tool_name, resource, error_code,
     attempt, retryable, success, duration_ms, cost_usd, attributes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.instanceSlug,
    input.eventName,
    input.eventKind,
    input.traceId,
    input.requestId ?? null,
    input.executionId ?? null,
    input.sessionId ?? null,
    input.agentId ?? null,
    input.activityKind ?? "human_request",
    input.phase ?? null,
    input.toolName ?? null,
    input.resource ?? null,
    input.errorCode ?? null,
    input.attempt ?? 1,
    input.retryable === undefined ? null : Number(input.retryable),
    input.success === undefined ? null : Number(input.success),
    input.durationMs ?? null,
    input.costUsd ?? null,
    input.attributes ? JSON.stringify(input.attributes) : null,
  );
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  return values[Math.ceil(values.length * fraction) - 1] ?? 0;
}

export function getObservabilityMetrics(
  db: Database.Database,
  instanceSlug: string,
  days = 30,
  activityKind?: ActivityKind,
) {
  const activityClause = activityKind ? " AND activity_kind = ?" : "";
  const args: unknown[] = [instanceSlug, days];
  if (activityKind) args.push(activityKind);
  const durations = db
    .prepare(
      `SELECT duration_ms FROM rt_observability_events
    WHERE instance_slug = ? AND created_at >= datetime('now', '-' || ? || ' days')
      AND duration_ms IS NOT NULL${activityClause} ORDER BY duration_ms ASC`,
    )
    .all(...args) as Array<{ duration_ms: number }>;
  const values = durations.map((row) => row.duration_ms);
  const totals = db
    .prepare(
      `SELECT
      count(*) AS event_count,
      coalesce(sum(event_kind = 'error'), 0) AS error_count,
      coalesce(sum(event_name = 'delivery.failed'), 0) AS delivery_failures,
      coalesce(sum(event_name LIKE '%timeout%'), 0) AS timeouts,
      coalesce(sum(event_name LIKE '%recover%'), 0) AS recoveries,
      coalesce(sum(event_name = 'permission.denied'), 0) AS permission_denials,
      coalesce(sum(event_name LIKE 'workflow.%'), 0) AS workflow_events,
      coalesce(sum(cost_usd), 0) AS attributed_cost_usd
    FROM rt_observability_events WHERE instance_slug = ?
      AND created_at >= datetime('now', '-' || ? || ' days')${activityClause}`,
    )
    .get(...args) as {
    event_count: number;
    error_count: number;
    delivery_failures: number;
    timeouts: number;
    recoveries: number;
    permission_denials: number;
    workflow_events: number;
    attributed_cost_usd: number;
  };
  return {
    ...totals,
    latency_ms: {
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
    },
  };
}

export function listTrace(db: Database.Database, instanceSlug: string, traceId: string) {
  return db
    .prepare(
      `SELECT * FROM rt_observability_events
    WHERE instance_slug = ? AND trace_id = ? ORDER BY id ASC`,
    )
    .all(instanceSlug, traceId);
}

export function getRetention(db: Database.Database, instanceSlug: string) {
  const defaults: Record<ObservabilityDataClass, number> = {
    logs: 30,
    metrics: 395,
    traces: 30,
    conversations: 90,
    outcomes: 730,
  };
  const rows = db
    .prepare(
      `SELECT data_class, retention_days FROM rt_observability_retention
    WHERE instance_slug = ?`,
    )
    .all(instanceSlug) as Array<{ data_class: ObservabilityDataClass; retention_days: number }>;
  for (const row of rows) defaults[row.data_class] = row.retention_days;
  return defaults;
}

export function setRetention(
  db: Database.Database,
  instanceSlug: string,
  policies: Partial<Record<ObservabilityDataClass, number>>,
): void {
  const stmt = db.prepare(`INSERT INTO rt_observability_retention
    (instance_slug, data_class, retention_days) VALUES (?, ?, ?)
    ON CONFLICT(instance_slug, data_class) DO UPDATE SET
      retention_days = excluded.retention_days, updated_at = datetime('now')`);
  db.transaction(() => {
    for (const [dataClass, days] of Object.entries(policies))
      stmt.run(instanceSlug, dataClass, days);
  })();
}

export function getActiveAlerts(db: Database.Database, instanceSlug: string, hours = 24) {
  const rows = db
    .prepare(
      `SELECT event_name, coalesce(tool_name, resource, error_code, '') AS dimension,
      count(*) AS count, max(created_at) AS last_seen
    FROM rt_observability_events WHERE instance_slug = ?
      AND created_at >= datetime('now', '-' || ? || ' hours')
      AND (event_kind = 'error' OR event_name IN ('budget.soft_alert','budget.hard_stop'))
    GROUP BY event_name, dimension`,
    )
    .all(instanceSlug, hours) as Array<Record<string, unknown>>;
  return rows.filter((row) => {
    const count = Number(row.count);
    return (
      row.event_name === "delivery.failed" ||
      row.event_name === "permission.denied" ||
      row.event_name === "budget.hard_stop" ||
      row.event_name === "budget.soft_alert" ||
      count >= 3
    );
  });
}
