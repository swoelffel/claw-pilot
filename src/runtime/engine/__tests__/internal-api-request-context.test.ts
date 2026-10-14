import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import { createOrGetRequest, getRequest } from "../../../core/repositories/request-repository.js";
import { InternalApiServer } from "../internal-api.js";

async function availablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No test port available");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    probe.close((err) => (err ? reject(err) : resolve())),
  );
  return port;
}

describe("internal chat request context", () => {
  const db = initDatabase(":memory:");
  let server: InternalApiServer | undefined;

  afterEach(async () => {
    await server?.stop();
    db.close();
  });

  it("returns a generic 409 for a repository context conflict without returning the request", async () => {
    const original = createOrGetRequest(db, { instanceSlug: "first", source: "web" }).request;
    server = new InternalApiServer({
      port: await availablePort(),
      token: "test-token",
      slug: "second",
      db,
      handlers: {
        handleChat: async (body) => {
          createOrGetRequest(db, {
            instanceSlug: "second",
            source: "web",
            requestId: body.requestId!,
          });
          throw new Error("Expected request context rejection");
        },
        handleWake: () => {},
        handleAbort: () => false,
        handleFlowRun: () => 0,
        handleQuestionAnswer: () => false,
      },
    });
    await server.start();
    const response = await fetch(`http://127.0.0.1:${server.boundPort}/internal/chat`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello", requestId: original.id }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: "REQUEST_CONTEXT_CONFLICT" });
    expect(JSON.stringify(body)).not.toContain(original.id);
    expect(getRequest(db, original.id)).toEqual(original);
  });
});
