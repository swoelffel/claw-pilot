import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type Database from "better-sqlite3";
import type { AuthenticatedUser } from "../../middleware/permission.js";
import type { RuntimeAgentConfig, RuntimeConfig } from "../../../runtime/config/index.js";
import { TOOL_PROFILES } from "../../../runtime/tool/registry.js";
import { evaluateRuleset } from "../../../runtime/permission/index.js";
import { checkBudgets } from "../../../core/repositories/budget-repository.js";
import { logger } from "../../../lib/logger.js";
import { getCircuit, inspectCircuit } from "../../../core/repositories/execution-repository.js";

type PreflightCheck = {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  resource?: string;
  error_code?: string;
  recommended_action?: string;
};

function executableAvailable(command: string): boolean {
  const candidates = isAbsolute(command)
    ? [command]
    : (process.env["PATH"] ?? "").split(delimiter).map((dir) => join(dir, command));
  return candidates.some((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch (error) {
      logger.debug("[preflight] connector executable is unavailable", {
        command,
        candidate,
        error: String(error),
      });
      return false;
    }
  });
}

function workspaceCheck(workDir: string): PreflightCheck {
  try {
    accessSync(workDir, constants.R_OK | constants.W_OK);
    return {
      id: "filesystem",
      status: "pass",
      detail: "Workspace is readable and writable",
      resource: workDir,
    };
  } catch (error) {
    logger.debug("[preflight] workspace access check failed", {
      workDir,
      error: String(error),
    });
    return {
      id: "filesystem",
      status: "fail",
      detail: "Workspace is not readable and writable",
      resource: workDir,
      error_code: "RESOURCE_ACCESS_DENIED",
      recommended_action:
        "Repair workspace ownership or select an approved readable/writable workspace.",
    };
  }
}

function toolChecks(
  agent: RuntimeAgentConfig,
  requestedTool?: string,
  requestedResource?: string,
  workDir?: string,
): PreflightCheck[] {
  const tools =
    agent.toolProfile === "custom"
      ? (agent.customTools ?? [])
      : (TOOL_PROFILES[agent.toolProfile ?? "executor"] ?? []);
  const checks: PreflightCheck[] = [];
  if (!requestedTool)
    checks.push({ id: "tools", status: "pass", detail: `${tools.length} approved tool(s)` });
  else if (tools.includes(requestedTool))
    checks.push({
      id: "tool",
      status: "pass",
      detail: `${requestedTool} is enabled`,
      resource: `tool:${requestedTool}`,
    });
  else
    checks.push({
      id: "tool",
      status: "fail",
      detail: `${requestedTool} is not enabled for this agent`,
      resource: `tool:${requestedTool}`,
      error_code: "TOOL_NOT_ALLOWED",
      recommended_action: `Use one of the approved tools: ${tools.join(", ") || "none"}.`,
    });

  if (requestedTool && requestedResource) {
    const decision = evaluateRuleset(agent.permissions, requestedTool, requestedResource);
    checks.push(
      decision.action === "deny"
        ? {
            id: "permission",
            status: "fail",
            detail: `${requestedTool} is denied for the requested resource`,
            resource: requestedResource,
            error_code: "RESOURCE_FORBIDDEN",
            recommended_action: `Use the approved workspace ${workDir} without widening privileges.`,
          }
        : {
            id: "permission",
            status: decision.action === "ask" ? "warn" : "pass",
            detail: `${requestedTool}: ${decision.action}`,
            resource: requestedResource,
            ...(decision.action === "ask"
              ? { recommended_action: "Obtain approval before execution." }
              : {}),
          },
    );
  }
  return checks;
}

function connectorChecks(config: RuntimeConfig): PreflightCheck[] {
  const enabled = config.mcpEnabled ? config.mcpServers.filter((server) => server.enabled) : [];
  const checks: PreflightCheck[] = [
    {
      id: "connectors",
      status: config.mcpEnabled && enabled.length === 0 ? "warn" : "pass",
      detail: config.mcpEnabled
        ? `${enabled.length} enabled MCP connector(s)`
        : "MCP connectors disabled",
    },
  ];
  for (const server of enabled) {
    if (server.type === "local" && !executableAvailable(server.command))
      checks.push({
        id: `dependency:${server.id}`,
        status: "fail",
        detail: `Executable ${server.command} is unavailable`,
        resource: `connector:${server.id}`,
        error_code: "DEPENDENCY_MISSING",
        recommended_action: "Install the connector executable or disable this connector.",
      });
    else if (server.type === "remote" && Object.keys(server.headers ?? {}).length === 0)
      checks.push({
        id: `credential:${server.id}`,
        status: "warn",
        detail: "No connector-specific credential headers configured",
        resource: `connector:${server.id}`,
        recommended_action:
          "Configure a scoped connector credential if the endpoint requires authentication.",
      });
    else
      checks.push({
        id: `dependency:${server.id}`,
        status: "pass",
        detail: `${server.type} connector configured`,
        resource: `connector:${server.id}`,
      });
  }
  return checks;
}

