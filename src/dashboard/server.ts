// src/dashboard/server.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Registry } from "../core/registry.js";
import type { ServerConnection } from "../server/connection.js";
import { HealthChecker } from "../core/health.js";
import { Lifecycle } from "../core/lifecycle.js";
import { Monitor } from "./monitor.js";
import { resolveXdgRuntimeDir } from "../lib/xdg.js";
import { UpdateChecker } from "../core/update-checker.js";
import { Updater } from "../core/updater.js";
import { createRateLimiter } from "./rate-limit.js";
import { TokenCache } from "./token-cache.js";
import { apiError } from "./route-deps.js";
import type { RouteDeps } from "./route-deps.js";
import { registerInstanceRoutes } from "./routes/instances.js";
import { registerBlueprintRoutes } from "./routes/blueprints.js";
import { registerTeamRoutes } from "./routes/teams.js";
import { registerSystemRoutes } from "./routes/system.js";

// Resolve dist/ui/ relative to this bundle chunk.
// When bundled: this file is at <install>/dist/server-*.mjs
// so __dirname = <install>/dist/ and UI_DIST = <install>/dist/ui/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST =
  process.env["CLAW_PILOT_UI_DIST"] ?? path.resolve(__dirname, "ui");

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
}

/** Timing-safe string comparison to prevent timing attacks on token validation. */
function safeTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
}

export async function startDashboard(options: DashboardOptions): Promise<void> {
  const { port, token, registry, conn } = options;
  const app = new Hono();

  // Resolve XDG_RUNTIME_DIR once at startup for the current user
  const xdgRuntimeDir = await resolveXdgRuntimeDir(conn);

  const health = new HealthChecker(conn, registry, xdgRuntimeDir);
  const lifecycle = new Lifecycle(conn, registry, xdgRuntimeDir);
  const monitor = new Monitor(health);
  const updateChecker = new UpdateChecker(conn);
  const updater = new Updater(conn, registry, lifecycle);
  const tokenCache = new TokenCache(conn);

  // Security headers middleware
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'",
    );
  });

  // Rate limiting on API routes (60 req/min per IP)
  app.use("/api/*", createRateLimiter({ maxRequests: 60, windowMs: 60_000 }));
  // Stricter rate limit on expensive operations
  app.use("/api/instances", createRateLimiter({ maxRequests: 10, windowMs: 60_000 }));
  app.use("/api/openclaw/update", createRateLimiter({ maxRequests: 1, windowMs: 300_000 }));

  // Auth middleware for API routes (timing-safe comparison)
  const expectedBearer = `Bearer ${token}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (!safeTokenCompare(auth, expectedBearer)) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    await next();
  });

  // --- API routes (delegated to route modules) ---
  const deps: RouteDeps = { registry, conn, health, lifecycle, updateChecker, updater, tokenCache, xdgRuntimeDir };
  registerInstanceRoutes(app, deps);
  registerBlueprintRoutes(app, deps);
  registerTeamRoutes(app, deps);
  registerSystemRoutes(app, deps);

  // --- Static file serving ---
  // Serve index.html with injected token (all non-asset routes → SPA)
  const serveIndex = async () => {
    const indexPath = path.join(UI_DIST, "index.html");
    let html = await fs.readFile(indexPath, "utf-8");
    const injection = `<script>window.__CP_TOKEN__=${JSON.stringify(token)};</script>`;
    html = html.replace("</head>", `${injection}\n</head>`);
    return html;
  };

  // SPA root
  app.get("/", async (c) => {
    try {
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
    // Prevent path traversal
    if (!filePath.startsWith(UI_DIST)) {
      return c.text("Forbidden", 403);
    }
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath);
      const mime = MIME[ext] ?? "application/octet-stream";
      return new Response(data, {
        headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable" },
      });
    } catch {
      return c.text("Not found", 404);
    }
  });

  // SPA fallback for all other routes
  app.get("*", async (c) => {
    try {
      return c.html(await serveIndex());
    } catch {
      return c.redirect("/");
    }
  });

  // Start HTTP server
  const server = serve({ fetch: app.fetch, port });

  // WebSocket server
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wss = new WebSocketServer({ server: server as any });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const wsToken = url.searchParams.get("token") ?? "";
    if (!safeTokenCompare(wsToken, token)) {
      ws.close(1008, "Unauthorized");
      return;
    }
    monitor.addClient(ws);
  });

  monitor.start();
}
