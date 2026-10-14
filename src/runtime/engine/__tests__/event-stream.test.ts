import * as http from "node:http";
import { Socket } from "node:net";
import { setImmediate as yieldToIO } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import { appendExecutionEvent } from "../../../core/repositories/execution-event-repository.js";
import {
  disposeBus,
  getBus,
  RuntimeError,
  SessionStatusChanged,
  MessageCreated,
  MessageUpdated,
  MessagePartDelta,
} from "../../bus/index.js";
import { wireEventPersistence } from "../event-persistence.js";
import { streamRuntimeEvents } from "../event-stream.js";

describe("SSE replay backpressure and handoff", () => {
  let db: ReturnType<typeof initDatabase>;
  let req: http.IncomingMessage;
  let res: http.ServerResponse;
  let writes: string[];
  let accepts: (line: string) => boolean;

  beforeEach(() => {
    db = initDatabase(":memory:");
    db.prepare("INSERT INTO rt_requests(id,trace_id,instance_slug) VALUES('r1','t1','demo')").run();
    wireEventPersistence(db, "demo");
    req = new http.IncomingMessage(new Socket());
    res = new http.ServerResponse(req);
    writes = [];
    accepts = () => true;
    // Only the transport is controlled. Queries, bus delivery, persistence and
    // SSE encoding run normally; false means the frame was accepted but blocked.
    vi.spyOn(res, "write").mockImplementation((chunk) => {
      const line = String(chunk);
      writes.push(line);
      return accepts(line);
    });
  });

  afterEach(async () => {
    res.emit("close");
    await yieldToIO();
    disposeBus("demo");
    db.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function append(index: number): void {
    appendExecutionEvent(db, {
      request_id: "r1",
      execution_id: null,
      trace_id: "t1",
      instance_slug: "demo",
      session_id: "s1",
      event_type: "session.status",
      payload: { sessionId: "s1", index },
    });
  }

  function publish(index: number): void {
    const payload = { sessionId: "s1", status: "idle" as const, requestId: "r1", index };
    getBus("demo").publish(SessionStatusChanged, payload);
  }

  function ids(): number[] {
    return writes
      .filter((line) => line.startsWith("id:"))
      .map((line) => Number(line.split("\n")[0]!.slice(4)));
  }

  function start(cursor = 0): void {
    streamRuntimeEvents(req, res, { db, slug: "demo", cursor });
  }

  it("pauses at a page boundary and catches up durable arrivals without duplicates", async () => {
    for (let index = 1; index <= 1001; index++) append(index);
    accepts = (line) => !line.startsWith("id: 1000\n");
    start();
    await vi.waitFor(() => expect(ids()).toHaveLength(1000));
    publish(1002);
    await yieldToIO();
    expect(ids()).toHaveLength(1000);
    accepts = () => true;
    res.emit("drain");
    await vi.waitFor(() => expect(ids()).toHaveLength(1002));
    expect(ids()).toEqual(Array.from({ length: 1002 }, (_, i) => i + 1));
    const last = JSON.parse(
      writes.find((line) => line.startsWith("id: 1002\n"))!.split("data: ")[1]!,
    ) as { payload: { index: number }; replayed?: boolean };
    expect(last.payload.index).toBe(1002);
    expect(last.replayed).toBeUndefined();
    expect(writes[0]).toBe("retry: 3000\n\n");
  });

  it("keeps database order when nested bus publication delivers a later notification first", async () => {
    let nested = false;
    getBus("demo").subscribeAll(() => {
      if (!nested) {
        nested = true;
        publish(2);
      }
    });
    start();
    await yieldToIO();
    publish(1);
    await vi.waitFor(() => expect(ids()).toHaveLength(2));
    expect(ids()).toEqual([1, 2]);
    expect(
      writes
        .filter((line) => line.startsWith("id:"))
        .map((line) => {
          const data = JSON.parse(line.split("data: ")[1]!) as { payload: { index: number } };
          return data.payload.index;
        }),
    ).toEqual([1, 2]);
  });

  it("catches an arrival during the final transient write and then live traffic", async () => {
    let injected = false;
    accepts = (line) => {
      if (!injected && line.includes("handoff-marker")) {
        injected = true;
        publish(1);
      }
      return true;
    };
    start();
    getBus("demo").publish(RuntimeError, { slug: "demo", error: "handoff-marker" });
    await vi.waitFor(() => expect(ids()).toEqual([1]));
    publish(2);
    await vi.waitFor(() => expect(ids()).toEqual([1, 2]));
  });

  it("preserves live text deltas before durable message completion while blocked", async () => {
    start();
    await yieldToIO();
    accepts = (line) => !line.startsWith("id: 1\n");
    const bus = getBus("demo");
    const context = { requestId: "r1", sessionId: "s1", messageId: "m1" };
    bus.publish(MessageCreated, { ...context, role: "assistant" });
    bus.publish(MessagePartDelta, { ...context, partId: "p1", delta: "hello" });
    bus.publish(MessageUpdated, context);
    publish(4);
    await vi.waitFor(() => expect(ids()).toEqual([1]));
    accepts = () => true;
    res.emit("drain");
    await vi.waitFor(() => expect(writes.filter((line) => line.includes("data:")).length).toBe(4));
    const frames = writes
      .filter((line) => line.includes("data:"))
      .map(
        (line) =>
          JSON.parse(line.split("data: ")[1]!) as {
            type: string;
            payload: Record<string, unknown>;
            eventId?: number;
          },
      );
    expect(frames.map((frame) => frame.type)).toEqual([
      "message.created",
      "message.part.delta",
      "message.updated",
      "session.status",
    ]);
    expect(frames.map((frame) => frame.eventId)).toEqual([1, undefined, 2, 3]);
    expect(frames[1]?.payload.delta).toBe("hello");
  });

  it.each(["close", "aborted"])(
    "releases a blocked replay on request %s and stops pings",
    async (event) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      append(1);
      append(2);
      accepts = (line) => !line.startsWith("id:");
      start();
      await vi.waitFor(() => expect(ids()).toEqual([1]));
      req.emit(event);
      await yieldToIO();
      expect(res.listenerCount("drain")).toBe(0);
      accepts = () => true;
      res.emit("drain");
      publish(3);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ids()).toEqual([1]);
      expect(writes.filter((line) => line.startsWith(":ping"))).toEqual([]);
    },
  );

  it("bounds transient traffic while blocked and leaves durable data for reconnection", async () => {
    append(1);
    accepts = () => false;
    start();
    const text = "x".repeat(300_000);
    for (let i = 0; i < 4; i++) {
      getBus("demo").publish(RuntimeError, { slug: "demo", error: text });
    }
    await yieldToIO();
    expect(res.destroyed).toBe(true);
    expect(writes).toEqual(["retry: 3000\n\n"]);
    expect(res.listenerCount("drain")).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM rt_execution_events").get()).toEqual({ n: 1 });
  });

  it("keeps an invalid cursor live-only and still assigns the next durable SSE ID", async () => {
    append(1);
    start(Number.NaN);
    await yieldToIO();
    publish(2);
    await vi.waitFor(() => expect(ids()).toEqual([2]));
  });

  it("accepts live events when a reconnect cursor is ahead of the current log", async () => {
    append(1);
    start(9999);
    await yieldToIO();
    publish(2);
    await vi.waitFor(() => expect(ids()).toEqual([2]));
  });

  it("does not strand a transient frame behind durable rows excluded by filters", async () => {
    append(1);
    streamRuntimeEvents(req, res, {
      db,
      slug: "demo",
      cursor: 0,
      sessionId: "s2",
      types: new Set(["runtime.error"]),
    });
    getBus("demo").publish(RuntimeError, { slug: "demo", error: "visible-transient" });
    await vi.waitFor(() =>
      expect(writes.some((line) => line.includes("visible-transient"))).toBe(true),
    );
    expect(ids()).toEqual([]);
  });
});
