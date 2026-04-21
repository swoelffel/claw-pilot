// Smoke test for system-tools plugin: verifies tools are created and callable.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initDatabase } from "../../../../db/schema.js";
import { createSystemTools } from "../tools.js";
import {
  bootstrapTestRegistry,
  resetServerRegistry,
} from "../../../../server/__tests__/_helpers/with-registry.js";
import type Database from "better-sqlite3";

describe("system-tools plugin", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = initDatabase(":memory:");
    bootstrapTestRegistry(db, "localhost", "/tmp/test");
  });

  afterAll(() => {
    resetServerRegistry();
    db.close();
  });

  afterAll(() => {
    db.close();
  });

  it("creates the expected number of tools", () => {
    const tools = createSystemTools(db, "cp-system");
    expect(tools.length).toBe(22);
  });

  it("all tools have unique IDs starting with cp_", () => {
    const tools = createSystemTools(db, "cp-system");
    const ids = tools.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^cp_/);
    }
  });

  it("cp_list_instances returns empty array on fresh DB", async () => {
    const tools = createSystemTools(db, "cp-system");
    const listTool = tools.find((t) => t.id === "cp_list_instances")!;
    const def = await listTool.init();
    const result = await def.execute({}, {} as never);
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(0);
  });

  it("cp_system_health returns summary on fresh DB", async () => {
    const tools = createSystemTools(db, "cp-system");
    const healthTool = tools.find((t) => t.id === "cp_system_health")!;
    const def = await healthTool.init();
    const result = await def.execute({}, {} as never);
    const parsed = JSON.parse(result.output);
    expect(parsed.totalInstances).toBe(0);
    expect(parsed.running).toBe(0);
  });

  it("cp_query_db rejects non-SELECT statements", async () => {
    const tools = createSystemTools(db, "cp-system");
    const queryTool = tools.find((t) => t.id === "cp_query_db")!;
    const def = await queryTool.init();
    const result = await def.execute({ sql: "DROP TABLE instances" }, {} as never);
    expect(result.output).toContain("Error");
    expect(result.output).toContain("SELECT");
  });

  it("cp_query_db executes valid SELECT", async () => {
    const tools = createSystemTools(db, "cp-system");
    const queryTool = tools.find((t) => t.id === "cp_query_db")!;
    const def = await queryTool.init();
    const result = await def.execute({ sql: "SELECT count(*) as cnt FROM instances" }, {} as never);
    const parsed = JSON.parse(result.output);
    expect(parsed.rows).toBeDefined();
    expect(parsed.rows[0].cnt).toBe(0);
  });

  it("cp_list_named_keys returns empty array on fresh DB", async () => {
    const tools = createSystemTools(db, "cp-system");
    const keysTool = tools.find((t) => t.id === "cp_list_named_keys")!;
    const def = await keysTool.init();
    const result = await def.execute({}, {} as never);
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
