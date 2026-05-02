// src/dashboard/server.ts
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import type { Server as HttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import type { Registry } from "../core/registry.js";
import type { ServerConnection } from "../server/connection.js";
import { HealthChecker } from "../core/health.js";
import { Lifecycle } from "../core/lifecycle.js";
import { Monitor } from "./monitor.js";
import { resolveXdgRuntimeDir } from "../lib/xdg.js";
import { SelfUpdateChecker } from "../core/self-update-checker.js";
import { SelfUpdater } from "../core/self-updater.js";
import { createRateLimiter } from "./rate-limit.js";
import { requestIdMiddleware } from "./request-id.js";
import { TokenCache } from "./token-cache.js";
import { SessionStore } from "./session-store.js";
import { constants } from "../lib/constants.js";
import { apiError } from "./route-deps.js";
import type { RouteDeps } from "./route-deps.js";
import { ClawPilotError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { registerInstanceRoutes } from "./routes/instances.js";
import { registerBlueprintRoutes } from "./routes/blueprints.js";
import { registerTeamRoutes } from "./routes/teams.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerAuthRoutes } from "./routes/auth.js";
import {
  PasswordProvider,
  registerAuthProvider,
  unregisterAuthProvider,
} from "../core/auth/index.js";
import { registerAgentBlueprintRoutes } from "./routes/agent-blueprints.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerNamedKeyRoutes } from "./routes/named-keys.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerFlowRoutes } from "./routes/instances/flows.js";
import { registerSystemInstanceRoutes } from "./routes/system-instance.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { TriggerScheduler } from "../runtime/triggers/scheduler.js";
import { registerTriggerContextProvider } from "../runtime/triggers/context-provider.js";
import { callRuntimeApi } from "./routes/_internal-api-client.js";
import { pruneNotifications } from "../core/repositories/notification-repository.js";
import { SystemInstanceService } from "../core/system-instance.js";
import { rebuildSearchIndex } from "../core/repositories/search-repository.js";
import { ModelDiscoveryService } from "../core/model-discovery/service.js";
import type { AuthenticatedUser } from "./middleware/permission.js";

/** Result returned by buildDashboardApp — contains the wired Hono app and cleanup helpers. */
export interface DashboardAppResult {
  app: Hono;
  deps: RouteDeps;
  /** Monitor instance — used by startDashboard to wire the WebSocket server. */
  monitor: Monitor;
  /** Call this to clear the session cleanup interval and stop the monitor. */
  cleanup: () => void;
}

// Resolve dist/ui/ relative to this bundle chunk.
// When bundled: this file is at <install>/dist/server-*.mjs
// so __dirname = <install>/dist/ and UI_DIST = <install>/dist/ui/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST = process.env["CLAW_PILOT_UI_DIST"] ?? path.resolve(__dirname, "ui");

// Read version from package.json once at module load time
let _serverVersion = "unknown";
try {
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
  _serverVersion = pkg.version ?? "unknown";
} catch (err) {
  logger.debug("[server] failed to read package.json version", { error: String(err) });
  /* intentionally ignored — version stays "unknown" */
}

// Minimal MIME type map for static asset serving
const MIME: Record<string, string> = {
  ".html": "text/html; charset=UTF-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export interface DashboardOptions {
  port: number;
  token: string;
  registry: Registry;
  conn: ServerConnection;
  sessionStore: SessionStore;
  db: Database.Database;
}

/** Timing-safe string comparison to prevent timing attacks on token validation. */
function safeTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
}

/**
 * Register auth middleware on /api/* routes.
 * Three auth paths, in priority order:
 *   1. Session cookie → look up DB user row, publish with source="session"
 *   2. Bearer token   → publish synthetic admin identity with source="bearer"
 *   3. Query-token (SSE fallback) → same synthetic identity
 *
 * Extension-Point: permission-middleware
 */
