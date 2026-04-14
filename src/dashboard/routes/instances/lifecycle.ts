// src/dashboard/routes/instances/lifecycle.ts
// Routes: start, stop, restart, health, delete, next-port, POST /api/instances (provision)
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { getInstanceContext } from "../_instance-middleware.js";
import type { WizardAnswers } from "../../../core/config-generator.js";
import { Destroyer } from "../../../core/destroyer.js";
import { Provisioner } from "../../../core/provisioner.js";
import { NamedKeyRepository } from "../../../core/repositories/named-key-repository.js";
import {
  upsertSearchEntry,
  removeSearchEntry,
} from "../../../core/repositories/search-repository.js";
import { deriveWebChatPort } from "../../../lib/platform.js";
import { ClawPilotError, InstanceNotFoundError } from "../../../lib/errors.js";
import { logger } from "../../../lib/logger.js";
import { notifySystemStateChanged } from "../_system-state-notify.js";

// ---------------------------------------------------------------------------
// Extracted route handlers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

/** Validate and parse the provision request body. Returns error response or parsed fields. */
function validateProvisionBody(
  c: HonoContext,
  body: Record<string, unknown>,
): ReturnType<typeof apiError> | { slug: string; defaultModel: string; namedKeyId: number } {
  const { slug, defaultModel, namedKeyId } = body;
  if (
    typeof slug !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(slug) ||
    slug.length < 2 ||
    slug.length > 30
  ) {
    return apiError(
      c,
      400,
      "INVALID_INSTANCE_SLUG",
      "Invalid slug: must be 2-30 lowercase alphanumeric chars with hyphens",
    );
  }
  if (typeof defaultModel !== "string" || !defaultModel) {
    return apiError(c, 400, "FIELD_REQUIRED", "defaultModel is required");
  }
  if (typeof namedKeyId !== "number" || !Number.isInteger(namedKeyId)) {
    return apiError(c, 400, "FIELD_REQUIRED", "namedKeyId is required (integer)");
  }
  return { slug, defaultModel, namedKeyId };
}

