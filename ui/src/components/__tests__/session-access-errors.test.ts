// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { setLocale } from "../../localization.js";
import { StartCta } from "../cp-start-cta.js";
import { HomeChat } from "../home-chat.js";
import { RuntimePilot } from "../runtime-pilot.js";

interface ChatState {
  slug: string;
  sessionId?: string;
  _status: string;
  _error: string;
  _context: unknown;
  _messages: unknown[];
  _onSendMessage(event: CustomEvent<{ text: string }>): Promise<void>;
  _init(): Promise<void>;
  _teardown(): void;
  render(): unknown;
}
class TestStream {
  static count = 0;
  constructor() {
    TestStream.count++;
  }
  close() {}
  addEventListener() {}
}
let chats: ChatState[];
let failure: "sessions" | "messages" | null;
let calls: string[];
const denied = "Action runtime.sessions-list not permitted on runtime";
const friendly =
  "You do not have the permissions required for this action. Contact an administrator.";
beforeEach(() => {
  chats = [];
  calls = [];
  failure = "sessions";
  TestStream.count = 0;
  vi.stubGlobal("EventSource", TestStream);
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = new URL(input, "http://localhost");
    calls.push(url.pathname);
    if (url.pathname.endsWith("/runtime/sessions")) {
      if (failure === "sessions")
        return Response.json({ code: "PERMISSION_DENIED", error: denied }, { status: 403 });
      return Response.json({
        sessions:
          failure === "messages"
            ? [
                {
                  id: "session-1",
                  persistent: true,
                  state: "active",
                  agentIsDefault: true,
                  updatedAt: "2026-01-01",
                },
              ]
            : [],
        hasMore: false,
      });
    }
    if (url.pathname.endsWith("/messages"))
      return Response.json({ code: "PERMISSION_DENIED", error: denied }, { status: 403 });
    if (url.pathname.endsWith("/context"))
      return Response.json({
        agent: { id: "pilot", name: "Pilot", model: "test" },
        tokenUsage: { estimated: 0 },
      });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
});
afterEach(async () => {
  await setLocale("en");
  for (const chat of chats) chat._teardown();
  vi.unstubAllGlobals();
});
function chat(ctor: typeof HomeChat | typeof RuntimePilot): ChatState {
  const el = new ctor() as unknown as ChatState;
  el.slug = "demo";
  chats.push(el);
  return el;
}
function view(el: ChatState) {
  const host = document.createElement("div");
  render(el.render(), host);
  return host;
}
describe.each([
  ["Home", HomeChat],
  ["Pilot", RuntimePilot],
] as const)("%s session load permissions", (_name, ctor) => {
  it("surfaces denied discovery instead of treating it as an empty session", async () => {
    const el = chat(ctor);
    await el._init();
    expect(el._status).toBe("error");
    expect(el._error).toBe(friendly);
    expect(view(el).querySelector("cp-start-cta")).toBeNull();
    expect(view(el).textContent).toContain(friendly);
    expect(TestStream.count).toBe(0);
    expect(calls).toHaveLength(1);
    el._status = "idle";
    expect(view(el).querySelector("cp-start-cta")).toBeNull();
  });
  it("does not offer kickoff when canonical message loading is denied", async () => {
    failure = "messages";
    const el = chat(ctor);
    await el._init();
    expect(el._status).toBe("error");
    expect(view(el).querySelector("cp-start-cta")).toBeNull();
    expect(view(el).textContent).toContain(friendly);
    expect(TestStream.count).toBe(0);
  });
  it.each(["sessions", "messages"])(
    "ignores a late denied %s read from the previous instance",
    async (phase) => {
      let finish!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        finish = resolve;
      });
      vi.stubGlobal("fetch", async (input: string) => {
        const url = new URL(input, "http://localhost");
        if (
          url.pathname.includes("/old/") &&
          url.pathname.endsWith(phase === "sessions" ? "/runtime/sessions" : "/messages")
        )
          return pending;
        if (url.pathname.endsWith("/runtime/sessions"))
          return Response.json({
            sessions: url.pathname.includes("/old/")
              ? [
                  {
                    id: "old-session",
                    persistent: true,
                    state: "active",
                    agentIsDefault: true,
                    updatedAt: "2026-01-01",
                  },
                ]
              : [],
            hasMore: false,
          });
        if (url.pathname.endsWith("/context")) return Response.json(null);
        throw new Error(`Unexpected request ${url.pathname}`);
      });
      const el = chat(ctor);
      el.slug = "old";
      const oldLoad = el._init();
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      if (phase === "messages") await new Promise((resolve) => setTimeout(resolve, 0));
      el.slug = "current";
      await el._init();
      finish(Response.json({ code: "PERMISSION_DENIED", error: denied }, { status: 403 }));
      await oldLoad;
      expect(el._status).toBe("idle");
      expect(el._error).toBe("");
      expect(TestStream.count).toBe(1);
    },
  );
  it("explains missing rights when sending without retrying the request", async () => {
    const post = vi.fn(async () =>
      Response.json(
        { code: "PERMISSION_DENIED", error: "Action runtime.chat not permitted on runtime" },
        { status: 403 },
      ),
    );
    vi.stubGlobal("fetch", post);
    const el = chat(ctor);
    await el._onSendMessage(new CustomEvent("send-message", { detail: { text: "Hello" } }));
    expect(el._error).toBe(friendly);
    expect(view(el).textContent).toContain(friendly);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
it("still offers Home kickoff for a successfully read empty session list", async () => {
  failure = null;
  const el = chat(HomeChat);
  await el._init();
  expect(el._status).toBe("idle");
  expect(view(el).querySelector("cp-start-cta")).not.toBeNull();
});

it("shows the permission explanation in French", async () => {
  await setLocale("fr");
  const el = chat(HomeChat);
  await el._init();
  expect(view(el).textContent).toContain(
    "Vous n’avez pas les droits nécessaires pour effectuer cette action. Contactez un administrateur.",
  );
});
it("explains a denied kickoff without exposing the internal action name", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json(
      { code: "PERMISSION_DENIED", error: "Action agent.kickoff not permitted on agent:pilot" },
      { status: 403 },
    ),
  );
  const el = new StartCta() as unknown as {
    slug: string;
    agentId: string;
    _error: string;
    _onClick(): Promise<void>;
    render(): unknown;
  };
  el.slug = "demo";
  el.agentId = "pilot";
  await el._onClick();
  expect(el._error).toBe(friendly);
  const host = document.createElement("div");
  render(el.render(), host);
  expect(host.textContent).toContain(friendly);
});
