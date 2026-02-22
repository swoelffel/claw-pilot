// src/dashboard/server.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Registry } from "../core/registry.js";
import type { ServerConnection } from "../server/connection.js";
import { HealthChecker } from "../core/health.js";
import { Lifecycle } from "../core/lifecycle.js";
import { Monitor } from "./monitor.js";

// Resolve dist/ui relative to this chunk's location.
// When bundled, this chunk lives at <install>/dist/server-*.mjs
// so __dirname = <install>/dist/ and UI_DIST = <install>/dist/ui/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST =
  process.env["CLAW_PILOT_UI_DIST"] ??
  path.resolve(__dirname, "ui");

export interface DashboardOptions {
  port: number;
  token: string;
  registry: Registry;
  conn: ServerConnection;
}

export async function startDashboard(options: DashboardOptions): Promise<void> {
  const { port, token, registry, conn } = options;
  const app = new Hono();
  const health = new HealthChecker(conn, registry);
  const lifecycle = new Lifecycle(conn, registry);
  const monitor = new Monitor(health);

  // Auth middleware for API routes
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${token}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  // --- API routes ---

  app.get("/api/instances", async (c) => {
    const statuses = await health.checkAll();
    return c.json(statuses);
  });

  app.get("/api/instances/:slug", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return c.json({ error: "Not found" }, 404);
    const status = await health.check(slug);
    return c.json({ instance, status });
  });

  app.get("/api/instances/:slug/agents", (c) => {
    const slug = c.req.param("slug");
    const agents = registry.listAgents(slug);
    return c.json(agents);
  });

  app.get("/api/instances/:slug/health", async (c) => {
    const slug = c.req.param("slug");
    try {
      const status = await health.check(slug);
      return c.json(status);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Unknown error" },
        500,
      );
    }
  });

  app.post("/api/instances/:slug/start", async (c) => {
    await lifecycle.start(c.req.param("slug"));
    return c.json({ ok: true });
  });

  app.post("/api/instances/:slug/stop", async (c) => {
    await lifecycle.stop(c.req.param("slug"));
    return c.json({ ok: true });
  });

  app.post("/api/instances/:slug/restart", async (c) => {
    await lifecycle.restart(c.req.param("slug"));
    return c.json({ ok: true });
  });

  app.get("/api/health", (c) => {
    return c.json({ ok: true, instances: registry.listInstances().length });
  });

  // SPA entry point: serve index.html with injected token
  // Must be registered BEFORE serveStatic so Hono injects the token
  // instead of serving the raw file from disk.
  app.get("/", async (c) => {
    const indexPath = path.join(UI_DIST, "index.html");
    try {
      let html = await fs.readFile(indexPath, "utf-8");
      const injection = `<script>window.__CP_TOKEN__=${JSON.stringify(token)};</script>`;
      html = html.replace("</head>", `${injection}\n</head>`);
      return c.html(html);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.html(`<!DOCTYPE html>
<html>
<head><title>Claw Pilot Dashboard</title></head>
<body>
<h1>Claw Pilot Dashboard</h1>
<p>UI not built. Run <code>pnpm build:ui</code> to build the dashboard.</p>
<p><small>UI path: ${UI_DIST} — ${msg}</small></p>
<p><a href="/api/instances">API: /api/instances</a></p>
</body>
</html>`);
    }
  });

  // Static assets (JS, CSS, etc.) — served from absolute path dist/ui/
  // Use path relative to this file's location, not cwd.
  app.use(
    "/*",
    serveStatic({ root: path.relative(process.cwd(), UI_DIST) }),
  );

  // Start HTTP server
  const server = serve({ fetch: app.fetch, port });

  // WebSocket server
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wss = new WebSocketServer({ server: server as any });
  wss.on("connection", (ws, req) => {
    // Validate token from query string
    const url = new URL(req.url ?? "/", `http://localhost`);
    const wsToken = url.searchParams.get("token");
    if (wsToken !== token) {
      ws.close(1008, "Unauthorized");
      return;
    }
    monitor.addClient(ws);
  });

  monitor.start();
}
