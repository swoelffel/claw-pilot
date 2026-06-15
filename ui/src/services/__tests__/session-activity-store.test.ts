/**
 * ui/src/services/__tests__/session-activity-store.test.ts
 *
 * Tests the event→state projection and listener plumbing without opening a
 * real EventSource. The impl is instantiated via `__testing.create` which
 * skips the SSE wiring; events are fed directly through `__testing.ingest`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __testing, type SessionActivityState } from "../session-activity-store.js";

describe("session-activity-store projection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for an unknown session", () => {
    const store = __testing.create("demo");
    expect(store.get("sess-1")).toBeUndefined();
  });

  it("session.status=busy → thinking state", () => {
    const store = __testing.create("demo");
    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "busy" },
    });
    const state = store.get("sess-1");
    expect(state?.kind).toBe("thinking");
  });

  it("tool.call.started → tool state carries the tool name", () => {
    const store = __testing.create("demo");
    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "busy" },
    });
    __testing.ingest(store, {
      type: "tool.call.started",
      payload: { sessionId: "sess-1", toolName: "read_file" },
    });
    const state = store.get("sess-1");
    expect(state?.kind).toBe("tool");
    expect(state?.kind === "tool" && state.toolName).toBe("read_file");
  });

  it("tool.call.ended → falls back to thinking", () => {
    const store = __testing.create("demo");
    __testing.ingest(store, {
      type: "tool.call.started",
      payload: { sessionId: "sess-1", toolName: "edit_file" },
    });
    __testing.ingest(store, {
      type: "tool.call.ended",
      payload: { sessionId: "sess-1", toolName: "edit_file" },
    });
    const state = store.get("sess-1");
    expect(state?.kind).toBe("thinking");
  });

  it("session.status=idle → clears the entry", () => {
    const store = __testing.create("demo");
    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "busy" },
    });
    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "idle" },
    });
    expect(store.get("sess-1")).toBeUndefined();
  });

  it("session.status=busy during a tool call keeps the tool phase", () => {
    const store = __testing.create("demo");
    __testing.ingest(store, {
      type: "tool.call.started",
      payload: { sessionId: "sess-1", toolName: "run" },
    });
    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "busy" },
    });
    const state = store.get("sess-1");
    expect(state?.kind).toBe("tool");
  });

  it("ignores events without a sessionId", () => {
    const store = __testing.create("demo");
    __testing.ingest(store, {
      type: "session.status",
      payload: { status: "busy" },
    });
    expect(store.get("sess-1")).toBeUndefined();
  });

  it("notifies subscribers on every transition", () => {
    const store = __testing.create("demo");
    const states: Array<SessionActivityState | undefined> = [];
    store.subscribe("sess-1", (s) => states.push(s));

    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "busy" },
    });
    __testing.ingest(store, {
      type: "tool.call.started",
      payload: { sessionId: "sess-1", toolName: "read_file" },
    });
    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "idle" },
    });

    expect(states).toHaveLength(3);
    expect(states[0]?.kind).toBe("thinking");
    expect(states[1]?.kind).toBe("tool");
    expect(states[2]).toBeUndefined();
  });

  it("does not cross-notify between different sessions", () => {
    const store = __testing.create("demo");
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    store.subscribe("sess-A", listenerA);
    store.subscribe("sess-B", listenerB);

    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-A", status: "busy" },
    });

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
  });

  it("unsubscribe stops future notifications", () => {
    const store = __testing.create("demo");
    const listener = vi.fn();
    const unsub = store.subscribe("sess-1", listener);

    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "busy" },
    });
    unsub();
    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "idle" },
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stale sweep purges entries older than STALE_MS and notifies subscribers", () => {
    const store = __testing.create("demo");
    const listener = vi.fn();
    store.subscribe("sess-1", listener);

    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "busy" },
    });
    listener.mockClear();

    vi.advanceTimersByTime(__testing.STALE_MS + 1_000);
    __testing.sweepStale(store);

    expect(store.get("sess-1")).toBeUndefined();
    expect(listener).toHaveBeenCalledWith(undefined);
  });

  it("stale sweep preserves recent entries", () => {
    const store = __testing.create("demo");

    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "busy" },
    });

    vi.advanceTimersByTime(__testing.STALE_MS / 2);
    __testing.sweepStale(store);

    expect(store.get("sess-1")?.kind).toBe("thinking");
  });

  it("thinking→tool→thinking preserves the original 'since' on re-entry", () => {
    const store = __testing.create("demo");

    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "busy" },
    });
    const since1 = (store.get("sess-1") as SessionActivityState).since;

    vi.advanceTimersByTime(500);
    __testing.ingest(store, {
      type: "session.status",
      payload: { sessionId: "sess-1", status: "busy" },
    });
    const since2 = (store.get("sess-1") as SessionActivityState).since;

    expect(since2).toBe(since1);
  });

  it("ignores unknown event types", () => {
    const store = __testing.create("demo");
    __testing.ingest(store, {
      type: "session.created",
      payload: { sessionId: "sess-1" },
    });
    expect(store.get("sess-1")).toBeUndefined();
  });
});
