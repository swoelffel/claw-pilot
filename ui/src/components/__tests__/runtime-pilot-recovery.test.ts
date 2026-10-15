// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { fetchRuntimeChatActivity } from "../../api.js";
import { RuntimePilot } from "../runtime-pilot.js";
import type { PilotBusEvent, PilotMessage, RuntimeRequest } from "../../types.js";

interface PilotState {
  slug: string;
  sessionId: string;
  _activeSessionId: string;
  _status: string;
  _recoveryState: string;
  _lastEventId: string;
  _messages: PilotMessage[];
  _streamingMessageId: string | null;
  _streamingText: string;
  _currentToolName: string | null;
  _handleBusEvent(event: PilotBusEvent): void;
  _refreshMessages(): Promise<void>;
  _reloadLastMessages(): Promise<void>;
  _openStream(): void;
  _init(): Promise<void>;
  _teardown(): void;
  _onSendMessage(event: CustomEvent<{ text: string }>): Promise<void>;
}

class TestEventSource {
  static streams: TestEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public url: string) {
    TestEventSource.streams.push(this);
  }
  close() {}
  addEventListener() {}
}

const saved: PilotMessage = {
  id: "answer-1",
  sessionId: "session-1",
  role: "assistant",
  isCompaction: false,
  createdAt: "2026-01-01T00:00:00Z",
  finishReason: "stop",
  parts: [
    {
      id: "text-1",
      messageId: "answer-1",
      type: "text",
      content: "Saved answer",
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
};
function request(status = "succeeded", id = "request-1"): RuntimeRequest {
  return {
    id,
    trace_id: "trace-1",
    parent_request_id: null,
    session_id: "session-1",
    agent_id: "assistant",
    task_id: null,
    delivery_status: "pending",
    execution_status: status,
    result_message_id: status === "succeeded" ? saved.id : null,
    artifact_refs_json: "[]",
    error_message: null,
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    created_at: "2026-01-01T00:00:00Z",
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function event(type: string, payload: Record<string, unknown>): PilotBusEvent {
  return { type, payload, timestamp: "2026-01-01T00:00:00Z" };
}
let pilots: PilotState[];
let latest: RuntimeRequest[];
let activeRequests: RuntimeRequest[];
let messages: PilotMessage[];
let reads: URL[];
let posts: Array<{ requestId: string }>;
let finishPost: ReturnType<typeof deferred<Response>>;
function pilot(): PilotState {
  const el = new RuntimePilot() as unknown as PilotState;
  Object.assign(el, { slug: "demo", sessionId: "session-1", _activeSessionId: "session-1" });
  pilots.push(el);
  return el;
}
function send(el: PilotState) {
  return el._onSendMessage(new CustomEvent("send-message", { detail: { text: "Hello" } }));
}
function postResult(requestId: string, pendingQuestion = false) {
  return Response.json({
    requestId,
    traceId: "trace-1",
    executionId: "execution-1",
    sessionId: "session-1",
    messageId: saved.id,
    text: "Saved answer",
    tokens: { input: 1, output: 1 },
    costUsd: 0,
    steps: 1,
    pendingQuestion,
  });
}
beforeEach(() => {
  pilots = [];
  latest = [request()];
  activeRequests = [];
  messages = [saved];
  reads = [];
  posts = [];
  finishPost = deferred<Response>();
  TestEventSource.streams = [];
  vi.stubGlobal("EventSource", TestEventSource);
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    if (init?.method === "POST") {
      if (!url.pathname.endsWith("/runtime/chat")) throw new Error("Unexpected mutation");
      posts.push(JSON.parse(init.body as string));
      return finishPost.promise;
    }
    reads.push(url);
    if (url.pathname.endsWith("/runtime/chat/activity"))
      return Response.json({
        requests: url.searchParams.has("requestId")
          ? activeRequests.filter((row) => row.id === url.searchParams.get("requestId"))
          : latest,
      });
    if (url.pathname.endsWith("/messages")) return Response.json({ messages, hasMore: false });
    if (url.pathname.endsWith("/context")) return Response.json(null);
    throw new Error(`Unexpected read ${url.pathname}`);
  });
});
afterEach(() => {
  for (const el of pilots) el._teardown();
  vi.unstubAllGlobals();
});

describe("Pilot canonical execution recovery", () => {
  it("stops sending after completed assistant replay without delta events", async () => {
    const el = pilot();
    el._handleBusEvent(
      event("message.created", { sessionId: "session-1", role: "assistant", messageId: saved.id }),
    );
    el._handleBusEvent(event("message.updated", { sessionId: "session-1", messageId: saved.id }));
    el._handleBusEvent(event("session.status", { sessionId: "session-1", status: "idle" }));
    await vi.waitFor(() => expect(el._status).toBe("idle"));
    expect(el._streamingMessageId).toBeNull();
    expect(el._messages).toEqual([saved]);
  });

  it.each(["sending", "thinking", "tool", "streaming"])(
    "polling reconciles a terminal request while %s",
    async (status) => {
      const el = pilot();
      el._status = status;
      el._streamingMessageId = saved.id;
      el._streamingText = "partial";
      el._currentToolName = "read";
      await el._refreshMessages();
      expect(el._status).toBe("idle");
      expect(el._messages).toEqual([saved]);
      expect(el._streamingMessageId).toBeNull();
      expect(el._streamingText).toBe("");
      expect(el._currentToolName).toBeNull();
      expect(
        reads
          .find((url) => url.pathname.endsWith("/runtime/chat/activity"))
          ?.searchParams.toString(),
      ).toBe("sessionId=session-1&limit=1");
      expect(posts).toHaveLength(0);
    },
  );

  it.each(["failed", "timed_out", "cancelled"])(
    "ends the spinner with attention for canonical %s",
    async (status) => {
      latest = [request(status)];
      const el = pilot();
      el._status = "tool";
      await el._refreshMessages();
      expect(el._status).toBe("idle");
      expect(el._recoveryState).toBe("NEEDS_ATTENTION");
    },
  );

  it("keeps the HTTP pending-question response busy until canonical completion", async () => {
    const el = pilot();
    const sending = send(el);
    const requestId = posts[0]!.requestId;
    latest = [request("running", requestId)];
    finishPost.resolve(postResult(requestId, true));
    await sending;
    await el._refreshMessages();
    expect(el._status).toBe("thinking");
    latest = [request("succeeded", requestId)];
    await el._refreshMessages();
    expect(el._status).toBe("idle");
  });

  it("recovers chat activity when the user has chat permissions without execution listing", async () => {
    const el = pilot();
    el._status = "tool";
    const fetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname.endsWith("/requests")) {
        return Promise.resolve(
          Response.json({ error: "Forbidden", code: "PERMISSION_DENIED" }, { status: 403 }),
        );
      }
      if (url.pathname.endsWith("/runtime/chat/activity")) {
        reads.push(url);
        return Promise.resolve(
          Response.json({
            requests: [{ id: "request-1", session_id: "session-1", execution_status: "succeeded" }],
          }),
        );
      }
      return fetch(input, init);
    });
    await el._refreshMessages();
    expect(el._status).toBe("idle");
    expect(el._messages).toEqual([saved]);
    expect(reads.some((url) => url.pathname.endsWith("/runtime/chat/activity"))).toBe(true);
  });

  it("reads exact scoped chat activity through the Pilot API instead of the execution list", async () => {
    const projection = { id: "request & 1", session_id: "session/1", execution_status: "running" };
    const calls: Array<{ path: string; query: Record<string, string>; method: string }> = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      calls.push({
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        method: init?.method ?? "GET",
      });
      return Response.json({ requests: [projection] });
    });
    const result = await fetchRuntimeChatActivity("demo", {
      sessionId: "session/1",
      requestId: "request & 1",
      limit: 1,
    });
    expect(result).toEqual([projection]);
    expect(calls).toEqual([
      {
        path: "/api/instances/demo/runtime/chat/activity",
        query: { sessionId: "session/1", requestId: "request & 1", limit: "1" },
        method: "GET",
      },
    ]);
  });

  it("keeps an active execution with a pending question busy", async () => {
    latest = [request("running")];
    messages = [
      {
        ...saved,
        parts: [
          {
            ...saved.parts[0]!,
            type: "tool_call",
            metadata: JSON.stringify({ toolName: "question" }),
            content: "",
          },
        ],
      },
    ];
    const el = pilot();
    el._status = "tool";
    await el._refreshMessages();
    expect(el._status).toBe("tool");
    expect(el._messages).toEqual(messages);
    expect(el._recoveryState).toBe("");
  });

  it("reconnects with read-only reconciliation after losing terminal events", async () => {
    const el = pilot();
    el._status = "tool";
    el._openStream();
    TestEventSource.streams.at(-1)!.onerror!();
    el._openStream();
    TestEventSource.streams.at(-1)!.onopen!();
    await vi.waitFor(() => expect(el._status).toBe("idle"));
    expect(el._recoveryState).toBe("RESULT_READY");
    expect(el._messages).toEqual([saved]);
    expect(posts).toHaveLength(0);
  });

  it("does not let a previous succeeded request settle a new pending POST", async () => {
    const el = pilot();
    const sending = send(el);
    await el._refreshMessages();
    expect(el._status).toBe("sending");
    expect(el._recoveryState).toBe("");
    finishPost.resolve(postResult(posts[0]!.requestId));
    await sending;
  });

  it("recovers a matching terminal request while its HTTP response remains pending", async () => {
    const el = pilot();
    const sending = send(el);
    latest = [request("succeeded", posts[0]!.requestId)];
    await el._refreshMessages();
    expect(el._status).toBe("idle");
    expect(el._messages).toEqual([saved]);
    finishPost.resolve(postResult(posts[0]!.requestId, true));
    await sending;
    expect(el._status).toBe("idle");
  });

  it("ignores an old canonical read when a new send starts", async () => {
    const el = pilot();
    const read = deferred<Response>();
    const fetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) =>
      input.includes("/runtime/chat/activity") ? read.promise : fetch(input, init),
    );
    const refreshing = el._refreshMessages();
    const sending = send(el);
    read.resolve(Response.json({ requests: [request()] }));
    await refreshing;
    expect(el._status).toBe("sending");
    finishPost.resolve(postResult(posts[0]!.requestId));
    await sending;
  });

  it("ignores stale idle events while the current HTTP request is streaming", async () => {
    const el = pilot();
    const sending = send(el);
    el._handleBusEvent(event("message.part.delta", { sessionId: "session-1", delta: "Working" }));
    el._handleBusEvent(event("session.status", { sessionId: "session-1", status: "idle" }));
    await Promise.resolve();
    expect(el._status).toBe("streaming");
    finishPost.resolve(postResult(posts[0]!.requestId));
    await sending;
  });

  it("reconciles on stream open even when all activity was missed while idle", async () => {
    const el = pilot();
    el._openStream();
    TestEventSource.streams.at(-1)!.onopen!();
    await vi.waitFor(() => expect(el._messages).toEqual([saved]));
    expect(el._status).toBe("idle");
  });

  it("restores a busy pending question from canonical state after initialization", async () => {
    latest = [request("running")];
    messages = [
      {
        ...saved,
        parts: [
          {
            ...saved.parts[0]!,
            type: "tool_call",
            metadata: JSON.stringify({ toolName: "question" }),
            content: "",
          },
        ],
      },
    ];
    const el = pilot();
    await el._refreshMessages();
    expect(el._status).toBe("tool");
    expect(el._messages).toEqual(messages);
  });

  it("does not let an old HTTP response override a new send after canonical recovery", async () => {
    const el = pilot();
    const sending = send(el);
    const oldPost = finishPost;
    latest = [request("succeeded", posts[0]!.requestId)];
    await el._refreshMessages();
    finishPost = deferred<Response>();
    const newSending = send(el);
    el._handleBusEvent(
      event("message.part.delta", { sessionId: "session-1", delta: "New response" }),
    );
    oldPost.resolve(postResult(posts[0]!.requestId));
    await sending;
    expect(el._status).toBe("streaming");
    expect(el._streamingText).toBe("New response");
    finishPost.resolve(postResult(posts[1]!.requestId));
    await newSending;
  });

  it("ignores a pending HTTP response after component disconnection", async () => {
    const el = pilot();
    const sending = send(el);
    el._teardown();
    el._status = "tool";
    finishPost.resolve(postResult(posts[0]!.requestId));
    await sending;
    expect(el._status).toBe("tool");
    expect(el._messages).toEqual([]);
  });

  it("keeps newer cross-channel activity busy instead of using an older web success", async () => {
    const el = pilot();
    el._status = "tool";
    let incoming = { ...request("running", "telegram-request"), source: "telegram" };
    const fetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname.endsWith("/runtime/chat/activity")) {
        return Promise.resolve(
          Response.json({
            requests: url.searchParams.get("source") === "web" ? [request()] : [incoming],
          }),
        );
      }
      return fetch(input, init);
    });
    await el._refreshMessages();
    expect(el._status).toBe("tool");
    incoming = { ...request("succeeded", "telegram-request"), source: "telegram" };
    await el._refreshMessages();
    expect(el._status).toBe("idle");
    expect(el._messages).toEqual([saved]);
  });

  it("keeps busy when canonical reads fail instead of guessing completion", async () => {
    const el = pilot();
    el._status = "tool";
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    await el._refreshMessages();
    expect(el._status).toBe("tool");
    expect(el._recoveryState).toBe("");
  });

  it("renders readable recovery attention instead of an internal state code", async () => {
    const el = pilot();
    el._status = "tool";
    latest = [request("failed")];
    await el._refreshMessages();
    const container = document.createElement("div");
    render((el as unknown as RuntimePilot).render(), container);
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(
      /execution.*(failed|stopped|ended)/i,
    );
    expect(container.querySelector('[role="status"]')?.textContent).not.toContain(
      "NEEDS_ATTENTION",
    );
  });

  it("follows newer cross-channel terminal execution while the old web POST stays pending", async () => {
    const el = pilot();
    const sending = send(el);
    const oldId = posts[0]!.requestId;
    activeRequests = [request("succeeded", oldId)];
    latest = [request("running", "telegram-request")];
    messages = [{ ...saved, id: "telegram-answer" }];
    el._handleBusEvent(
      event("message.created", {
        sessionId: "session-1",
        role: "assistant",
        messageId: "telegram-answer",
      }),
    );
    el._handleBusEvent(event("tool.call.started", { sessionId: "session-1", toolName: "read" }));
    await el._refreshMessages();
    expect(el._status).toBe("tool");
    expect(el._messages).toEqual(messages);
    latest = [request("succeeded", "telegram-request")];
    await el._refreshMessages();
    expect(el._status).toBe("idle");
    finishPost.resolve(postResult(oldId, true));
    await sending;
    expect(el._status).toBe("idle");
  });

  it("does not stop newer cross-channel tools when the old web POST finally resolves", async () => {
    const el = pilot();
    const sending = send(el);
    latest = [request("running", "telegram-request")];
    el._handleBusEvent(
      event("message.created", {
        sessionId: "session-1",
        role: "assistant",
        messageId: "telegram-answer",
      }),
    );
    el._handleBusEvent(event("tool.call.started", { sessionId: "session-1", toolName: "read" }));
    finishPost.resolve(postResult(posts[0]!.requestId));
    await sending;
    expect(el._status).toBe("tool");
    expect(el._streamingMessageId).toBe("telegram-answer");
    expect(el._currentToolName).toBe("read");
  });

  it("does not apply a terminal snapshot after a newer busy event", async () => {
    const el = pilot();
    const read = deferred<Response>();
    const fetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) =>
      input.includes("/runtime/chat/activity") ? read.promise : fetch(input, init),
    );
    const refreshing = el._refreshMessages();
    el._handleBusEvent(event("session.status", { sessionId: "session-1", status: "busy" }));
    read.resolve(Response.json({ requests: [request()] }));
    await refreshing;
    expect(el._status).toBe("sending");
  });

  it("does not overwrite the terminal answer with a delayed partial message read", async () => {
    const el = pilot();
    el._status = "tool";
    const read = deferred<Response>();
    const fetch = globalThis.fetch;
    let first = true;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
      if (input.includes("/messages") && first) {
        first = false;
        return read.promise;
      }
      return fetch(input, init);
    });
    const loading = el._reloadLastMessages();
    await el._refreshMessages();
    read.resolve(Response.json({ messages: [{ ...saved, parts: [] }], hasMore: false }));
    await loading;
    expect(el._messages).toEqual([saved]);
    expect(el._status).toBe("idle");
  });

  it("ignores late message reads from another session", async () => {
    const el = pilot();
    const read = deferred<Response>();
    vi.stubGlobal("fetch", () => read.promise);
    const loading = el._reloadLastMessages();
    el._activeSessionId = "session-2";
    read.resolve(Response.json({ messages: [saved], hasMore: false }));
    await loading;
    expect(el._messages).toEqual([]);
  });

  it("ignores timeout events for a different session", () => {
    const el = pilot();
    el._status = "tool";
    el._handleBusEvent(event("agent.timeout", { sessionId: "session-2" }));
    expect(el._recoveryState).toBe("");
    expect(el._status).toBe("tool");
  });

  it("resets cursor and recovery when initializing another instance", async () => {
    const el = pilot();
    el._lastEventId = "55";
    el._recoveryState = "RECONNECTING";
    el.slug = "other";
    await el._init();
    expect(el._lastEventId).toBe("");
    expect(el._recoveryState).toBe("");
    expect(TestEventSource.streams.at(-1)!.url).not.toContain("lastEventId");
  });

  it("ignores a disconnected stream callback", () => {
    const el = pilot();
    el._openStream();
    const old = TestEventSource.streams.at(-1)!;
    el._teardown();
    old.onmessage!(
      new MessageEvent("message", {
        data: JSON.stringify(
          event("message.created", { sessionId: "session-1", role: "assistant" }),
        ),
        lastEventId: "99",
      }),
    );
    expect(el._status).toBe("idle");
    expect(el._lastEventId).toBe("");
  });
});
