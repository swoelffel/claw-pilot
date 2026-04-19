/**
 * ui/src/components/__tests__/cp-start-cta.test.ts
 *
 * Unit tests for StartCta._onClick logic.
 *
 * Note: The vitest.ui.config.ts uses environment:"node" and no DOM library is
 * installed (no happy-dom/jsdom). Lit's decorators require a DOM environment
 * for full rendering. These tests therefore mock `lit` and `@lit/localize`
 * and exercise the _onClick method of StartCta directly, simulating the
 * CustomEvent dispatch and postAgentKickoff interactions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks -------------------------------------------------------------------

// Stub Lit so the module loads in Node without a DOM.
vi.mock("lit", () => {
  class FakeLitElement {
    dispatchEvent(_event: Event): boolean {
      return true;
    }
  }
  return {
    LitElement: FakeLitElement,
    html: (strings: TemplateStringsArray, ...values: unknown[]) =>
      String.raw({ raw: strings }, ...values),
    css: (strings: TemplateStringsArray, ...values: unknown[]) =>
      String.raw({ raw: strings }, ...values),
  };
});

vi.mock("lit/decorators.js", () => ({
  customElement: () => (cls: unknown) => cls,
  property: () => () => {},
  state: () => () => {},
}));

vi.mock("@lit/localize", () => ({
  msg: (str: string) => str,
}));

vi.mock("../../api.js", () => ({
  postAgentKickoff: vi.fn(),
}));

// --- Import after mocks -------------------------------------------------------

import { postAgentKickoff } from "../../api.js";
import { StartCta } from "../cp-start-cta.js";

const mockPostAgentKickoff = vi.mocked(postAgentKickoff);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Internal shape exposed for testing. */
interface StartCtaInternal {
  slug: string;
  agentId: string;
  _loading: boolean;
  _error: string | null;
  _onClick: () => Promise<void>;
  dispatchEvent: (evt: Event) => boolean;
  render: () => unknown;
}

/** Create a minimal StartCta instance with slug + agentId set. */
function makeEl(): StartCtaInternal {
  const el = new StartCta() as unknown as StartCtaInternal;
  el.slug = "my-team";
  el.agentId = "agent-42";
  el._loading = false;
  el._error = null;
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StartCta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders: class has a render method", () => {
    const el = new StartCta() as unknown as StartCtaInternal;
    expect(typeof el.render).toBe("function");
  });

  it("clicking while loading is a no-op", async () => {
    const el = makeEl();
    el._loading = true;
    await el._onClick();
    expect(mockPostAgentKickoff).not.toHaveBeenCalled();
  });

  it("clicking sets _loading = true before calling kickoff", async () => {
    let loadingDuringCall = false;
    const el = makeEl();
    mockPostAgentKickoff.mockImplementation(async () => {
      loadingDuringCall = el._loading;
      return { greeting: "Hello!", sessionId: "sess-1" };
    });
    await el._onClick();
    expect(loadingDuringCall).toBe(true);
  });

  it("dispatches cp-kickoff-start before the API call", async () => {
    const events: string[] = [];
    mockPostAgentKickoff.mockImplementation(async () => {
      return { greeting: "Hi", sessionId: "sess-2" };
    });
    const el = makeEl();
    vi.spyOn(el, "dispatchEvent").mockImplementation((evt: Event) => {
      events.push(evt.type);
      return true;
    });
    await el._onClick();
    expect(events[0]).toBe("cp-kickoff-start");
  });

  it("dispatches cp-kickoff-done with sessionId and greeting on success", async () => {
    mockPostAgentKickoff.mockResolvedValue({ greeting: "Bonjour!", sessionId: "sess-99" });
    const el = makeEl();
    const dispatched: CustomEvent[] = [];
    vi.spyOn(el, "dispatchEvent").mockImplementation((evt: Event) => {
      dispatched.push(evt as CustomEvent);
      return true;
    });
    await el._onClick();
    const done = dispatched.find((e) => e.type === "cp-kickoff-done");
    expect(done).toBeDefined();
    expect((done as CustomEvent).detail).toEqual({ sessionId: "sess-99", greeting: "Bonjour!" });
  });

  it("reverts to idle and stores error on network failure", async () => {
    mockPostAgentKickoff.mockRejectedValue(new Error("Network timeout"));
    const el = makeEl();
    await el._onClick();
    expect(el._loading).toBe(false);
    expect(el._error).toBe("Network timeout");
  });

  it("is a no-op when slug is empty", async () => {
    const el = makeEl();
    el.slug = "";
    await el._onClick();
    expect(mockPostAgentKickoff).not.toHaveBeenCalled();
  });

  it("is a no-op when agentId is empty", async () => {
    const el = makeEl();
    el.agentId = "";
    await el._onClick();
    expect(mockPostAgentKickoff).not.toHaveBeenCalled();
  });
});
