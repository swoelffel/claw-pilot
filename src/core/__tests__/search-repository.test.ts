// src/core/__tests__/search-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { createTask } from "../repositories/task-repository.js";
import {
  upsertSearchEntry,
  removeSearchEntry,
  searchEntities,
  rebuildSearchIndex,
} from "../repositories/search-repository.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-search-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
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

// ---------------------------------------------------------------------------
// upsertSearchEntry
// ---------------------------------------------------------------------------

describe("upsertSearchEntry", () => {
  it("inserts a new entry and makes it searchable", () => {
    upsertSearchEntry(db, {
      entityType: "instance",
      entityId: "test-inst",
      title: "Test Instance",
      subtitle: "running",
      routeHash: "/instances/test-inst/builder",
    });

    const results = searchEntities(db, "Test");
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe("instance");
    expect(results[0]!.id).toBe("test-inst");
    expect(results[0]!.title).toBe("Test Instance");
    expect(results[0]!.subtitle).toBe("running");
    expect(results[0]!.route).toBe("/instances/test-inst/builder");
  });

  it("updates an existing entry without creating duplicates", () => {
    upsertSearchEntry(db, {
      entityType: "instance",
      entityId: "test-inst",
      title: "Old Name",
      subtitle: "stopped",
      routeHash: "/instances/test-inst/builder",
    });

    upsertSearchEntry(db, {
      entityType: "instance",
      entityId: "test-inst",
      title: "New Name",
      subtitle: "running",
      routeHash: "/instances/test-inst/builder",
    });

    const results = searchEntities(db, "Name");
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("New Name");
    expect(results[0]!.subtitle).toBe("running");

    // Old name should not be searchable
    const oldResults = searchEntities(db, "Old");
    expect(oldResults).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// removeSearchEntry
// ---------------------------------------------------------------------------

describe("removeSearchEntry", () => {
  it("removes an entry from the index", () => {
    upsertSearchEntry(db, {
      entityType: "instance",
      entityId: "test-inst",
      title: "Test Instance",
      subtitle: "running",
      routeHash: "/instances/test-inst/builder",
    });

    removeSearchEntry(db, "instance", "test-inst");

    const results = searchEntities(db, "Test");
    expect(results).toHaveLength(0);
  });

  it("does nothing for non-existent entry", () => {
    // Should not throw
    removeSearchEntry(db, "instance", "non-existent");
  });
});

// ---------------------------------------------------------------------------
// searchEntities
// ---------------------------------------------------------------------------

describe("searchEntities", () => {
  it("returns results ranked by BM25", () => {
    upsertSearchEntry(db, {
      entityType: "instance",
      entityId: "alpha",
      title: "Alpha Production",
      subtitle: "running",
      routeHash: "/instances/alpha/builder",
    });
    upsertSearchEntry(db, {
      entityType: "task",
      entityId: "1",
      title: "Deploy to Alpha",
      subtitle: "alpha · pending",
      routeHash: "/instances/alpha/tasks",
    });

    const results = searchEntities(db, "Alpha");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Both should appear
    const types = results.map((r) => r.type);
    expect(types).toContain("instance");
    expect(types).toContain("task");
  });

  it("supports prefix matching", () => {
    upsertSearchEntry(db, {
      entityType: "agent",
      entityId: "test-inst:build-agent",
      title: "build-agent",
      subtitle: "test-inst",
      routeHash: "/instances/test-inst/builder",
    });

    // cspell:disable-next-line
    const results = searchEntities(db, "buil");
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("build-agent");
  });

  it("returns empty array for empty query", () => {
    upsertSearchEntry(db, {
      entityType: "instance",
      entityId: "test-inst",
      title: "Test",
      subtitle: "",
      routeHash: "/instances/test-inst/builder",
    });

    expect(searchEntities(db, "")).toEqual([]);
    expect(searchEntities(db, "   ")).toEqual([]);
  });

  it("handles FTS5 special characters gracefully", () => {
    upsertSearchEntry(db, {
      entityType: "instance",
      entityId: "test-inst",
      title: "Test",
      subtitle: "",
      routeHash: "/instances/test-inst/builder",
    });

    // Should not throw
    expect(searchEntities(db, '"invalid"')).toEqual([]);
    expect(searchEntities(db, "***")).toEqual([]);
    expect(searchEntities(db, "()")).toEqual([]);
    expect(searchEntities(db, "AND OR NOT")).toEqual([]);
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      upsertSearchEntry(db, {
        entityType: "task",
        entityId: String(i),
        title: `Test Task ${i}`,
        subtitle: "test-inst",
        routeHash: "/instances/test-inst/tasks",
      });
    }

    const results = searchEntities(db, "Test", 3);
    expect(results).toHaveLength(3);
  });

  it("searches across multiple entity types", () => {
    upsertSearchEntry(db, {
      entityType: "instance",
      entityId: "demo",
      title: "Demo Server",
      subtitle: "running",
      routeHash: "/instances/demo/builder",
    });
    upsertSearchEntry(db, {
      entityType: "blueprint",
      entityId: "1",
      title: "Demo Blueprint",
      subtitle: "template",
      routeHash: "/blueprints/1/builder",
    });
    upsertSearchEntry(db, {
      entityType: "agent_blueprint",
      entityId: "demo-tpl",
      title: "Demo Template",
      subtitle: "general",
      routeHash: "/agent-templates/demo-tpl",
    });

    const results = searchEntities(db, "Demo");
    expect(results).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// rebuildSearchIndex
// ---------------------------------------------------------------------------

describe("rebuildSearchIndex", () => {
  it("indexes all entity types from source tables", () => {
    // Instance already exists from beforeEach (test-inst)

    // Add an agent
    registry.createAgent(1, {
      agentId: "build-agent",
      name: "Build Agent",
      model: "claude-sonnet-4-6",
      workspacePath: "/tmp/ws",
    });

    // Add a task
    createTask(db, {
      instanceSlug: "test-inst",
      title: "Fix the bug",
      createdBy: "user",
    });

    // Add a blueprint
    registry.createBlueprint({ name: "Dev Team" });

    // Rebuild
    rebuildSearchIndex(db);

    // Verify all are searchable
    const instResults = searchEntities(db, "test-inst");
    expect(instResults.length).toBeGreaterThanOrEqual(1);
    expect(instResults.some((r) => r.type === "instance")).toBe(true);

    const agentResults = searchEntities(db, "Build Agent");
    expect(agentResults.length).toBeGreaterThanOrEqual(1);
    expect(agentResults.some((r) => r.type === "agent")).toBe(true);

    const taskResults = searchEntities(db, "Fix the bug");
    expect(taskResults.length).toBeGreaterThanOrEqual(1);
    expect(taskResults.some((r) => r.type === "task")).toBe(true);

    const bpResults = searchEntities(db, "Dev Team");
    expect(bpResults.length).toBeGreaterThanOrEqual(1);
    expect(bpResults.some((r) => r.type === "blueprint")).toBe(true);
  });

  it("clears previous index before rebuilding", () => {
    // Insert something manually
    upsertSearchEntry(db, {
      entityType: "instance",
      entityId: "ghost",
      title: "Ghost Instance",
      subtitle: "",
      routeHash: "/instances/ghost/builder",
    });

    // Rebuild should clear the ghost (it's not in the DB)
    rebuildSearchIndex(db);

    const ghostResults = searchEntities(db, "Ghost");
    expect(ghostResults).toHaveLength(0);

    // But real instance should be there
    const realResults = searchEntities(db, "test-inst");
    expect(realResults.length).toBeGreaterThanOrEqual(1);
  });

  it("generates correct route hashes", () => {
    registry.createAgent(1, {
      agentId: "my-agent",
      name: "My Agent",
      model: "claude-sonnet-4-6",
      workspacePath: "/tmp/ws",
    });

    createTask(db, {
      instanceSlug: "test-inst",
      title: "Task One",
      createdBy: "user",
    });

    rebuildSearchIndex(db);

    const instResults = searchEntities(db, "test-inst");
    const inst = instResults.find((r) => r.type === "instance");
    expect(inst?.route).toBe("/instances/test-inst/builder");

    const agentResults = searchEntities(db, "My Agent");
    const agent = agentResults.find((r) => r.type === "agent");
    expect(agent?.route).toBe("/instances/test-inst/builder");

    const taskResults = searchEntities(db, "Task One");
    const task = taskResults.find((r) => r.type === "task");
    expect(task?.route).toBe("/instances/test-inst/tasks");
  });
});
