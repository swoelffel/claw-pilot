// src/dashboard/routes/instances/lifecycle.ts
// Routes: start, stop, restart, health, delete, next-port, POST /api/instances (provision)
import type { Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { instanceGuard } from "../../../lib/guards.js";
import type { WizardAnswers } from "../../../core/config-generator.js";
import { Destroyer } from "../../../core/destroyer.js";
import { Provisioner } from "../../../core/provisioner.js";
import { PortAllocator } from "../../../core/port-allocator.js";
import { PairingManager } from "../../../core/pairing.js";
import { ClawPilotError, InstanceNotFoundError } from "../../../lib/errors.js";

export function registerLifecycleRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, health, lifecycle, tokenCache, xdgRuntimeDir } = deps;

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
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;
    const [status, gatewayToken] = await Promise.all([
      health.check(slug),
      tokenCache.get(slug, instance!.state_dir),
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
    try {
      await lifecycle.start(slug);
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
    }
  });

  app.post("/api/instances/:slug/stop", async (c) => {
    const slug = c.req.param("slug");
    try {
      await lifecycle.stop(slug);
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
    }
  });

  app.post("/api/instances/:slug/restart", async (c) => {
    const slug = c.req.param("slug");
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
    }
  });

  app.delete("/api/instances/:slug", async (c) => {
    const slug = c.req.param("slug");
    try {
      const portAllocator = new PortAllocator(registry, conn);
      const destroyer = new Destroyer(conn, registry, xdgRuntimeDir, portAllocator);
      await destroyer.destroy(slug);
      tokenCache.invalidate(slug);
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

  // GET /api/next-port — suggest next free port in the configured range
  app.get("/api/next-port", async (c) => {
    const server = registry.getLocalServer();
    if (!server)
      return apiError(
        c,
        500,
        "SERVER_NOT_INIT",
        "Server not initialized. Run claw-pilot init first.",
      );
    try {
      const portAllocator = new PortAllocator(registry, conn);
      const nextPort = await portAllocator.findFreePort(server.id);
      return c.json({ port: nextPort });
    } catch (err) {
      return apiError(
        c,
        500,
        "INTERNAL_ERROR",
        err instanceof Error ? err.message : "No free port available",
      );
    }
  });

  // POST /api/instances — provision a new instance
  app.post("/api/instances", async (c) => {
    const server = registry.getLocalServer();
    if (!server)
      return apiError(
        c,
        500,
        "SERVER_NOT_INIT",
        "Server not initialized. Run claw-pilot init first.",
      );

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }

    const slug = body["slug"];
    const port = body["port"];
    const defaultModel = body["defaultModel"];
    const provider = body["provider"];
    const apiKey = body["apiKey"];

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
    if (typeof port !== "number" || port < 1024 || port > 65535) {
      return apiError(c, 400, "FIELD_INVALID", "Invalid port: must be 1024-65535");
    }
    if (typeof defaultModel !== "string" || !defaultModel) {
      return apiError(c, 400, "FIELD_REQUIRED", "defaultModel is required");
    }
    if (typeof provider !== "string" || !provider) {
      return apiError(c, 400, "FIELD_REQUIRED", "provider is required");
    }
    if (typeof apiKey !== "string") {
      return apiError(
        c,
        400,
        "FIELD_INVALID",
        "apiKey must be a string (use '' for providers that need no key)",
      );
    }

    const rawAgents = Array.isArray(body["agents"]) ? body["agents"] : [];
    const agents: WizardAnswers["agents"] =
      rawAgents.length > 0
        ? (rawAgents as Array<{ id: string; name: string; model?: string; isDefault?: boolean }>)
        : [{ id: "main", name: "Main", isDefault: true }];

    if (!agents.some((a) => a.id === "main" || a.isDefault)) {
      agents.unshift({ id: "main", name: "Main", isDefault: true });
    }

    const answers: WizardAnswers = {
      slug,
      displayName:
        typeof body["displayName"] === "string" && body["displayName"]
          ? body["displayName"]
          : slug.charAt(0).toUpperCase() + slug.slice(1),
      port,
      agents,
      defaultModel,
      provider,
      apiKey,
      telegram: { enabled: false },
      mem0: { enabled: false },
    };

    try {
      const portAllocator = new PortAllocator(registry, conn);
      const provisioner = new Provisioner(conn, registry, portAllocator);
      const blueprintId = typeof body.blueprintId === "number" ? body.blueprintId : undefined;
      const result = await provisioner.provision(answers, server.id, blueprintId);

      try {
        const pairing = new PairingManager(conn, registry);
        await pairing.bootstrapDevicePairing(slug as string);
      } catch {
        // Pairing is best-effort — don't fail the whole request
      }

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
  });

  // GET /api/instances/:slug/conversations
  app.get("/api/instances/:slug/conversations", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 100);

    try {
      const runsPath = `${instance!.state_dir}/subagents/runs.json`;
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
    } catch {
      return c.json({ entries: [] });
    }
  });
}
