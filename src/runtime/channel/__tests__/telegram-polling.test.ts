import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:https", () => ({
  get: vi.fn(),
  request: vi.fn(),
}));

vi.mock("../../../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { TelegramPoller } from "../telegram/polling.js";
import type { TelegramUpdate } from "../telegram/polling.js";

function makePoller(overrides: Record<string, unknown> = {}): TelegramPoller {
  return new TelegramPoller({ token: "test-token", ...overrides });
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe("TelegramPoller constructor", () => {
  it("sets default options", () => {
    const poller = makePoller();
    // Access private options for assertion
    const opts = (poller as any).options;
    expect(opts.intervalMs).toBe(1000);
    expect(opts.longPollTimeoutSec).toBe(30);
    expect(opts.allowedUserIds).toEqual([]);
    expect(opts.token).toBe("test-token");
  });

  it("preserves custom options", () => {
    const poller = makePoller({
      intervalMs: 500,
      longPollTimeoutSec: 60,
      allowedUserIds: [123],
    });
    const opts = (poller as any).options;
    expect(opts.intervalMs).toBe(500);
    expect(opts.longPollTimeoutSec).toBe(60);
    expect(opts.allowedUserIds).toEqual([123]);
  });
});

// ---------------------------------------------------------------------------
// isRunning
// ---------------------------------------------------------------------------

describe("isRunning", () => {
  it("is false initially", () => {
    const poller = makePoller();
    expect(poller.isRunning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

describe("start()", () => {
  let poller: TelegramPoller;

  beforeEach(() => {
    poller = makePoller();
  });

  it("sets isRunning to true", () => {
    poller.start(vi.fn());
    expect(poller.isRunning).toBe(true);
    // Clean up to avoid lingering poll loop
    poller.stop();
  });

  it("is idempotent — calling twice does not throw", () => {
    const handler = vi.fn();
    poller.start(handler);
    poller.start(handler); // second call should be a no-op
    expect(poller.isRunning).toBe(true);
    poller.stop();
  });
});

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

describe("stop()", () => {
  it("sets isRunning to false after start", () => {
    const poller = makePoller();
    poller.start(vi.fn());
    poller.stop();
    expect(poller.isRunning).toBe(false);
  });

  it("is safe to call when not running", () => {
    const poller = makePoller();
    expect(() => poller.stop()).not.toThrow();
    expect(poller.isRunning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAllowed (private — tested via direct access)
// ---------------------------------------------------------------------------

describe("isAllowed", () => {
  function callIsAllowed(poller: TelegramPoller, update: TelegramUpdate): boolean {
    return (poller as any).isAllowed(update);
  }

  it("allows all updates when allowedUserIds is empty", () => {
    const poller = makePoller({ allowedUserIds: [] });
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 999, is_bot: false, first_name: "Test" },
        chat: { id: 999, type: "private" },
        text: "hello",
        date: 1234,
      },
    };
    expect(callIsAllowed(poller, update)).toBe(true);
  });

  it("filters by userId when allowedUserIds is set", () => {
    const poller = makePoller({ allowedUserIds: [100] });

    const allowed: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 100, is_bot: false, first_name: "Allowed" },
        chat: { id: 100, type: "private" },
        text: "hi",
        date: 1234,
      },
    };
    expect(callIsAllowed(poller, allowed)).toBe(true);

    const denied: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 2,
        from: { id: 200, is_bot: false, first_name: "Denied" },
        chat: { id: 200, type: "private" },
        text: "hi",
        date: 1234,
      },
    };
    expect(callIsAllowed(poller, denied)).toBe(false);
  });

  it("returns false when from field is missing and allowedUserIds is set", () => {
    const poller = makePoller({ allowedUserIds: [100] });
    const update: TelegramUpdate = {
      update_id: 3,
      message: {
        message_id: 1,
        chat: { id: 1, type: "private" },
        date: 1234,
      },
    };
    expect(callIsAllowed(poller, update)).toBe(false);
  });
});
