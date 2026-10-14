import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { logger } from "../../lib/logger.js";

export type CostPolicyScope = "PLATFORM" | "TEAM" | "INSTANCE" | "WORKFLOW";
export type CostPolicyMode = "MONITOR" | "WARN" | "ENFORCE";

export interface CostAttributionRow {
  id: number;
  request_id: string | null;
  business_task_id: string | null;
  execution_id: string | null;
  agent_id: string | null;
  instance_slug: string | null;
  workflow_id: number | null;
  team_id: string | null;
  category: "ATTRIBUTED" | "UNATTRIBUTED";
  amount_usd: number;
  is_estimate: number;
  provider_id: string | null;
  provider_usage_id: string | null;
  incurred_at: string;
  metadata_json: string | null;
}

export interface CostPolicyRow {
  id: string;
  scope: CostPolicyScope;
  scope_id: string | null;
  owner_user_id: number | null;
  mode: CostPolicyMode;
  period: "DAILY" | "MONTHLY" | "LIFETIME";
  limit_usd: number;
  warning_threshold: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function attributeExecutionCost(
  db: Database.Database,
  executionId: string,
  options: { providerId?: string; providerUsageId?: string; isEstimate?: boolean } = {},
): CostAttributionRow | undefined {
  const execution = db
    .prepare(
      `SELECT e.id, e.request_id, e.business_task_id, e.agent_id, e.instance_slug,
       e.cost_usd, e.metadata_json, COALESCE(bt.team_id, i.team_id) AS team_id
       FROM rt_executions e
       LEFT JOIN rt_business_tasks bt ON bt.id = e.business_task_id
       LEFT JOIN instances i ON i.slug = e.instance_slug WHERE e.id = ?`,
    )
    .get(executionId) as
    | {
        id: string;
        request_id: string | null;
        business_task_id: string | null;
        agent_id: string;
        instance_slug: string;
        cost_usd: number;
        metadata_json: string | null;
        team_id: string | null;
      }
    | undefined;
  if (!execution) return undefined;
  let workflowId: number | null = null;
  if (execution.metadata_json) {
    try {
      const metadata = JSON.parse(execution.metadata_json) as Record<string, unknown>;
      if (typeof metadata["flowId"] === "number") workflowId = metadata["flowId"];
    } catch (err) {
      logger.debug("cost_attribution_metadata_parse_failed", { error: String(err) });
      // Malformed legacy metadata remains attributable to its other dimensions.
    }
  }
  const attributed = Boolean(
    execution.request_id ||
    execution.business_task_id ||
    execution.agent_id ||
    execution.team_id ||
    workflowId,
  );
  db.prepare(
    `INSERT INTO rt_cost_attributions
      (request_id, business_task_id, execution_id, agent_id, instance_slug, workflow_id,
       team_id, category, amount_usd, is_estimate, provider_id, provider_usage_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(execution_id) WHERE execution_id IS NOT NULL DO UPDATE SET amount_usd = excluded.amount_usd,
       is_estimate = excluded.is_estimate, provider_id = excluded.provider_id,
       provider_usage_id = excluded.provider_usage_id`,
  ).run(
    execution.request_id,
    execution.business_task_id,
    execution.id,
    execution.agent_id,
    execution.instance_slug,
    workflowId,
    execution.team_id,
    attributed ? "ATTRIBUTED" : "UNATTRIBUTED",
    Math.max(0, execution.cost_usd),
    options.isEstimate === false ? 0 : 1,
    options.providerId ?? null,
    options.providerUsageId ?? null,
  );
  if (execution.business_task_id) {
    db.prepare(
      `UPDATE rt_business_tasks SET cost_usd = COALESCE(
        (SELECT SUM(amount_usd) FROM rt_cost_attributions WHERE business_task_id = ?), 0),
       updated_at = datetime('now') WHERE id = ?`,
    ).run(execution.business_task_id, execution.business_task_id);
  }
  return db
    .prepare("SELECT * FROM rt_cost_attributions WHERE execution_id = ?")
    .get(executionId) as CostAttributionRow;
}

export function upsertCostPolicy(
  db: Database.Database,
  input: {
    id?: string | undefined;
    scope: CostPolicyScope;
    scopeId?: string | undefined;
    ownerUserId?: number | undefined;
    mode?: CostPolicyMode | undefined;
    period?: "DAILY" | "MONTHLY" | "LIFETIME" | undefined;
    limitUsd: number;
    warningThreshold?: number | undefined;
  },
): CostPolicyRow {
  const id = input.id ?? randomUUID();
  db.prepare(
    `INSERT INTO rt_cost_policies
      (id, scope, scope_id, owner_user_id, mode, period, limit_usd, warning_threshold)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, scope_id, period) DO UPDATE SET owner_user_id = excluded.owner_user_id,
       mode = excluded.mode, limit_usd = excluded.limit_usd,
       warning_threshold = excluded.warning_threshold, updated_at = datetime('now')`,
  ).run(
    id,
    input.scope,
    input.scopeId ?? null,
    input.ownerUserId ?? null,
    input.mode ?? "MONITOR",
    input.period ?? "MONTHLY",
    input.limitUsd,
    input.warningThreshold ?? 0.8,
  );
  return db
    .prepare(`SELECT * FROM rt_cost_policies WHERE scope = ? AND scope_id IS ? AND period = ?`)
    .get(input.scope, input.scopeId ?? null, input.period ?? "MONTHLY") as CostPolicyRow;
}

function periodClause(period: CostPolicyRow["period"]): string {
  if (period === "DAILY") return "AND incurred_at >= datetime('now', 'start of day')";
  if (period === "MONTHLY") return "AND incurred_at >= datetime('now', 'start of month')";
  return "";
}

export function evaluateCostPolicy(
  db: Database.Database,
  policy: CostPolicyRow,
): { spentUsd: number; ratio: number; action: "ALLOW" | "WARN" | "DENY"; estimate: boolean } {
  const filters: Record<CostPolicyScope, { clause: string; value?: unknown }> = {
    PLATFORM: { clause: "1 = 1" },
    TEAM: { clause: "team_id = ?", value: policy.scope_id },
    INSTANCE: { clause: "instance_slug = ?", value: policy.scope_id },
    WORKFLOW: { clause: "workflow_id = ?", value: Number(policy.scope_id) },
  };
  const filter = filters[policy.scope];
  const params = filter.value === undefined ? [] : [filter.value];
  const summary = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS spent, MAX(is_estimate) AS estimate
       FROM rt_cost_attributions WHERE ${filter.clause} ${periodClause(policy.period)}`,
    )
    .get(...params) as { spent: number; estimate: number | null };
  const ratio = summary.spent / policy.limit_usd;
  const action =
    policy.mode === "ENFORCE" && ratio >= 1
      ? "DENY"
      : (policy.mode === "WARN" || policy.mode === "ENFORCE") && ratio >= policy.warning_threshold
        ? "WARN"
        : "ALLOW";
  return { spentUsd: summary.spent, ratio, action, estimate: summary.estimate === 1 };
}

export function listApplicableCostPolicies(
  db: Database.Database,
  input: {
    teamId?: string | undefined;
    instanceSlug?: string | undefined;
    workflowId?: number | undefined;
  },
): Array<CostPolicyRow & ReturnType<typeof evaluateCostPolicy>> {
  const rows = db
    .prepare(
      `SELECT * FROM rt_cost_policies WHERE enabled = 1 AND (
       scope = 'PLATFORM' OR (scope = 'TEAM' AND scope_id = ?) OR
       (scope = 'INSTANCE' AND scope_id = ?) OR (scope = 'WORKFLOW' AND scope_id = ?))`,
    )
    .all(
      input.teamId ?? null,
      input.instanceSlug ?? null,
      input.workflowId?.toString() ?? null,
    ) as CostPolicyRow[];
  return rows.map((row) => ({ ...row, ...evaluateCostPolicy(db, row) }));
}

export function reconcileProviderBilling(
  db: Database.Database,
  input: {
    providerId: string;
    periodStart: string;
    periodEnd: string;
    billedUsd: number;
    sourceRef?: string | undefined;
    importedByUserId?: number | undefined;
  },
): { id: string; applicationUsd: number; varianceUsd: number } {
  const applicationUsd = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) AS total FROM rt_cost_attributions
       WHERE provider_id = ? AND incurred_at >= ? AND incurred_at < ?`,
      )
      .get(input.providerId, input.periodStart, input.periodEnd) as { total: number }
  ).total;
  const id = randomUUID();
  const varianceUsd = input.billedUsd - applicationUsd;
  db.prepare(
    `INSERT INTO rt_provider_billing_imports
      (id, provider_id, period_start, period_end, billed_usd, application_usd,
       variance_usd, source_ref, imported_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.providerId,
    input.periodStart,
    input.periodEnd,
    input.billedUsd,
    applicationUsd,
    varianceUsd,
    input.sourceRef ?? null,
    input.importedByUserId ?? null,
  );
  return { id, applicationUsd, varianceUsd };
}

export function detectCostAnomalies(db: Database.Database): number {
  const candidates = db
    .prepare(
      `SELECT business_task_id, SUM(amount_usd) AS amount FROM rt_cost_attributions
       WHERE business_task_id IS NOT NULL GROUP BY business_task_id
       HAVING amount > COALESCE((SELECT AVG(cost_usd) * 3 FROM rt_business_tasks WHERE cost_usd > 0), 999999)`,
    )
    .all() as Array<{ business_task_id: string; amount: number }>;
  const withoutAcceptedOutcome = db
    .prepare(
      `SELECT ca.business_task_id, SUM(ca.amount_usd) AS amount
       FROM rt_cost_attributions ca JOIN rt_business_tasks bt ON bt.id = ca.business_task_id
       WHERE bt.review_status != 'ACCEPTED' AND ca.business_task_id IS NOT NULL
       GROUP BY ca.business_task_id HAVING amount >= 1`,
    )
    .all() as Array<{ business_task_id: string; amount: number }>;
  const repeatedFailures = db
    .prepare(
      `SELECT flow_id AS scope_id, count(*) AS failures,
       COALESCE(SUM(cost_usd), 0) AS amount FROM rt_flow_runs
       WHERE status = 'failed' AND created_at >= datetime('now', '-24 hours')
       GROUP BY flow_id HAVING failures >= 3`,
    )
    .all() as Array<{ scope_id: number; failures: number; amount: number }>;
  const loops = db
    .prepare(
      `SELECT agent_id AS scope_id, count(*) AS executions, SUM(cost_usd) AS amount
       FROM rt_executions WHERE accepted_at >= datetime('now', '-1 hour')
       GROUP BY agent_id HAVING executions >= 50`,
    )
    .all() as Array<{ scope_id: string; executions: number; amount: number }>;
  const insert = db.prepare(
    `INSERT INTO rt_cost_anomalies
      (anomaly_type, severity, scope, scope_id, amount_usd, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const item of candidates) {
      insert.run(
        "COST_SPIKE",
        "WARNING",
        "BUSINESS_TASK",
        item.business_task_id,
        item.amount,
        "{}",
      );
    }
    for (const item of withoutAcceptedOutcome) {
      insert.run(
        "COST_WITHOUT_ACCEPTED_OUTCOME",
        "WARNING",
        "BUSINESS_TASK",
        item.business_task_id,
        item.amount,
        "{}",
      );
    }
    for (const item of repeatedFailures) {
      insert.run(
        "REPEATED_FAILURES",
        "CRITICAL",
        "WORKFLOW",
        String(item.scope_id),
        item.amount,
        JSON.stringify({ failures: item.failures }),
      );
    }
    for (const item of loops) {
      insert.run(
        "LOOP",
        "CRITICAL",
        "AGENT",
        item.scope_id,
        item.amount,
        JSON.stringify({ executions: item.executions }),
      );
    }
  })();
  return candidates.length + withoutAcceptedOutcome.length + repeatedFailures.length + loops.length;
}
