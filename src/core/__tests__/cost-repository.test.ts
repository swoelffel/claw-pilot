// src/core/__tests__/cost-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import {
  getCostSummary,
  getDailyCosts,
  getCostsByAgent,
  getCostsByModel,
  sinceDateFromPeriod,
} from "../repositories/cost-repository.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;

// Helpers to insert test data
function insertSession(id: string, slug: string): void {
  db.prepare(
    `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, state)
     VALUES (?, ?, 'main', 'web', 'active')`,
  ).run(id, slug);
}

function insertMessage(
  id: string,
  sessionId: string,
  opts: {
    agentId?: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    createdAt?: string;
    role?: string;
  } = {},
): void {
  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role, agent_id, model, tokens_in, tokens_out, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    sessionId,
    opts.role ?? "assistant",
    opts.agentId ?? "agent-1",
    opts.model ?? "claude-sonnet-4-6",
    opts.tokensIn ?? 100,
    opts.tokensOut ?? 50,
    opts.costUsd ?? 0.001,
    opts.createdAt ?? new Date().toISOString().slice(0, 19).replace("T", " "),
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-cost-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);

  // Create an instance so FK constraints pass
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: "test-inst",
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-test",
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("sinceDateFromPeriod", () => {
  it("returns 1970 for 'all'", () => {
    expect(sinceDateFromPeriod("all")).toBe("1970-01-01T00:00:00");
  });

  it("returns a date ~7 days ago for '7d'", () => {
    const result = sinceDateFromPeriod("7d");
    const diff = Date.now() - new Date(result).getTime();
    // Should be roughly 7 days (within 1 minute tolerance)
    expect(diff).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });
});

describe("getCostSummary", () => {
  it("returns zeros for empty instance", () => {
    const result = getCostSummary(db, "test-inst", "all");
    expect(result.message_count).toBe(0);
    expect(result.total_tokens_in).toBe(0);
    expect(result.total_tokens_out).toBe(0);
    expect(result.total_cost_usd).toBe(0);
  });

  it("aggregates assistant messages only", () => {
    insertSession("s1", "test-inst");
    insertMessage("m1", "s1", { tokensIn: 100, tokensOut: 50, costUsd: 0.01 });
    insertMessage("m2", "s1", { tokensIn: 200, tokensOut: 100, costUsd: 0.02 });
    // User messages should be excluded
    insertMessage("m3", "s1", { role: "user", tokensIn: 10, tokensOut: 0, costUsd: 0 });

    const result = getCostSummary(db, "test-inst", "all");
    expect(result.message_count).toBe(2);
    expect(result.total_tokens_in).toBe(300);
    expect(result.total_tokens_out).toBe(150);
    expect(result.total_cost_usd).toBeCloseTo(0.03, 6);
  });

  it("filters by period", () => {
    insertSession("s1", "test-inst");
    // Recent message
    insertMessage("m1", "s1", { tokensIn: 100, tokensOut: 50, costUsd: 0.01 });
    // Old message (60 days ago)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    insertMessage("m2", "s1", {
      tokensIn: 500,
      tokensOut: 250,
      costUsd: 0.05,
      createdAt: oldDate.toISOString().slice(0, 19).replace("T", " "),
    });

    const result7d = getCostSummary(db, "test-inst", "7d");
    expect(result7d.message_count).toBe(1);
    expect(result7d.total_tokens_in).toBe(100);

    const resultAll = getCostSummary(db, "test-inst", "all");
    expect(resultAll.message_count).toBe(2);
    expect(resultAll.total_tokens_in).toBe(600);
  });

  it("does not mix instances", () => {
    // Create another instance
    const server = registry.getLocalServer()!;
    registry.createInstance({
      serverId: server.id,
      slug: "other-inst",
      port: 18790,
      configPath: "/tmp/cfg2",
      stateDir: "/tmp/state2",
      systemdUnit: "claw-other",
    });

    insertSession("s1", "test-inst");
    insertSession("s2", "other-inst");
    insertMessage("m1", "s1", { tokensIn: 100, tokensOut: 50, costUsd: 0.01 });
    insertMessage("m2", "s2", { tokensIn: 999, tokensOut: 999, costUsd: 9.99 });

    const result = getCostSummary(db, "test-inst", "all");
    expect(result.message_count).toBe(1);
    expect(result.total_tokens_in).toBe(100);
  });
});

describe("getDailyCosts", () => {
  it("groups by day and model", () => {
    insertSession("s1", "test-inst");
    const today = new Date().toISOString().slice(0, 10) + " 12:00:00";
    insertMessage("m1", "s1", {
      model: "claude-sonnet-4-6",
      tokensIn: 100,
      costUsd: 0.01,
      createdAt: today,
    });
    insertMessage("m2", "s1", {
      model: "claude-haiku-4-5",
      tokensIn: 200,
      costUsd: 0.005,
      createdAt: today,
    });

    const result = getDailyCosts(db, "test-inst", "all");
    expect(result).toHaveLength(2);
    expect(result[0]!.model).toBeTruthy();
    expect(result[1]!.model).toBeTruthy();
  });

  it("returns empty array for no data", () => {
    const result = getDailyCosts(db, "test-inst", "all");
    expect(result).toEqual([]);
  });
});

describe("getCostsByAgent", () => {
  it("aggregates per agent and sorts by cost desc", () => {
    insertSession("s1", "test-inst");
    insertMessage("m1", "s1", { agentId: "cheap-agent", costUsd: 0.001 });
    insertMessage("m2", "s1", { agentId: "expensive-agent", costUsd: 0.1 });
    insertMessage("m3", "s1", { agentId: "expensive-agent", costUsd: 0.2 });

    const result = getCostsByAgent(db, "test-inst", "all");
    expect(result).toHaveLength(2);
    expect(result[0]!.agent_id).toBe("expensive-agent");
    expect(result[0]!.cost_usd).toBeCloseTo(0.3, 6);
    expect(result[0]!.message_count).toBe(2);
    expect(result[1]!.agent_id).toBe("cheap-agent");
  });
});

describe("getCostsByModel", () => {
  it("aggregates per model", () => {
    insertSession("s1", "test-inst");
    insertMessage("m1", "s1", { model: "claude-sonnet-4-6", costUsd: 0.01 });
    insertMessage("m2", "s1", { model: "claude-sonnet-4-6", costUsd: 0.02 });
    insertMessage("m3", "s1", { model: "claude-haiku-4-5", costUsd: 0.001 });

    const result = getCostsByModel(db, "test-inst", "all");
    expect(result).toHaveLength(2);
    expect(result[0]!.model).toBe("claude-sonnet-4-6");
    expect(result[0]!.cost_usd).toBeCloseTo(0.03, 6);
    expect(result[1]!.model).toBe("claude-haiku-4-5");
  });
});