/** Handle POST /api/instances — provision a new instance. */
async function handleProvision(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { registry, conn } = deps;
  const server = registry.getLocalServer();
  if (!server) {
    return apiError(
      c,
      500,
      "SERVER_NOT_INIT",
      "Server not initialized. Run claw-pilot init first.",
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch (err) {
    logger.warn("[route:lifecycle] JSON parse failed on instance create", { error: String(err) });
    return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
  }

  const validated = validateProvisionBody(c, body);
  if (validated instanceof Response) return validated;
  const { slug, defaultModel, namedKeyId } = validated;

  const namedKeyRepo = new NamedKeyRepository(deps.db);
  const namedKeyRecord = namedKeyRepo.getById(namedKeyId);
  if (!namedKeyRecord) return apiError(c, 400, "INVALID_KEY", "Named key not found");
  const decryptedApiKey = namedKeyRepo.decryptApiKey(namedKeyId);

  const rawAgents = Array.isArray(body["agents"]) ? body["agents"] : [];
  const agents: WizardAnswers["agents"] =
    rawAgents.length > 0
      ? (rawAgents as Array<{ id: string; name: string; model?: string; isDefault?: boolean }>)
      : [{ id: "pilot", name: "Pilot", isDefault: true }];

  if (!agents.some((a) => a.id === "pilot" || a.isDefault)) {
    agents.unshift({ id: "pilot", name: "Pilot", isDefault: true });
  }

  const answers: WizardAnswers = {
    slug,
    displayName:
      typeof body["displayName"] === "string" && body["displayName"]
        ? body["displayName"]
        : slug.charAt(0).toUpperCase() + slug.slice(1),
    agents,
    defaultModel,
    provider: namedKeyRecord.providerId,
    apiKey: decryptedApiKey,
    telegram: { enabled: false },
    mem0: { enabled: false },
  };

  try {
    const provisioner = new Provisioner(conn, registry);
    const blueprintId = typeof body.blueprintId === "number" ? body.blueprintId : undefined;
    const result = await provisioner.provision(answers, server.id, blueprintId);

    const instance = registry.getInstance(slug);
    if (instance) {
      deps.db
        .prepare("UPDATE instances SET default_named_key_id = ? WHERE id = ?")
        .run(namedKeyId, instance.id);
    }

    upsertSearchEntry(deps.db, {
      entityType: "instance",
      entityId: slug,
      title: answers.displayName || slug,
      subtitle: "stopped",
      routeHash: `/instances/${slug}/builder`,
    });

    notifySystemStateChanged("instance", "create");
    return c.json(result, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Provisioning failed";
    if (
      err instanceof ClawPilotError &&
      (err.code === "NO_EXISTING_INSTANCE" ||
        err.code === "ENV_READ_FAILED" ||
        err.code === "API_KEY_READ_FAILED")
    ) {
      return apiError(c, 400, "PROVISION_FAILED", msg);
    }
    return apiError(c, 500, "PROVISION_FAILED", msg);
  }
}

/** Handle GET /api/instances/:slug/conversations. */
async function handleConversations(c: HonoContext, conn: RouteDeps["conn"]): Promise<Response> {
  const { instance } = getInstanceContext(c);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 100);

  try {
    const runsPath = `${instance.state_dir}/subagents/runs.json`;
    const raw = await conn.readFile(runsPath);
    const data = JSON.parse(raw) as {
      version: number;
      runs: Record<
        string,
        {
          createdAt: number;
          requesterDisplayKey: string;
          childSessionKey: string;
          label?: string;
          task: string;
          endedAt?: number;
          outcome?: string;
        }
      >;
    };

    const entries = Object.values(data.runs ?? {})
      .map((run) => ({
        timestamp: run.createdAt,
        from: run.requesterDisplayKey || "unknown",
        to: run.label || run.childSessionKey || "agent",
        message: run.task || "",
        type: "agent-agent" as const,
        status: run.endedAt ? (run.outcome === "completed" ? "done" : "failed") : "running",
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    return c.json({ entries });
  } catch (err) {
    logger.debug("[route:lifecycle] agent-log read failed", { error: String(err) });
    return c.json({ entries: [] });
  }
}

export function registerLifecycleRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, health, lifecycle, monitor, tokenCache, xdgRuntimeDir } = deps;

  app.get("/api/instances", async (c) => {
    const statuses = await health.checkAll();
    const enriched = await Promise.all(
      statuses.map(async (s) => {
        const instance = registry.getInstance(s.slug);
        const gatewayToken = instance ? await tokenCache.get(s.slug, instance.state_dir) : null;
        return { ...instance, ...s, gatewayToken };
      }),
    );
    return c.json(enriched);
  });

  app.get("/api/instances/:slug", async (c) => {
    const { instance, slug } = getInstanceContext(c);
    const [status, gatewayToken] = await Promise.all([
      health.check(slug),
      tokenCache.get(slug, instance.state_dir),
    ]);
    return c.json({ instance, status, gatewayToken });
  });

  app.get("/api/instances/:slug/health", async (c) => {
    const slug = c.req.param("slug");
    try {
      const status = await health.check(slug);
      return c.json(status);
    } catch (err) {
      return apiError(
        c,
        500,
        "INTERNAL_ERROR",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  });

  app.post("/api/instances/:slug/start", async (c) => {
    const slug = c.req.param("slug");
    monitor.setTransitioning(slug, "starting");
    try {
      await lifecycle.start(slug);
      notifySystemStateChanged("instance", "update");
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "NOT_FOUND", err.message);
      }
      return apiError(
        c,
        500,
        "LIFECYCLE_FAILED",
        err instanceof Error ? err.message : "Start failed",
      );
    } finally {
      monitor.clearTransitioning(slug);
    }
  });

  app.post("/api/instances/:slug/stop", async (c) => {
    const slug = c.req.param("slug");
    // Guard: cannot stop the system instance
    const stopTarget = registry.getInstance(slug);
    if (stopTarget && stopTarget.is_system === 1) {
      return apiError(c, 403, "CANNOT_STOP_SYSTEM", "Cannot stop the system instance");
    }
    monitor.setTransitioning(slug, "stopping");
    try {
      await lifecycle.stop(slug);
      notifySystemStateChanged("instance", "update");
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "NOT_FOUND", err.message);
      }
      return apiError(
        c,
        500,
        "LIFECYCLE_FAILED",
        err instanceof Error ? err.message : "Stop failed",
      );
    } finally {
      monitor.clearTransitioning(slug);
    }
  });

  app.post("/api/instances/:slug/restart", async (c) => {
    const slug = c.req.param("slug");
    monitor.setTransitioning(slug, "starting");
    try {
      await lifecycle.restart(slug);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "NOT_FOUND", err.message);
      }
      return apiError(
        c,
        500,
        "LIFECYCLE_FAILED",
        err instanceof Error ? err.message : "Restart failed",
      );
    } finally {
      monitor.clearTransitioning(slug);
    }
  });

  app.delete("/api/instances/:slug", async (c) => {
    const slug = c.req.param("slug");
    try {
      // Guard: cannot delete the system instance
      const target = registry.getInstance(slug);
      if (target && target.is_system === 1) {
        return apiError(c, 403, "CANNOT_DELETE_SYSTEM", "Cannot delete the system instance");
      }
      const destroyer = new Destroyer(conn, registry, xdgRuntimeDir);
      await destroyer.destroy(slug);
      tokenCache.invalidate(slug);
      removeSearchEntry(deps.db, "instance", slug);
      notifySystemStateChanged("instance", "delete");
      return c.json({ ok: true, slug });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "NOT_FOUND", err.message);
      }
      return apiError(
        c,
        500,
        "DESTROY_FAILED",
        err instanceof Error ? err.message : "Destroy failed",
      );
    }
  });

  // GET /api/next-port — derive port from slug (deterministic, no allocation needed)
  app.get("/api/next-port", (c) => {
    const slug = c.req.query("slug");
    if (slug && /^[a-z][a-z0-9-]*$/.test(slug)) {
      return c.json({ port: deriveWebChatPort(slug) });
    }
    // Fallback: return a default port (slug not yet known)
    return c.json({ port: deriveWebChatPort("default") });
  });

  // POST /api/instances — provision a new instance
  app.post("/api/instances", async (c) => {
    return handleProvision(c, deps);
  });

  // GET /api/instances/:slug/conversations
  app.get("/api/instances/:slug/conversations", async (c) => {
    return handleConversations(c, conn);
  });
}