function registerAuthMiddleware(
  app: Hono,
  token: string,
  sessionStore: SessionStore,
  db: Database.Database,
): void {
  const expectedBearer = `Bearer ${token}`;
  const PUBLIC_ROUTES = ["/api/auth/login"];

  app.use("/api/*", async (c, next) => {
    // Skip auth for public routes
    if (PUBLIC_ROUTES.some((r) => c.req.path === r)) {
      return next();
    }

    // 1. Try session cookie (priority)
    const sid = getCookie(c, constants.SESSION_COOKIE_NAME);
    if (sid) {
      const session = sessionStore.validate(sid);
      if (session) {
        const userRow = db
          .prepare("SELECT id, username, role FROM users WHERE id = ?")
          .get(session.userId) as
          | { id: number | string; username: string; role: string }
          | undefined;
        if (userRow) {
          c.set("user", {
            id: String(userRow.id),
            username: userRow.username,
            role: userRow.role,
            source: "session",
          } satisfies AuthenticatedUser);
          return next();
        }
        // Session refers to a deleted user — fall through to next auth path
      }
    }

    // 2. Fallback: Bearer token (backward compat + programmatic access)
    const auth = c.req.header("Authorization") ?? "";
    if (safeTokenCompare(auth, expectedBearer)) {
      c.set("user", {
        id: "bearer",
        username: "bearer",
        role: "admin",
        source: "bearer",
      } satisfies AuthenticatedUser);
      return next();
    }

    // 3. SSE fallback: EventSource cannot set custom headers, so accept
    //    ?token=<bearer> as a last resort (timing-safe compare). Used by
    //    the UI's EventSource for /runtime/chat/stream. The cookie path
    //    above is still preferred when the browser sends it.
    const queryToken = c.req.query("token");
    if (queryToken && safeTokenCompare(`Bearer ${queryToken}`, expectedBearer)) {
      c.set("user", {
        id: "bearer",
        username: "bearer",
        role: "admin",
        source: "bearer",
      } satisfies AuthenticatedUser);
      return next();
    }

    return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
  });
}

/** Register public healthcheck, security headers, request-id, and rate-limit middleware. */
function registerCoreMiddleware(app: Hono, startedAt: number): void {
  // Public healthcheck — no auth required (for systemd, load balancers, monitoring)
  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "claw-pilot",
      version: _serverVersion,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    }),
  );

  // Request ID middleware — generates X-Request-Id for every request
  app.use("*", requestIdMiddleware());

  // Security headers middleware
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      // 'unsafe-inline' removed from script-src — Vite bundles all scripts as external files.
      // 'unsafe-inline' kept for style-src — Lit uses inline styles in shadow DOM.
      // font-src allows Google Fonts CDN for the UI font (Geist).
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://fonts.googleapis.com",
    );
  });

  // Rate limiting on API routes — generous for admin dashboard (single-user)
  app.use("/api/*", createRateLimiter({ maxRequests: 300, windowMs: 60_000 }));
  // Moderate limit on instance operations
  app.use("/api/instances", createRateLimiter({ maxRequests: 120, windowMs: 60_000 }));
  app.use(
    "/api/self/update",
    createRateLimiter({ maxRequests: 1, windowMs: constants.SELF_UPDATE_RATE_LIMIT_MS }),
  );
}

/**
 * Build the wired Hono app without starting an HTTP server.
 * Useful for testing: call this to get the app, then start a server manually
 * on port 0 to get an OS-assigned port.
 *
 * Does NOT:
 * - Call serve()
 * - Create a WebSocket server
 * - Register a SIGTERM handler
 *
 * DOES:
 * - Set up the session cleanup interval (returned via cleanup())
 */
