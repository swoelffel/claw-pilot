// src/db/__tests__/schema.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../schema.js";
import { Registry } from "../../core/registry.js";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-test-"));
  dbPath = path.join(tmpDir, "test.db");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("initDatabase", () => {
  it("creates schema on first call", () => {
    const db = initDatabase(dbPath);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("instances");
    expect(names).toContain("agents");
    expect(names).toContain("servers");
    expect(names).toContain("ports");
    expect(names).toContain("config");
    expect(names).toContain("events");
    db.close();
  });

  it("inserts default config", () => {
    const db = initDatabase(dbPath);
    const registry = new Registry(db);
    expect(registry.getConfig("port_range_start")).toBe("18789");
    expect(registry.getConfig("port_range_end")).toBe("18799");
    db.close();
  });

  it("is idempotent (second call does not error)", () => {
    const db1 = initDatabase(dbPath);
    db1.close();
    const db2 = initDatabase(dbPath);
    db2.close();
  });
});
