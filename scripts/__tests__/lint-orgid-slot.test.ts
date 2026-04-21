import { describe, it, expect } from "vitest";
import { extractTables, checkSchema } from "../lint-orgid-slot.js";

const BASE = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT
);
`;

describe("extractTables", () => {
  it("parses multiple tables and returns names + bodies", () => {
    const src = `
      CREATE TABLE IF NOT EXISTS foo (id INTEGER PRIMARY KEY, org_id TEXT NULL);
      CREATE TABLE bar (id INTEGER, CHECK (id > 0));
    `;
    const tables = extractTables(src);
    expect(tables.map((t) => t.name)).toEqual(["foo", "bar"]);
    expect(tables[0]?.body).toContain("org_id TEXT NULL");
    // balanced parens — CHECK clause is included in body
    expect(tables[1]?.body).toContain("CHECK (id > 0)");
  });
});

describe("checkSchema", () => {
  it("passes when a new table carries the org_id slot", () => {
    const current = `${BASE}
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY,
        org_id TEXT NULL,
        name TEXT
      );`;
    const r = checkSchema(current, BASE, new Set());
    expect(r.newTables).toEqual(["agents"]);
    expect(r.violations).toEqual([]);
  });

  it("flags a new table missing the org_id slot", () => {
    const current = `${BASE}
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY,
        name TEXT
      );`;
    const r = checkSchema(current, BASE, new Set());
    expect(r.violations).toEqual(["agents"]);
  });

  it("honours the exceptions allowlist", () => {
    const current = `${BASE}
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );`;
    const r = checkSchema(current, BASE, new Set(["settings"]));
    expect(r.violations).toEqual([]);
  });

  it("ignores tables present in the base branch", () => {
    const current = BASE;
    const r = checkSchema(current, BASE, new Set());
    expect(r.newTables).toEqual([]);
    expect(r.violations).toEqual([]);
  });

  it("accepts NOT NULL variant", () => {
    const current = `${BASE}
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY,
        org_id TEXT NOT NULL
      );`;
    const r = checkSchema(current, BASE, new Set());
    expect(r.violations).toEqual([]);
  });

  it("treats empty base as 'all tables are new'", () => {
    const current = `
      CREATE TABLE IF NOT EXISTS foo (id INTEGER, org_id TEXT NULL);
      CREATE TABLE IF NOT EXISTS bar (id INTEGER);
    `;
    const r = checkSchema(current, "", new Set());
    expect(r.newTables).toEqual(["foo", "bar"]);
    expect(r.violations).toEqual(["bar"]);
  });
});