export async function buildDashboardApp(options: DashboardOptions): Promise<DashboardAppResult> {
  const { token, registry, conn, sessionStore, db } = options;
  // Capture startup timestamp for uptime reporting
  const startedAt = Date.now();
  const app = new Hono();

  // Resolve XDG_RUNTIME_DIR once at startup for the current user
  const xdgRuntimeDir = await resolveXdgRuntimeDir(conn);

  const health = new HealthChecker(conn, registry, xdgRuntimeDir);
  const lifecycle = new Lifecycle(conn, registry, xdgRuntimeDir);
  const monitor = new Monitor(health, undefined, db);
  const selfUpdateChecker = new SelfUpdateChecker();
  const selfUpdater = new SelfUpdater(conn, lifecycle, registry);
  const tokenCache = new TokenCache(conn);
  const modelDiscovery = new ModelDiscoveryService(db);

  // Periodic session cleanup (every 60s)
  const cleanupInterval = setInterval(() => {
    sessionStore.cleanup();
  }, constants.SESSION_CLEANUP_INTERVAL_MS);
  if (cleanupInterval.unref) cleanupInterval.unref();

  registerCoreMiddleware(app, startedAt);

  // --- API routes (delegated to route modules) ---
  const deps: RouteDeps = {
    registry,
    conn,
    health,
    lifecycle,
    monitor,
    selfUpdateChecker,
    selfUpdater,
    tokenCache,
    xdgRuntimeDir,
    sessionStore,
    startedAt,
    db,
    modelDiscovery,
  };

  // Register the default password-based auth backend. Enterprise editions
  // register additional SSO providers (OIDC, SAML, Azure AD) in their own
  // bootstrap path, gated behind the matching capability. We replace any
  // prior registration so repeat bootstraps (tests, in-process restarts)
  // bind to the current DB handle.
  unregisterAuthProvider("password");
  registerAuthProvider(new PasswordProvider(db));

  // Auth routes — registered BEFORE the auth middleware so /api/auth/login is public
  registerAuthRoutes(app, deps, token);

  // TRIGGER-001 — webhook endpoints are HMAC-authenticated, so they MUST be
  // registered before the dashboard auth middleware. Path is `/webhooks/...`,
  // outside the `/api/*` prefix the auth middleware guards.
  // Extension-Point: trigger-runtime-bootstrap
  registerWebhookRoutes(app, deps);

  // Auth middleware for API routes — see registerAuthMiddleware above
  registerAuthMiddleware(app, token, sessionStore, db);

  registerInstanceRoutes(app, deps);
  registerBlueprintRoutes(app, deps);
  registerAgentBlueprintRoutes(app, deps);
  registerTeamRoutes(app, deps);
  registerSystemRoutes(app, deps);
  registerProfileRoutes(app, deps);
  registerNamedKeyRoutes(app, deps);
  registerSearchRoutes(app, deps);
  registerFlowRoutes(app, deps);
  registerSystemInstanceRoutes(app, deps);
  registerNotificationRoutes(app, deps);

  // Wire notification broadcaster: engines emit notifications → Monitor pushes to WS clients
  Monitor.setNotificationBroadcaster((row) => monitor.broadcastNotification(row));

  // Auto-prune old notifications (30 days) at startup and every 24h
  pruneNotifications(deps.db);
  setInterval(() => pruneNotifications(deps.db), 24 * 60 * 60 * 1000);

  // TRIGGER-001 — wire the flow-context provider for `{{trigger.*}}`
  // templating, then start the cron scheduler. The runtime starter is the
  // existing `/internal/flows/:id/run` daemon endpoint already used by the
  // manual trigger route.
  // Extension-Point: trigger-runtime-bootstrap
  registerTriggerContextProvider(deps.db);
  const triggerScheduler = new TriggerScheduler({
    db: deps.db,
    runtimeStarter: async (instanceSlug, flowId, triggerType, triggerDetail) => {
      const result = await callRuntimeApi<{ runId: number }>(
        instanceSlug,
        `/internal/flows/${flowId}/run`,
        { triggerType, triggerDetail },
      );
      return result.runId;
    },
  });
  triggerScheduler.start();

  // Rebuild search index on startup
  rebuildSearchIndex(deps.db);

  // Auto-start system instance if provisioned but stopped,
  // and re-sync the YAML template if it has changed since last startup.
  void SystemInstanceService.ensureRunning(registry, lifecycle, deps.db, deps.conn).catch((err) =>
    logger.warn("[system] failed to auto-start system instance", { error: String(err) }),
  );

  // Global error handler — catches unhandled errors that bubble up through route handlers.
  // ClawPilotError subclasses are mapped to structured API responses; unknown errors → 500.
  app.onError((err, c) => {
    if (err instanceof ClawPilotError) {
      const status =
        err.code === "INSTANCE_NOT_FOUND" || err.code === "AGENT_NOT_FOUND" ? 404 : 400;
      return c.json({ error: err.message, code: err.code }, status);
    }
    logger.error(`Unhandled dashboard error: ${err.message}`);
    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  });

  // --- Static file serving ---
  // Serve index.html as-is — token is no longer injected into HTML.
  // The SPA obtains the token via GET /api/auth/me after login.
  const serveIndex = async () => {
    const indexPath = path.join(UI_DIST, "index.html");
    return fs.readFile(indexPath, "utf-8");
  };

  // SPA root
  app.get("/", async (c) => {
    try {
      // no-cache: browser must revalidate index.html on every load so that
      // hashed asset filenames in the new bundle are always picked up after a deploy.
      c.header("Cache-Control", "no-cache");
      return c.html(await serveIndex());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.html(`<!DOCTYPE html><html><head><title>Claw Pilot</title></head>
<body><h1>Claw Pilot Dashboard</h1>
<p>UI not built. Run <code>pnpm build:ui</code> in <code>${path.resolve(UI_DIST, "..")}</code></p>
<p><small>${msg}</small></p>
<p><a href="/api/instances">API: /api/instances</a></p></body></html>`);
    }
  });

  // Static assets — served by reading from absolute UI_DIST path
  app.get("/assets/*", async (c) => {
    const url = new URL(c.req.url, "http://localhost");
    const filePath = path.join(UI_DIST, url.pathname);
    // Prevent path traversal — require filePath to be strictly inside UI_DIST
    if (!filePath.startsWith(UI_DIST + path.sep) && filePath !== UI_DIST) {
      return c.text("Forbidden", 403);
    }
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath);
      const mime = MIME[ext] ?? "application/octet-stream";
      return new Response(data, {
        headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable" },
      });
    } catch (err) {
      logger.debug("[server] static asset not found", { error: String(err) });
      return c.text("Not found", 404);
    }
  });

  // SPA fallback for all other routes
  app.get("*", async (c) => {
    try {
      c.header("Cache-Control", "no-cache");
      return c.html(await serveIndex());
    } catch (err) {
      logger.debug("[server] SPA fallback failed", { error: String(err) });
      return c.redirect("/");
    }
  });

  const cleanup = () => {
    clearInterval(cleanupInterval);
    monitor.stop();
    modelDiscovery.stop();
    triggerScheduler.stop();
  };

  return { app, deps, monitor, cleanup };
}

