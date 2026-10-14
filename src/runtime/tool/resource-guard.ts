import type Database from "better-sqlite3";
import {
  inspectCircuit,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "../../core/repositories/execution-repository.js";
import { logger } from "../../lib/logger.js";

export interface StructuredToolFailure {
  error_code: string;
  retryable: boolean;
  resource: string;
  recommended_action: string;
  remaining_retries: number;
  failure_class: string;
  message: string;
}

export class ToolResourceError extends Error {
  readonly code: string;
  constructor(public readonly failure: StructuredToolFailure) {
    super(JSON.stringify(failure));
    this.name = "ToolResourceError";
    this.code = failure.error_code;
  }
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value =
    (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

export function classifyToolFailure(
  error: unknown,
): Omit<StructuredToolFailure, "resource" | "remaining_retries"> {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code).toUpperCase()
      : "";
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    code === "EACCES" ||
    code === "EPERM" ||
    status === 403 ||
    /\b403\b|access denied|permission denied|forbidden/.test(lower)
  ) {
    return {
      error_code: status === 403 ? "RESOURCE_FORBIDDEN" : "RESOURCE_ACCESS_DENIED",
      retryable: false,
      failure_class: "permission",
      recommended_action:
        "Use an approved resource within the execution identity's existing scope or request access from an administrator.",
      message,
    };
  }
  if (status === 401 || /\b401\b|unauthorized|invalid credential|missing credential/.test(lower)) {
    return {
      error_code: "RESOURCE_AUTHENTICATION_FAILED",
      retryable: false,
      failure_class: "credential",
      recommended_action: "Repair or replace the scoped credential before retrying.",
      message,
    };
  }
  if (code === "ENOENT" || /not found|does not exist|unknown tool/.test(lower)) {
    return {
      error_code: "RESOURCE_NOT_FOUND",
      retryable: false,
      failure_class: "dependency",
      recommended_action:
        "Select an available scoped resource or install/configure the missing dependency.",
      message,
    };
  }
  const retryable =
    status === 429 ||
    (status !== undefined && status >= 500) ||
    /timeout|timed out|temporary|temporarily|connection|rate limit/.test(lower);
  return {
    error_code: retryable ? "RESOURCE_TEMPORARY_FAILURE" : "TOOL_EXECUTION_FAILED",
    retryable,
    failure_class: retryable ? "transient" : "execution",
    recommended_action: retryable
      ? "Retry within the reported allowance; after the circuit opens, wait for its cooldown."
      : "Review the tool input and choose a different approved approach.",
    message,
  };
}

function resourceFromArgs(toolName: string, args: unknown): string {
  if (typeof args !== "object" || args === null) return `tool:${toolName}`;
  const record = args as Record<string, unknown>;
  const candidate =
    record["filePath"] ??
    record["path"] ??
    record["url"] ??
    record["resource"] ??
    record["server"] ??
    record["command"];
  if (typeof candidate !== "string" || candidate.length === 0) return `tool:${toolName}`;
  // Commands may contain secrets. Their executable is sufficient to group failures.
  const safe = toolName === "bash" ? candidate.trim().split(/\s+/, 1)[0] : candidate;
  return `${toolName}:${safe}`;
}

export function toolResourceKey(
  agentId: string,
  identity: string,
  toolName: string,
  args: unknown,
): string {
  return `agent:${agentId}|identity:${identity}|${resourceFromArgs(toolName, args)}`;
}

/** Guard one tool/resource tuple with a persistent, identity-aware circuit breaker. */
export async function executeWithResourceGuard<T>(input: {
  db: Database.Database;
  instanceSlug: string;
  agentId: string;
  identity: string;
  toolName: string;
  args: unknown;
  execute: () => Promise<T>;
}): Promise<T> {
  const resource = toolResourceKey(input.agentId, input.identity, input.toolName, input.args);
  // Some embedders and unit-test harnesses provide a minimal DB adapter. Circuit
  // persistence is fail-open when that optional capability is unavailable.
  let circuit: ReturnType<typeof inspectCircuit>;
  try {
    circuit = inspectCircuit(input.db, input.instanceSlug, resource);
  } catch (error) {
    logger.debug("[resource-guard] circuit inspection unavailable; executing fail-open", {
      resource,
      error: String(error),
    });
    return input.execute();
  }
  if (circuit?.state === "open") {
    throw new ToolResourceError({
      error_code: "RESOURCE_CIRCUIT_OPEN",
      retryable: true,
      resource,
      recommended_action: `Use another approved resource or retry after ${circuit.retry_at ?? "the cooldown"}.`,
      remaining_retries: 0,
      failure_class: "circuit_open",
      message: circuit.last_error ?? "Resource circuit is open",
    });
  }
  try {
    const result = await input.execute();
    try {
      recordCircuitSuccess(input.db, input.instanceSlug, resource);
    } catch (error) {
      // Tool success must not be converted into failure by diagnostic storage.
      logger.warn("[resource-guard] failed to persist circuit success", {
        resource,
        error: String(error),
      });
    }
    return result;
  } catch (error) {
    if (error instanceof ToolResourceError) throw error;
    const classified = classifyToolFailure(error);
    // Deterministic authorization/dependency failures stop immediately.
    const threshold = classified.retryable ? 3 : 1;
    let updated;
    try {
      updated = recordCircuitFailure(input.db, input.instanceSlug, resource, error, { threshold });
    } catch (persistenceError) {
      logger.warn("[resource-guard] failed to persist circuit failure", {
        resource,
        error: String(persistenceError),
      });
      throw error;
    }
    throw new ToolResourceError({
      ...classified,
      resource,
      remaining_retries: Math.max(0, updated.threshold - updated.failure_count),
    });
  }
}
