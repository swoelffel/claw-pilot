// src/core/__tests__/rt-event-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import {
  deriveLevel,
  deriveSummary,
  isExcluded,
  insertRtEvent,
  listRtEvents,
  pruneRtEvents,
} from "../repositories/rt-event-repository.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-rt-event-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedEvents(slug: string, count: number): void {
  for (let i = 0; i < count; i++) {
    insertRtEvent(db, {
      instanceSlug: slug,
      eventType: "session.created",
      agentId: `agent-${i % 3}`,
      sessionId: `s-${i}`,
      level: "info",
      summary: `Event ${i}`,
      payload: JSON.stringify({ index: i }),
    });
  }
}

// ---------------------------------------------------------------------------
// deriveLevel
// ---------------------------------------------------------------------------

describe("deriveLevel", () => {
  it("returns error for error event types", () => {
    expect(deriveLevel("runtime.error")).toBe("error");
    expect(deriveLevel("provider.auth_failed")).toBe("error");
    expect(deriveLevel("tool.doom_loop")).toBe("error");
    expect(deriveLevel("llm.chunk_timeout")).toBe("error");
    expect(deriveLevel("agent.timeout")).toBe("error");
  });

  it("returns warn for warning event types", () => {
    expect(deriveLevel("heartbeat.alert")).toBe("warn");
    expect(deriveLevel("provider.failover")).toBe("warn");
  });

  it("returns info for all other event types", () => {
    expect(deriveLevel("session.created")).toBe("info");
    expect(deriveLevel("message.created")).toBe("info");
    expect(deriveLevel("runtime.started")).toBe("info");
    expect(deriveLevel("channel.message.received")).toBe("info");
  });
});

// ---------------------------------------------------------------------------
// isExcluded
// ---------------------------------------------------------------------------

describe("isExcluded", () => {
  it("excludes message.part.delta and heartbeat.tick", () => {
    expect(isExcluded("message.part.delta")).toBe(true);
    expect(isExcluded("heartbeat.tick")).toBe(true);
  });

  it("does not exclude other types", () => {
    expect(isExcluded("session.created")).toBe(false);
    expect(isExcluded("runtime.error")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveSummary
// ---------------------------------------------------------------------------

describe("deriveSummary", () => {
  it("generates readable summaries for known types", () => {
    expect(deriveSummary("runtime.started", { slug: "demo" })).toBe("Runtime started");
    expect(deriveSummary("session.created", { agentId: "pilot", channel: "web" })).toBe(
      "Session created for pilot on web",
    );
    expect(
      deriveSummary("provider.failover", {
        providerId: "anthropic",
        fromProfileId: "p1",
        toProfileId: "p2",
      }),
    ).toBe("Failover anthropic: p1 → p2");
    expect(deriveSummary("tool.doom_loop", { toolName: "bash" })).toBe("Doom loop: bash");
  });

  it("returns the event type as fallback for unknown types", () => {
    expect(deriveSummary("custom.event", {})).toBe("custom.event");
  });
});

// ---------------------------------------------------------------------------
// insertRtEvent + listRtEvents
// ---------------------------------------------------------------------------

describe("insertRtEvent", () => {
  it("inserts an event and retrieves it", () => {
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "session.created",
      agentId: "pilot",
      sessionId: "s-1",
      level: "info",
      summary: "Session created for pilot on web",
      payload: JSON.stringify({ sessionId: "s-1", agentId: "pilot", channel: "web" }),
    });

    const page = listRtEvents(db, { instanceSlug: "demo" });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.event_type).toBe("session.created");
    expect(page.events[0]!.agent_id).toBe("pilot");
    expect(page.events[0]!.session_id).toBe("s-1");
    expect(page.events[0]!.level).toBe("info");
    expect(page.events[0]!.summary).toBe("Session created for pilot on web");
    expect(page.nextCursor).toBeNull();
  });

  it("inserts with null optional fields", () => {
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "runtime.started",
      level: "info",
      payload: JSON.stringify({ slug: "demo" }),
    });

    const page = listRtEvents(db, { instanceSlug: "demo" });
    expect(page.events[0]!.agent_id).toBeNull();
    expect(page.events[0]!.session_id).toBeNull();
  });
});

