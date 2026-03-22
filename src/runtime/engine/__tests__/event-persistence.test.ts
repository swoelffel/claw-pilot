// src/runtime/engine/__tests__/event-persistence.test.ts
//
// Tests for bus → rt_events persistence wiring.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../../db/schema.js";
import { getBus, disposeBus } from "../../bus/index.js";
import {
  SessionCreated,
  MessagePartDelta,
  HeartbeatTick,
  RuntimeError,
  HeartbeatAlert,
} from "../../bus/events.js";
import { wireEventPersistence } from "../event-persistence.js";
import { listRtEvents } from "../../../core/repositories/rt-event-repository.js";
import type { InstanceSlug } from "../../types.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
const SLUG = "test-inst" as InstanceSlug;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-evt-persist-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  disposeBus(SLUG);
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("wireEventPersistence", () => {
  it("persists bus events to rt_events", () => {
    const unsub = wireEventPersistence(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(SessionCreated, {
      sessionId: "s-1" as string,
      agentId: "pilot" as string,
      channel: "web",
    });

    const page = listRtEvents(db, { instanceSlug: SLUG });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.event_type).toBe("session.created");
    expect(page.events[0]!.agent_id).toBe("pilot");
    expect(page.events[0]!.session_id).toBe("s-1");
    expect(page.events[0]!.level).toBe("info");
    expect(page.events[0]!.summary).toBe("Session created for pilot on web");

    unsub();
  });

  it("excludes message.part.delta events", () => {
    const unsub = wireEventPersistence(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(MessagePartDelta, {
      sessionId: "s-1" as string,
      messageId: "m-1" as string,
      partId: "p-1",
      delta: "hello",
    });

    const page = listRtEvents(db, { instanceSlug: SLUG });
    expect(page.events).toHaveLength(0);

    unsub();
  });

  it("excludes heartbeat.tick events", () => {
    const unsub = wireEventPersistence(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(HeartbeatTick, {
      agentId: "pilot" as string,
      instanceSlug: SLUG,
    });

    const page = listRtEvents(db, { instanceSlug: SLUG });
    expect(page.events).toHaveLength(0);

    unsub();
  });

  it("derives error level for runtime.error", () => {
    const unsub = wireEventPersistence(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(RuntimeError, {
      slug: SLUG,
      error: "Something broke",
    });

    const page = listRtEvents(db, { instanceSlug: SLUG });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.level).toBe("error");

    unsub();
  });

  it("derives warn level for heartbeat.alert", () => {
    const unsub = wireEventPersistence(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(HeartbeatAlert, {
      agentId: "pilot" as string,
      instanceSlug: SLUG,
      text: "Agent unresponsive",
    });

    const page = listRtEvents(db, { instanceSlug: SLUG });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.level).toBe("warn");

    unsub();
  });

  it("stops persisting after unsubscribe", () => {
    const unsub = wireEventPersistence(db, SLUG);
    const bus = getBus(SLUG);

    bus.publish(SessionCreated, {
      sessionId: "s-1" as string,
      agentId: "pilot" as string,
      channel: "web",
    });

    unsub();

    bus.publish(SessionCreated, {
      sessionId: "s-2" as string,
      agentId: "build" as string,
      channel: "web",
    });

    const page = listRtEvents(db, { instanceSlug: SLUG });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.session_id).toBe("s-1");
  });
});