function requestedFileCheck(resource: string | undefined, workDir: string): PreflightCheck[] {
  if (!resource) return [];
  const target = isAbsolute(resource) ? resource : resolve(workDir, resource);
  if (!existsSync(target)) return [];
  try {
    accessSync(target, constants.R_OK);
    return [];
  } catch (error) {
    logger.debug("[preflight] requested resource access check failed", {
      resource: target,
      error: String(error),
    });
    return [
      {
        id: "resource-access",
        status: "fail",
        detail: "Requested resource is not readable",
        resource: target,
        error_code: "RESOURCE_ACCESS_DENIED",
        recommended_action: `Use an approved readable source under ${workDir}.`,
      },
    ];
  }
}

export function buildExecutionPreflight(input: {
  db: Database.Database;
  slug: string;
  config: RuntimeConfig;
  agent: RuntimeAgentConfig;
  user: AuthenticatedUser;
  workDir: string;
  requestedTool?: string;
  requestedResource?: string;
}): Record<string, unknown> {
  const { db, slug, config, agent, user, workDir, requestedTool, requestedResource } = input;
  const agentId = agent.id;
  const model = agent.model ?? config.defaultModel ?? "";
  const identity = `${user.source}:${user.id}`;
  const providerCircuit = inspectCircuit(db, slug, `provider:${model}`);
  const budgets = checkBudgets(db, slug, agentId);
  const key = db
    .prepare(
      `SELECT k.id, k.name, k.provider_id FROM instances i LEFT JOIN agents a ON a.instance_id = i.id AND a.agent_id = ? LEFT JOIN named_api_keys k ON k.id = COALESCE(a.named_key_id, i.default_named_key_id) WHERE i.slug = ?`,
    )
    .get(agentId, slug) as
    | { id: number | null; name: string | null; provider_id: string | null }
    | undefined;
  const checks: PreflightCheck[] = [
    { id: "agent", status: "pass", detail: agentId },
    { id: "identity", status: "pass", detail: identity },
    { id: "model", status: model ? "pass" : "fail", detail: model || "No model configured" },
    {
      id: "authentication",
      status: key?.id ? "pass" : "warn",
      detail: key?.id
        ? `Named key ${key.name ?? key.id} (${key.provider_id})`
        : "No named key assigned; runtime environment fallback will be used",
    },
    {
      id: "provider-circuit",
      status: providerCircuit?.state === "open" ? "fail" : "pass",
      detail: providerCircuit?.state ?? "closed",
    },
    {
      id: "budget",
      status: budgets.some((budget) => budget.status === "exceeded") ? "fail" : "pass",
      detail: budgets.length === 0 ? "No enforced budget" : `${budgets.length} budget(s) checked`,
    },
    workspaceCheck(workDir),
    ...toolChecks(agent, requestedTool, requestedResource, workDir),
    ...connectorChecks(config),
    ...requestedFileCheck(requestedResource, workDir),
  ];
  const resourceCircuits = db
    .prepare(
      `SELECT * FROM rt_circuit_breakers WHERE instance_slug = ? AND resource_key LIKE ? AND state != 'closed' ORDER BY updated_at DESC LIMIT 20`,
    )
    .all(slug, `agent:${agentId}|identity:${identity}|%`);
  checks.push(
    resourceCircuits.length > 0
      ? {
          id: "resource-circuits",
          status: "fail",
          detail: `${resourceCircuits.length} resource/tool circuit(s) require attention`,
          error_code: "RESOURCE_CIRCUIT_OPEN",
          recommended_action:
            "Use an approved alternative resource or wait for the circuit cooldown.",
        }
      : { id: "resource-circuits", status: "pass", detail: "No open resource/tool circuits" },
  );
  return {
    ready: !checks.some((check) => check.status === "fail"),
    agentId,
    model,
    identity: { id: user.id, username: user.username, source: user.source },
    checks,
    circuit: getCircuit(db, slug, `provider:${model}`) ?? null,
    resourceCircuits,
    alternatives: requestedResource
      ? [{ kind: "workspace", resource: workDir, scope: "existing-permissions" }]
      : [],
  };
}
