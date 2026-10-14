import * as http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import { appendExecutionEvent } from "../../../core/repositories/execution-event-repository.js";
import { disposeBus, getBus, SessionStatusChanged, RuntimeError } from "../../bus/index.js";
import { wireEventPersistence } from "../event-persistence.js";
import { InternalApiServer } from "../internal-api.js";

interface Frame {
  id?: number;
  data: {
    type: string;
    payload: Record<string, unknown>;
    eventId?: number;
    replayed?: boolean;
  };
}

class StreamCapture {
  readonly frames: Frame[] = [];
  private _buffer = "";

  constructor(readonly response: http.IncomingMessage) {
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      this._buffer += chunk;
      let boundary: number;
      while ((boundary = this._buffer.indexOf("\n\n")) >= 0) {
        const block = this._buffer.slice(0, boundary);
        this._buffer = this._buffer.slice(boundary + 2);
        const data = block.split("\n").find((line) => line.startsWith("data: "));
        const id = block.split("\n").find((line) => line.startsWith("id: "));
        if (data) {
          this.frames.push({
            ...(id ? { id: Number(id.slice(4)) } : {}),
            data: JSON.parse(data.slice(6)) as Frame["data"],
          });
        }
      }
    });
  }

  async waitFor(count: number): Promise<void> {
    await vi.waitFor(() => expect(this.frames.length).toBeGreaterThanOrEqual(count), {
      timeout: 2000,
      interval: 10,
    });
  }
}

