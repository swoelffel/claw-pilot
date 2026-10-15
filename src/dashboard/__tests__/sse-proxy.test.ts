import * as http from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { instanceMiddleware } from "../routes/_instance-middleware.js";
import { registerRuntimeChatRoutes } from "../routes/instances/runtime-chat.js";
import { registerEventsRoutes } from "../routes/instances/events.js";
import { injectAdminUser } from "./_helpers/inject-admin-user.js";
import type { RouteDeps } from "../route-deps.js";

const upstream = vi.hoisted(() => ({ port: 0 }));
vi.mock("../../lib/platform.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/platform.js")>()),
  resolveActualInternalApiPort: () => upstream.port,
  resolveInternalApiToken: async () => "synthetic-token",
}));

describe("dashboard SSE over HTTP", () => {
  let db: ReturnType<typeof initDatabase>;
  let runtime: http.Server;
  let dashboard: http.Server;
  let port: number;
  let upstreamResponse: http.ServerResponse | undefined;
  let upstreamUrl: string | undefined;
  const clients: http.IncomingMessage[] = [];

  async function listen(server: http.Server): Promise<number> {
    if (!server.listening)
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test HTTP address");
    return address.port;
  }

  beforeEach(async () => {
    upstreamResponse = undefined;
    upstreamUrl = undefined;
    runtime = http.createServer((req, res) => {
      upstreamUrl = req.url;
      upstreamResponse = res;
      res.writeHead(200, { "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" });
      res.write(":connected\n\n");
    });
    upstream.port = await listen(runtime);
    db = initDatabase(":memory:");
    const registry = new Registry(db);
    const server = registry.upsertLocalServer("test", "/tmp");
    registry.createInstance({
      serverId: server.id,
      slug: "demo",
      port: 19000,
      configPath: "/tmp/config",
      stateDir: "/tmp/state",
      systemdUnit: "demo",
    });
    const app = new Hono();
    app.use("*", injectAdminUser());
    app.use("/api/instances/:slug/*", instanceMiddleware(registry));
    registerRuntimeChatRoutes(app, { db } as RouteDeps);
    registerEventsRoutes(app, { db } as RouteDeps);
    dashboard = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as http.Server;
    if (!dashboard.listening)
      await new Promise<void>((resolve) => dashboard.once("listening", resolve));
    port = await listen(dashboard);
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.destroy();
    for (const server of [dashboard, runtime]) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
    db.close();
  });

  async function connect(path: string, cursor?: string) {
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = http.get(
        { host: "127.0.0.1", port, path, headers: cursor ? { "Last-Event-ID": cursor } : {} },
        resolve,
      );
      request.on("error", reject);
      request.setTimeout(2000, () => request.destroy(new Error("SSE headers were buffered")));
    });
    clients.push(response);
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      body += chunk;
    });
    return { response, body: () => body };
  }

  it.each(["runtime/chat/stream", "events/stream"])(
    "flushes headers and a heartbeat before any runtime data on %s",
    async (path) => {
      const client = await connect(`/api/instances/demo/${path}`);
      expect(client.response.statusCode).toBe(200);
      expect(client.response.headers["x-accel-buffering"]).toBe("no");
      await vi.waitFor(() => expect(client.body()).toContain("event: ping"));
      await vi.waitFor(() => expect(upstreamResponse).toBeDefined());
      upstreamResponse!.write(
        'id: 7\ndata: {"type":"session.status","payload":{"sessionId":"s1","status":"idle"}}\n\n',
      );
      await vi.waitFor(() => expect(client.body()).toContain("id: 7\n"));
      expect(client.body()).toContain('"status":"idle"');
    },
  );

  it.each(["runtime/chat/stream", "events/stream"])(
    "forwards the resume cursor and IDs across a disconnect on %s",
    async (path) => {
      const first = await connect(`/api/instances/demo/${path}?lastEventId=0&sessionId=s1`);
      await vi.waitFor(() => expect(upstreamResponse).toBeDefined());
      expect(upstreamUrl).toContain("lastEventId=0");
      if (path === "runtime/chat/stream") expect(upstreamUrl).toContain("sessionId=s1");
      upstreamResponse!.write(
        'id: 8\ndata: {"type":"message.updated","payload":{"sessionId":"s1"},"replayed":true}\n\n',
      );
      await vi.waitFor(() => expect(first.body()).toContain("id: 8\n"));
      first.response.destroy();
      upstreamResponse = undefined;
      const second = await connect(`/api/instances/demo/${path}?lastEventId=0&sessionId=s1`, "8");
      await vi.waitFor(() => expect(upstreamResponse).toBeDefined());
      expect(upstreamUrl).toContain("lastEventId=8");
      upstreamResponse!.write(
        'id: 9\ndata: {"type":"session.status","payload":{"sessionId":"s1","status":"idle"}}\n\n',
      );
      await vi.waitFor(() => expect(second.body()).toContain("id: 9\n"));
      expect(second.body()).not.toContain("id: 8\n");
      expect(first.body()).not.toContain("id: 9\n");
    },
  );
});
