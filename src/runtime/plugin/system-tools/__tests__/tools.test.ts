// Smoke test for system-tools plugin: verifies tools are created and callable.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initDatabase } from "../../../../db/schema.js";
import { createSystemTools } from "../tools.js";
import { systemToolsPlugin } from "../index.js";
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

  describe("per-agent tool scoping", () => {
    const VERSION = "0.0.0-test";
    const WORKDIR = "/tmp/test";

    async function toolsFor(agentId: string | undefined): Promise<string[]> {
      const hooks = await systemToolsPlugin({
        instanceSlug: "cp-system",
        ...(agentId !== undefined ? { agentId } : {}),
        workDir: WORKDIR,
        version: VERSION,
        db,
      });
      const tools = hooks.tools
        ? await hooks.tools({
            instanceSlug: "cp-system",
            ...(agentId !== undefined ? { agentId } : {}),
            workDir: WORKDIR,
            version: VERSION,
            db,
          })
        : [];
      return tools.map((t) => t.id).sort();
    }

    it("system-pilot gets read-only tools only (no cp_create_*, no cp_delete_*, no cp_query_db)", async () => {
      const ids = await toolsFor("system-pilot");
      expect(ids).toEqual(
        [
          "cp_get_instance",
          "cp_instance_costs",
          "cp_list_agents",
          "cp_list_blueprints",
          "cp_list_flows",
          "cp_list_instances",
          "cp_list_named_keys",
          "cp_system_health",
        ].sort(),
      );
      expect(ids).not.toContain("cp_create_instance");
      expect(ids).not.toContain("cp_delete_instance");
      expect(ids).not.toContain("cp_query_db");
    });

    it("ops gets all tools except cp_query_db", async () => {
      const ids = await toolsFor("ops");
      expect(ids).toContain("cp_create_instance");
      expect(ids).toContain("cp_delete_instance");
      expect(ids).toContain("cp_start_instance");
      expect(ids).toContain("cp_list_instances");
      expect(ids).not.toContain("cp_query_db");
      expect(ids).toHaveLength(21);
    });

    it("analyst gets read-only tools + cp_query_db (no mutations)", async () => {
      const ids = await toolsFor("analyst");
      expect(ids).toContain("cp_query_db");
      expect(ids).toContain("cp_list_instances");
      expect(ids).toContain("cp_system_health");
      expect(ids).not.toContain("cp_create_instance");
      expect(ids).not.toContain("cp_delete_instance");
      expect(ids).toHaveLength(9);
    });

    it("unknown / legacy agent gets the full tool surface for backwards compat", async () => {
      const ids = await toolsFor("admin-exec");
      expect(ids).toHaveLength(22);
      expect(ids).toContain("cp_query_db");
      expect(ids).toContain("cp_create_instance");
    });

    it("missing agentId (init time) gets the full tool surface", async () => {
      const ids = await toolsFor(undefined);
      expect(ids).toHaveLength(22);
    });
  });
});