describe("internal API durable SSE replay", () => {
  let db: ReturnType<typeof initDatabase>;
  let server: InternalApiServer;
  const streams: StreamCapture[] = [];

  beforeEach(async () => {
    db = initDatabase(":memory:");
    db.prepare("INSERT INTO rt_requests(id,trace_id,instance_slug) VALUES('r1','t1','demo')").run();
    wireEventPersistence(db, "demo");
    server = new InternalApiServer({
      db,
      slug: "demo",
      port: 0,
      token: "test-token",
      handlers: {
        handleChat: async () => {
          throw new Error("unused");
        },
        handleWake: () => {},
        handleFlowRun: () => 0,
        handleAbort: () => false,
        handleQuestionAnswer: () => false,
      },
    });
    // InternalApiServer.boundPort stores the requested port; read the actual
    // ephemeral address at the HTTP boundary without changing production APIs.
    const listen = http.Server.prototype.listen;
    vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (
      this: http.Server,
      ...args
    ) {
      const result = Reflect.apply(listen, this, args);
      this.once("listening", () => {
        const address = this.address();
        if (address && typeof address === "object") port = address.port;
      });
      return result;
    });
    await server.start();
    vi.restoreAllMocks();
  });

  let port: number;

  afterEach(async () => {
    for (const stream of streams.splice(0)) stream.response.destroy();
    await server.stop();
    vi.restoreAllMocks();
    disposeBus("demo");
    db.close();
  });

  async function connect(query = "lastEventId=0", cursor?: number): Promise<StreamCapture> {
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = http.get(
        {
          host: "127.0.0.1",
          port,
          path: `/internal/events/stream?${query}`,
          headers: {
            Authorization: "Bearer test-token",
            ...(cursor !== undefined ? { "Last-Event-ID": String(cursor) } : {}),
          },
        },
        resolve,
      );
      request.on("error", reject);
    });
    expect(response.statusCode).toBe(200);
    const stream = new StreamCapture(response);
    streams.push(stream);
    return stream;
  }

  function append(
    index: number,
    slug = "demo",
    session: string | null = "s1",
    type = "session.status",
  ): number {
    return appendExecutionEvent(db, {
      request_id: "r1",
      execution_id: null,
      trace_id: "t1",
      instance_slug: slug,
      session_id: session,
      event_type: type,
      payload: { sessionId: session, index },
    });
  }

  function publish(index: number, sessionId = "s1"): void {
    const payload = { sessionId, status: "idle" as const, requestId: "r1", index };
    getBus("demo").publish(SessionStatusChanged, payload);
  }

  it.each([1000, 1001, 2000, 2505])(
    "replays all %i events in ID order before live traffic",
    async (count) => {
      db.transaction(() => {
        for (let index = 1; index <= count; index++) append(index);
      })();
      const stream = await connect();
      await stream.waitFor(count);
      publish(count + 1);
      await stream.waitFor(count + 1);
      expect(stream.frames.map((frame) => frame.id)).toEqual(
        Array.from({ length: count + 1 }, (_, i) => i + 1),
      );
      expect(stream.frames.map((frame) => frame.data.payload.index)).toEqual(
        Array.from({ length: count + 1 }, (_, i) => i + 1),
      );
      expect(stream.frames.every((frame) => frame.id === frame.data.eventId)).toBe(true);
    },
  );

  it("delivers an event published during replay exactly once after the backlog", async () => {
    for (let index = 1; index <= 1001; index++) append(index);
    const write = http.ServerResponse.prototype.write;
    let injected = false;
    vi.spyOn(http.ServerResponse.prototype, "write").mockImplementation(function (
      this: http.ServerResponse,
      ...args
    ) {
      const result = Reflect.apply(write, this, args);
      if (!injected && String(args[0]).startsWith("id: 1\n")) {
        injected = true;
        publish(1002);
      }
      return result;
    });
    const stream = await connect();
    await stream.waitFor(1002);
    publish(1003);
    await stream.waitFor(1003);
    expect(stream.frames.map((frame) => frame.id)).toEqual(
      Array.from({ length: 1003 }, (_, i) => i + 1),
    );
    expect(stream.frames.at(-2)?.data.payload.index).toBe(1002);
    expect(stream.frames.at(-1)?.data.payload.index).toBe(1003);
  });

  it("starts an empty replay and forwards scoped and unscoped live events", async () => {
    const stream = await connect("lastEventId=0&sessionId=s1&types=session.status,runtime.error");
    publish(1, "s2");
    publish(2);
    getBus("demo").publish(RuntimeError, { slug: "demo", error: "test-live" });
    await stream.waitFor(2);
    expect(stream.frames.map((frame) => frame.data.type)).toEqual([
      "session.status",
      "runtime.error",
    ]);
    expect(stream.frames.map((frame) => frame.id)).toEqual([2, undefined]);
    expect(stream.frames[0]?.data.payload.index).toBe(2);
  });

  it("keeps instance, session and type filters across every replay page and live", async () => {
    const expected: number[] = [];
    db.transaction(() => {
      for (let index = 0; index < 1001; index++) {
        append(-1, "other");
        append(-2, "demo", "s2");
        append(-3, "demo", "s1", "message.created");
        expected.push(append(index, "demo", index % 2 ? "s1" : null));
      }
    })();
    const stream = await connect("lastEventId=0&sessionId=s1&types=session.status");
    await stream.waitFor(1001);
    publish(-4, "s2");
    publish(1001);
    await stream.waitFor(1002);
    expect(stream.frames.map((frame) => frame.id)).toEqual([...expected, 4006]);
    expect(stream.frames.map((frame) => frame.data.payload.index)).toEqual(
      Array.from({ length: 1002 }, (_, i) => i),
    );
  });

  it("resumes after the header cursor and cleans up a closed connection", async () => {
    for (let index = 1; index <= 1002; index++) append(index);
    const first = await connect("lastEventId=0", 1000);
    await first.waitFor(2);
    expect(first.frames.map((frame) => frame.id)).toEqual([1001, 1002]);
    first.response.destroy();
    publish(1003);
    const second = await connect("lastEventId=1002");
    await second.waitFor(1);
    publish(1004);
    await second.waitFor(2);
    expect(second.frames.map((frame) => frame.id)).toEqual([1003, 1004]);
    expect(first.frames.map((frame) => frame.id)).toEqual([1001, 1002]);
  });
});
