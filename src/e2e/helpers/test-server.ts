// src/e2e/helpers/test-server.ts
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { SessionStore } from "../../dashboard/session-store.js";
import { buildDashboardApp } from "../../dashboard/server.js";
import { TestClient } from "./test-client.js";

export const TEST_TOKEN = "test-e2e-dashboard-token-64chars-hex-0123456789abcdef01234567";
/** @public */
export const TEST_PASSWORD = "E2eTestPassword1";

export interface TestContext {
  baseUrl: string;
  token: string;
  db: ReturnType<typeof initDatabase>;
  registry: Registry;
  conn: MockConnection;
  client: TestClient;
  cleanup: () => Promise<void>;
}

export async function startTestServer(): Promise<TestContext> {
  const db = initDatabase(":memory:");
  const registry = new Registry(db);
  const conn = new MockConnection();
  const sessionStore = new SessionStore(db);

  const { app, cleanup: appCleanup } = await buildDashboardApp({
    port: 0, // not used by buildDashboardApp, but required by DashboardOptions
    token: TEST_TOKEN,
    registry,
    conn,
    sessionStore,
    db,
  });

  // Start real HTTP server on port 0 (OS assigns a free port).
  // Use the listeningListener callback to get the actual address once the server is bound.
  let resolveAddress!: (info: AddressInfo) => void;
  const addressPromise = new Promise<AddressInfo>((resolve) => {
    resolveAddress = resolve;
  });

  const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
    resolveAddress(info);
  });

  // Wait for the server to be listening and get the OS-assigned port
  const address = await addressPromise;
  const port = address.port;
  const baseUrl = `http://localhost:${port}`;

  const client = new TestClient(baseUrl, TEST_TOKEN);

  const cleanup = async () => {
    appCleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  };

  return { baseUrl, token: TEST_TOKEN, db, registry, conn, client, cleanup };
}
