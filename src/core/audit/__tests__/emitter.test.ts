// src/core/audit/__tests__/emitter.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  emitAudit,
  flushAudit,
  registerAuditSink,
  resetAuditBus,
  isAuditBusRegistered,
  DEFAULT_SINK_BRAND,
  shutdownAuditBus,
  type AuditSink,
} from "../emitter.js";
import type { AuditEventEnvelope } from "../events.js";

function makeDefaultSink(): AuditSink & { records: AuditEventEnvelope[] } {
  const records: AuditEventEnvelope[] = [];
  return {
    kind: "memory",
    [DEFAULT_SINK_BRAND]: true,
    records,
    write(env) {
      records.push(env);
      return Promise.resolve();
    },
  } as AuditSink & { records: AuditEventEnvelope[] };
}

describe("audit emitter", () => {
  beforeEach(() => {
    resetAuditBus();
  });

  afterEach(() => {
    resetAuditBus();
  });

  it("drops emits that happen before a sink is registered", () => {
    expect(isAuditBusRegistered()).toBe(false);
    expect(() => emitAudit({ kind: "auth.logout", userId: "u1" })).not.toThrow();
  });

  it("delivers envelopes to registered sinks after flushAudit()", async () => {
    const sink = makeDefaultSink();
    registerAuditSink(sink);
    emitAudit({ kind: "auth.logout", userId: "u1" });
    await flushAudit();
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({
      kind: "auth.logout",
      userId: "u1",
      serverId: expect.any(String),
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("flushes automatically when the buffer reaches the threshold", async () => {
    const sink = makeDefaultSink();
    registerAuditSink(sink);
    for (let i = 0; i < 100; i++) {
      emitAudit({ kind: "auth.logout", userId: `u${i}` });
    }
    // Threshold flush schedules a microtask; await it.
    await new Promise((r) => setTimeout(r, 0));
    await flushAudit();
    expect(sink.records.length).toBeGreaterThanOrEqual(100);
  });

  it("swallows sink errors so one broken sink cannot block the others", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const good = makeDefaultSink();
    const bad: AuditSink = {
      kind: "bad",
      [DEFAULT_SINK_BRAND]: true,
      write: () => Promise.reject(new Error("boom")),
    } as unknown as AuditSink;
    registerAuditSink(bad);
    registerAuditSink(good);
    emitAudit({ kind: "auth.logout", userId: "u1" });
    await flushAudit();
    expect(good.records).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it("shutdownAuditBus drains the buffer", async () => {
    const sink = makeDefaultSink();
    registerAuditSink(sink);
    emitAudit({ kind: "auth.logout", userId: "u1" });
    await shutdownAuditBus();
    expect(sink.records).toHaveLength(1);
  });
});

describe("audit sink gate", () => {
  beforeEach(() => {
    resetAuditBus();
  });

  it("refuses an un-branded sink without the audit-siem capability", () => {
    const external: AuditSink = {
      kind: "splunk-fake",
      write: () => Promise.resolve(),
    };
    expect(() => registerAuditSink(external)).toThrow(/audit-siem/);
  });

  it("accepts default-branded sinks without a capability check", () => {
    const sink = makeDefaultSink();
    expect(() => registerAuditSink(sink)).not.toThrow();
  });
});