export async function startDashboard(options: DashboardOptions): Promise<void> {
  const { port, token, db } = options;

  const { app, deps, monitor, cleanup } = await buildDashboardApp(options);

  // Start HTTP server
  const server = serve({ fetch: app.fetch, port });

  monitor.start();
  deps.modelDiscovery.start();

  // WebSocket server — auth via first applicative message { type: "auth", token: "..." }
  // This avoids exposing the token in the URL (query params appear in server logs,
  // browser history, and proxy logs).
  const wss = new WebSocketServer({ server: server as HttpServer });
  wss.on("connection", (ws) => {
    // Give the client 5 seconds to send the auth message
    const authTimeout = setTimeout(() => {
      ws.close(4001, "Auth timeout");
    }, 5_000);

    const onFirstMessage = (data: import("ws").RawData) => {
      clearTimeout(authTimeout);
      ws.off("message", onFirstMessage);
      try {
        const msg = JSON.parse(String(data)) as { type?: string; token?: string };
        if (
          msg.type === "auth" &&
          typeof msg.token === "string" &&
          safeTokenCompare(msg.token, token)
        ) {
          monitor.addClient(ws);
        } else {
          ws.close(4001, "Unauthorized");
        }
      } catch (err) {
        logger.warn("[server] WebSocket auth message parse failed", { error: String(err) });
        ws.close(4001, "Invalid auth message");
      }
    };
    ws.on("message", onFirstMessage);
  });

  // Graceful shutdown — clean up resources on SIGTERM (systemd stop).
  // `shutdownAuditBus()` flushes the audit buffer to every sink before we
  // exit; without it a SIGTERM during high traffic drops the tail of events.
  process.once("SIGTERM", () => {
    cleanup();
    server.close();
    void (async () => {
      const { shutdownAuditBus } = await import("../core/audit/index.js");
      await shutdownAuditBus();
      db.close();
      process.exit(0);
    })();
  });
}
