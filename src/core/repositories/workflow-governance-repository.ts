import type Database from "better-sqlite3";
import { getFlowDefinition, type FlowDefinitionRow } from "./flow-repository.js";
import { logger } from "../../lib/logger.js";

export type WorkflowLifecycle =
  | "DRAFT"
  | "TESTING"
  | "VALIDATED"
  | "ACTIVE"
  | "PAUSED"
  | "ARCHIVED";

export interface WorkflowValidationIssue {
  code: string;
  resource: string;
  message: string;
}

export interface WorkflowValidationReport {
  valid: boolean;
  checkedAt: string;
  workflowVersion: number;
  checks: {
    instance: boolean;
    agents: boolean;
    schemas: boolean;
    access: boolean;
    tools: boolean;
    connectors: boolean;
    credentials: boolean;
    budget: boolean;
  };
  issues: WorkflowValidationIssue[];
}

export interface GovernedFlowRow extends FlowDefinitionRow {
  team_id: string | null;
  lifecycle: WorkflowLifecycle;
  version: number;
  owner_user_id: number | null;
  validation_status: string;
  validation_report_json: string | null;
  failure_streak: number;
  auto_pause_threshold: number;
  rate_limit_per_hour: number;
}

const TRANSITIONS: Record<WorkflowLifecycle, readonly WorkflowLifecycle[]> = {
  DRAFT: ["TESTING", "ARCHIVED"],
  TESTING: ["DRAFT", "VALIDATED", "ARCHIVED"],
  VALIDATED: ["ACTIVE", "TESTING", "ARCHIVED"],
  ACTIVE: ["PAUSED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "TESTING", "ARCHIVED"],
  ARCHIVED: [],
};

interface WorkflowStepCandidate {
  id?: unknown;
  agentId?: unknown;
  prompt?: unknown;
  dependsOn?: unknown;
}

interface ValidationAgentRow {
  agent_id: string;
  config_json: string | null;
  named_key_id: number | null;
}

function parseWorkflowSteps(
  flow: GovernedFlowRow,
  issues: WorkflowValidationIssue[],
): WorkflowStepCandidate[] {
  try {
    const parsed = JSON.parse(flow.steps_json) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0)
      throw new Error("steps must be a non-empty array");
    return parsed;
  } catch (error) {
    issues.push({
      code: "SCHEMA_INVALID",
      resource: `flow:${flow.id}`,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function validateAgentConfig(
  agent: ValidationAgentRow,
  resource: string,
  issues: WorkflowValidationIssue[],
): boolean {
  if (!agent.config_json) return true;
  try {
    const config = JSON.parse(agent.config_json) as { tools?: unknown };
    const valid =
      config.tools === undefined || Array.isArray(config.tools) || typeof config.tools === "object";
    if (!valid) {
      issues.push({
        code: "TOOLS_INVALID",
        resource,
        message: "Agent tool configuration is invalid",
      });
    }
    return valid;
  } catch (err) {
    logger.debug("workflow_agent_config_parse_failed", { error: String(err) });
    issues.push({
      code: "AGENT_CONFIG_INVALID",
      resource,
      message: "Agent configuration is not valid JSON",
    });
    return false;
  }
}

function validateWorkflowAgents(
  db: Database.Database,
  flow: GovernedFlowRow,
  steps: WorkflowStepCandidate[],
  issues: WorkflowValidationIssue[],
): { toolsValid: boolean; credentialsValid: boolean } {
  const rows = db
    .prepare(
      "SELECT agent_id, config_json, named_key_id FROM agents WHERE instance_id = (SELECT id FROM instances WHERE slug = ?)",
    )
    .all(flow.instance_slug) as ValidationAgentRow[];
  const agents = new Map(rows.map((row) => [row.agent_id, row]));
  let toolsValid = true;
  let credentialsValid = true;
  for (const step of steps) {
    if (
      typeof step.id !== "string" ||
      typeof step.agentId !== "string" ||
      typeof step.prompt !== "string"
    ) {
      issues.push({
        code: "STEP_SCHEMA_INVALID",
        resource: `flow:${flow.id}`,
        message: "Step id, agentId, and prompt are required",
      });
      continue;
    }
    const agent = agents.get(step.agentId);
    if (!agent) {
      issues.push({
        code: "AGENT_MISSING",
        resource: `agent:${step.agentId}`,
        message: "Referenced agent is unresolved or deleted",
      });
      continue;
    }
    toolsValid = validateAgentConfig(agent, `agent:${step.agentId}`, issues) && toolsValid;
    if (agent.named_key_id === null) continue;
    if (!db.prepare("SELECT 1 FROM named_api_keys WHERE id = ?").get(agent.named_key_id)) {
      credentialsValid = false;
      issues.push({
        code: "CREDENTIAL_MISSING",
        resource: `agent:${step.agentId}`,
        message: "Assigned credential was deleted",
      });
    }
  }
  return { toolsValid, credentialsValid };
}

export function validateWorkflow(
  db: Database.Database,
  flowId: number,
  validatorUserId?: number,
): WorkflowValidationReport | undefined {
  const flow = getFlowDefinition(db, flowId) as GovernedFlowRow | undefined;
  if (!flow) return undefined;
  const issues: WorkflowValidationIssue[] = [];
  const instance = db
    .prepare("SELECT runtime_config_json FROM instances WHERE slug = ?")
    .get(flow.instance_slug) as { runtime_config_json: string | null } | undefined;
  if (!instance) {
    issues.push({
      code: "INSTANCE_MISSING",
      resource: flow.instance_slug,
      message: "Instance was deleted",
    });
  }

  const steps = parseWorkflowSteps(flow, issues);
  const { toolsValid, credentialsValid } = validateWorkflowAgents(db, flow, steps, issues);

  const budget = db
    .prepare(
      `SELECT 1 FROM rt_budgets WHERE instance_slug = ? AND enabled = 1
       AND spent_usd >= limit_usd * hard_stop_pct LIMIT 1`,
    )
    .get(flow.instance_slug);
  if (budget) {
    issues.push({
      code: "BUDGET_EXHAUSTED",
      resource: flow.instance_slug,
      message: "Execution budget is exhausted",
    });
  }

  const checks = {
    instance: Boolean(instance),
    agents: !issues.some((issue) => issue.code === "AGENT_MISSING"),
    schemas: !issues.some((issue) => issue.code.includes("SCHEMA")),
    access: Boolean(instance),
    tools: toolsValid,
    connectors: Boolean(instance),
    credentials: credentialsValid,
    budget: !budget,
  };
  const report: WorkflowValidationReport = {
    valid: issues.length === 0,
    checkedAt: new Date().toISOString(),
    workflowVersion: flow.version,
    checks,
    issues,
  };
  db.transaction(() => {
    db.prepare(
      `UPDATE rt_flow_definitions SET validation_status = ?, validation_report_json = ?,
       lifecycle = CASE WHEN ? = 1 AND lifecycle IN ('DRAFT','TESTING') THEN 'VALIDATED' ELSE lifecycle END,
       updated_at = datetime('now') WHERE id = ?`,
    ).run(report.valid ? "VALID" : "INVALID", JSON.stringify(report), report.valid ? 1 : 0, flowId);
    db.prepare(
      `INSERT INTO rt_flow_validation_history
       (flow_id, version, validator_user_id, status, report_json) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      flowId,
      flow.version,
      validatorUserId ?? null,
      report.valid ? "VALID" : "INVALID",
      JSON.stringify(report),
    );
  })();
  return report;
}

export function transitionWorkflow(
  db: Database.Database,
  flowId: number,
  toState: WorkflowLifecycle,
  actorUserId?: number,
  reason?: string,
): GovernedFlowRow | undefined {
  const flow = getFlowDefinition(db, flowId) as GovernedFlowRow | undefined;
  if (!flow) return undefined;
  if (flow.lifecycle === toState) return flow;
  if (!TRANSITIONS[flow.lifecycle].includes(toState)) {
    throw new Error(`Invalid workflow lifecycle transition ${flow.lifecycle} -> ${toState}`);
  }
  if (
    toState === "ACTIVE" &&
    flow.validation_status !== "VALID" &&
    flow.validation_status !== "LEGACY_VALID"
  ) {
    throw new Error("Workflow must pass validation before activation");
  }
  db.transaction(() => {
    db.prepare(
      `UPDATE rt_flow_definitions SET lifecycle = ?, enabled = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(toState, toState === "ACTIVE" ? 1 : 0, flowId);
    db.prepare(
      `INSERT INTO rt_flow_lifecycle_history
       (flow_id, from_state, to_state, actor_user_id, reason) VALUES (?, ?, ?, ?, ?)`,
    ).run(flowId, flow.lifecycle, toState, actorUserId ?? null, reason ?? null);
  })();
  return getFlowDefinition(db, flowId) as GovernedFlowRow;
}

export function canRunWorkflowUnattended(
  db: Database.Database,
  flowId: number,
): { allowed: boolean; reason?: string } {
  const flow = getFlowDefinition(db, flowId) as GovernedFlowRow | undefined;
  if (!flow) return { allowed: false, reason: "Workflow not found" };
  if (flow.lifecycle !== "ACTIVE")
    return { allowed: false, reason: `Workflow is ${flow.lifecycle}` };
  if (flow.validation_status !== "VALID" && flow.validation_status !== "LEGACY_VALID") {
    return { allowed: false, reason: "Workflow validation is stale or invalid" };
  }
  const recentRuns = (
    db
      .prepare(
        `SELECT count(*) AS total FROM rt_flow_runs
       WHERE flow_id = ? AND created_at >= datetime('now', '-1 hour')`,
      )
      .get(flowId) as { total: number }
  ).total;
  if (recentRuns >= flow.rate_limit_per_hour)
    return { allowed: false, reason: "Workflow hourly rate limit reached" };
  return { allowed: true };
}