describe("listRtEvents", () => {
  it("returns events in descending ID order", () => {
    seedEvents("demo", 5);

    const page = listRtEvents(db, { instanceSlug: "demo" });
    expect(page.events).toHaveLength(5);
    for (let i = 1; i < page.events.length; i++) {
      expect(page.events[i - 1]!.id).toBeGreaterThan(page.events[i]!.id);
    }
  });

  it("returns empty page for unknown instance", () => {
    seedEvents("demo", 3);
    const page = listRtEvents(db, { instanceSlug: "other" });
    expect(page.events).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });

  it("supports cursor-based pagination", () => {
    seedEvents("demo", 10);

    const page1 = listRtEvents(db, { instanceSlug: "demo", limit: 4 });
    expect(page1.events).toHaveLength(4);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = listRtEvents(db, {
      instanceSlug: "demo",
      limit: 4,
      cursor: page1.nextCursor!,
    });
    expect(page2.events).toHaveLength(4);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = listRtEvents(db, {
      instanceSlug: "demo",
      limit: 4,
      cursor: page2.nextCursor!,
    });
    expect(page3.events).toHaveLength(2);
    expect(page3.nextCursor).toBeNull();

    // No overlap between pages
    const allIds = [
      ...page1.events.map((e) => e.id),
      ...page2.events.map((e) => e.id),
      ...page3.events.map((e) => e.id),
    ];
    expect(new Set(allIds).size).toBe(10);
  });

  it("caps limit at 200", () => {
    seedEvents("demo", 5);
    // Requesting limit=999 should behave as max 200
    const page = listRtEvents(db, { instanceSlug: "demo", limit: 999 });
    expect(page.events).toHaveLength(5);
  });

  it("filters by types", () => {
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "session.created",
      level: "info",
      payload: "{}",
    });
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "runtime.error",
      level: "error",
      payload: "{}",
    });
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "message.created",
      level: "info",
      payload: "{}",
    });

    const page = listRtEvents(db, {
      instanceSlug: "demo",
      types: ["session.created", "message.created"],
    });
    expect(page.events).toHaveLength(2);
    expect(page.events.every((e) => e.event_type !== "runtime.error")).toBe(true);
  });

  it("filters by agentId", () => {
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "session.created",
      agentId: "pilot",
      level: "info",
      payload: "{}",
    });
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "session.created",
      agentId: "build",
      level: "info",
      payload: "{}",
    });

    const page = listRtEvents(db, { instanceSlug: "demo", agentId: "pilot" });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.agent_id).toBe("pilot");
  });

  it("filters by level", () => {
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "session.created",
      level: "info",
      payload: "{}",
    });
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "runtime.error",
      level: "error",
      payload: "{}",
    });

    const page = listRtEvents(db, { instanceSlug: "demo", level: "error" });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.level).toBe("error");
  });

  it("combines multiple filters", () => {
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "runtime.error",
      agentId: "pilot",
      level: "error",
      payload: "{}",
    });
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "runtime.error",
      agentId: "build",
      level: "error",
      payload: "{}",
    });
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "session.created",
      agentId: "pilot",
      level: "info",
      payload: "{}",
    });

    const page = listRtEvents(db, {
      instanceSlug: "demo",
      level: "error",
      agentId: "pilot",
    });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.agent_id).toBe("pilot");
    expect(page.events[0]!.level).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// pruneRtEvents
// ---------------------------------------------------------------------------

describe("pruneRtEvents", () => {
  it("deletes events older than the threshold", () => {
    // Insert an old event by manipulating created_at
    db.prepare(
      `INSERT INTO rt_events (instance_slug, event_type, level, payload, created_at)
       VALUES (?, ?, ?, ?, datetime('now', '-10 days'))`,
    ).run("demo", "session.created", "info", "{}");

    // Insert a recent event
    insertRtEvent(db, {
      instanceSlug: "demo",
      eventType: "session.created",
      level: "info",
      payload: "{}",
    });

    const deleted = pruneRtEvents(db, "demo", 7);
    expect(deleted).toBe(1);

    const page = listRtEvents(db, { instanceSlug: "demo" });
    expect(page.events).toHaveLength(1);
  });

  it("does not delete events from other instances", () => {
    db.prepare(
      `INSERT INTO rt_events (instance_slug, event_type, level, payload, created_at)
       VALUES (?, ?, ?, ?, datetime('now', '-10 days'))`,
    ).run("other", "session.created", "info", "{}");

    const deleted = pruneRtEvents(db, "demo", 7);
    expect(deleted).toBe(0);

    const page = listRtEvents(db, { instanceSlug: "other" });
    expect(page.events).toHaveLength(1);
  });

  it("returns 0 when no events to prune", () => {
    const deleted = pruneRtEvents(db, "demo", 7);
    expect(deleted).toBe(0);
  });
});
