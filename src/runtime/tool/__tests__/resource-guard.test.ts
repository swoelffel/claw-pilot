import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import { getCircuit } from "../../../core/repositories/execution-repository.js";
import { executeWithResourceGuard, ToolResourceError, toolResourceKey } from "../resource-guard.js";

describe("resource-aware tool circuit breaker", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("opens immediately for deterministic EACCES and blocks a runaway loop", async () => {
    const error = Object.assign(new Error("permission denied reading /var/log/private.log"), {
      code: "EACCES",
    });
    const call = () =>
      executeWithResourceGuard({
        db,
        instanceSlug: "demo",
        agentId: "analyst",
        identity: "session:user-1",
        toolName: "read",
        args: { filePath: "/var/log/private.log" },
        execute: async () => {
          throw error;
        },
      });

    await expect(call()).rejects.toMatchObject({
      failure: { error_code: "RESOURCE_ACCESS_DENIED", retryable: false, remaining_retries: 0 },
    });
    await expect(call()).rejects.toMatchObject({
      failure: { error_code: "RESOURCE_CIRCUIT_OPEN", remaining_retries: 0 },
    });
  });

  it("groups failures by agent, identity, tool, and resource", async () => {
    const args = { url: "https://connector.example/forbidden" };
    const call = () =>
      executeWithResourceGuard({
        db,
        instanceSlug: "demo",
        agentId: "agent-a",
        identity: "bearer:user-7",
        toolName: "webfetch",
        args,
        execute: async () => {
          throw Object.assign(new Error("HTTP 403 forbidden"), { status: 403 });
        },
      });
    await expect(call()).rejects.toBeInstanceOf(ToolResourceError);
    const key = toolResourceKey("agent-a", "bearer:user-7", "webfetch", args);
    expect(getCircuit(db, "demo", key)).toMatchObject({
      state: "open",
      failure_count: 1,
      threshold: 1,
    });
  });

  it("retains a low retry allowance for transient failures", async () => {
    const call = () =>
      executeWithResourceGuard({
        db,
        instanceSlug: "demo",
        agentId: "agent-a",
        identity: "runtime:agent-a",
        toolName: "webfetch",
        args: { url: "https://connector.example" },
        execute: async () => {
          throw Object.assign(new Error("upstream unavailable"), { status: 503 });
        },
      });
    await expect(call()).rejects.toMatchObject({
      failure: { retryable: true, remaining_retries: 2 },
    });
    await expect(call()).rejects.toMatchObject({ failure: { remaining_retries: 1 } });
    await expect(call()).rejects.toMatchObject({ failure: { remaining_retries: 0 } });
  });
});
