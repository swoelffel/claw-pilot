import { describe, it, expect, vi, beforeEach } from "vitest";
import { Bus, getBus, disposeBus, hasBus } from "../bus/index.js";
import { SessionCreated, SessionStatusChanged, RuntimeStarted } from "../bus/events.js";

describe("Bus", () => {
  let bus: Bus;

  beforeEach(() => {
    bus = new Bus("test-instance");
  });

  it("publishes and receives a typed event", () => {
    const handler = vi.fn();
    bus.subscribe(SessionCreated, handler);

    bus.publish(SessionCreated, {
      sessionId: "sess-1",
      agentId: "main",
      channel: "web",
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      sessionId: "sess-1",
      agentId: "main",
      channel: "web",
    });
  });

  it("does not deliver events to wrong type subscribers", () => {
    const handler = vi.fn();
    bus.subscribe(SessionStatusChanged, handler);

    bus.publish(SessionCreated, {
      sessionId: "sess-1",
      agentId: "main",
      channel: "web",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribe stops delivery", () => {
    const handler = vi.fn();
    const unsub = bus.subscribe(SessionCreated, handler);

    unsub();

    bus.publish(SessionCreated, {
      sessionId: "sess-1",
      agentId: "main",
      channel: "web",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("wildcard subscriber receives all events", () => {
    const handler = vi.fn();
    bus.subscribeAll(handler);

    bus.publish(SessionCreated, { sessionId: "s1", agentId: "main", channel: "web" });
    bus.publish(RuntimeStarted, { slug: "test-instance" });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]![0].type).toBe("session.created");
    expect(handler.mock.calls[1]![0].type).toBe("runtime.started");
  });

  it("once() unsubscribes after returning 'done'", () => {
    const handler = vi.fn().mockReturnValueOnce("done");
    bus.once(SessionCreated, handler);

    bus.publish(SessionCreated, { sessionId: "s1", agentId: "main", channel: "web" });
    bus.publish(SessionCreated, { sessionId: "s2", agentId: "main", channel: "web" });

    expect(handler).toHaveBeenCalledOnce();
  });

  it("once() keeps listening if handler does not return 'done'", () => {
    const handler = vi.fn(); // returns undefined
    bus.once(SessionCreated, handler);

    bus.publish(SessionCreated, { sessionId: "s1", agentId: "main", channel: "web" });
    bus.publish(SessionCreated, { sessionId: "s2", agentId: "main", channel: "web" });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("dispose() stops all delivery", () => {
    const handler = vi.fn();
    bus.subscribe(SessionCreated, handler);
    bus.dispose();

    bus.publish(SessionCreated, { sessionId: "s1", agentId: "main", channel: "web" });

    expect(handler).not.toHaveBeenCalled();
    expect(bus.isDisposed).toBe(true);
  });

  it("subscribe after dispose returns no-op unsubscribe", () => {
    bus.dispose();
    const unsub = bus.subscribe(SessionCreated, vi.fn());
    expect(() => unsub()).not.toThrow();
  });

  it("handler errors are caught and do not stop other handlers", () => {
    const badHandler = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    const goodHandler = vi.fn();

    bus.subscribe(SessionCreated, badHandler);
    bus.subscribe(SessionCreated, goodHandler);

    expect(() =>
      bus.publish(SessionCreated, { sessionId: "s1", agentId: "main", channel: "web" }),
    ).not.toThrow();

    expect(goodHandler).toHaveBeenCalledOnce();
  });
});

describe("Bus registry", () => {
  beforeEach(() => {
    disposeBus("registry-test");
  });

  it("getBus creates a new bus for unknown slug", () => {
    expect(hasBus("registry-test")).toBe(false);
    const bus = getBus("registry-test");
    expect(bus).toBeInstanceOf(Bus);
    expect(hasBus("registry-test")).toBe(true);
  });

  it("getBus returns the same instance for the same slug", () => {
    const a = getBus("registry-test");
    const b = getBus("registry-test");
    expect(a).toBe(b);
  });

  it("disposeBus removes and disposes the bus", () => {
    const bus = getBus("registry-test");
    disposeBus("registry-test");
    expect(hasBus("registry-test")).toBe(false);
    expect(bus.isDisposed).toBe(true);
  });
});
