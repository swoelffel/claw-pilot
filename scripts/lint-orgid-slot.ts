/**
 * lint-orgid-slot.ts — discipline gate R2.
 *
 * For every **new** table (present in `HEAD:src/db/schema.ts` but not in the
 * base branch) that is not listed in `scripts/orgid-exceptions.json`, enforce
 * the presence of an `org_id TEXT NULL|NOT NULL` column.
 *
 * Base branch resolution:
 *   1. `GITHUB_BASE_REF` (GitHub Actions PR runs)
 *   2. `LINT_BASE_REF` (manual override)
 *   3. `origin/develop` (local pre-push default)
 *
 * Exit code 0 on success, 1 on violation. No autofix.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = "src/db/schema.ts";
const EXCEPTIONS_PATH = "scripts/orgid-exceptions.json";
const ORG_ID_COLUMN = /\borg_id\s+TEXT\s+(NULL|NOT\s+NULL)\b/i;
const TABLE_OPEN =
  /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;

export interface TableDef {
  name: string;
  body: string;
}

/** Extracts `CREATE TABLE <name> (<body>)` blocks from a schema source file. */
export function extractTables(source: string): TableDef[] {
  const tables: TableDef[] = [];
  TABLE_OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TABLE_OPEN.exec(source)) !== null) {
    const name = m[1] ?? "";
    if (!name) continue;
    const start = TABLE_OPEN.lastIndex; // position just after opening '('
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    tables.push({ name, body: source.slice(start, i - 1) });
  }
  return tables;
}

export interface CheckResult {
  violations: string[];
  newTables: string[];
}

export function checkSchema(
  currentSource: string,
  baseSource: string,
  exceptions: Set<string>,
): CheckResult {
  const current = extractTables(currentSource);
  const baseNames = new Set(extractTables(baseSource).map((t) => t.name));
  const violations: string[] = [];
  const newTables: string[] = [];
  for (const t of current) {
    if (baseNames.has(t.name)) continue;
    newTables.push(t.name);
    if (exceptions.has(t.name)) continue;
    if (!ORG_ID_COLUMN.test(t.body)) {
      violations.push(t.name);
    }
  }
  return { violations, newTables };
}

function resolveBaseRef(): string {
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }
  if (process.env.LINT_BASE_REF) return process.env.LINT_BASE_REF;
  return "origin/develop";
}

function loadExceptions(): Set<string> {
  const raw = JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8")) as {
    exceptions: { table: string }[];
  };
  return new Set(raw.exceptions.map((e) => e.table));
}

function loadBaseSchema(baseRef: string): string {
  try {
    return execSync(`git show ${baseRef}:${SCHEMA_PATH}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Base branch not fetched locally — fall back to empty (all tables treated
    // as new). This is conservative: CI always has full history via
    // `actions/checkout` with `fetch-depth: 0`.
    console.error(`[lint:orgid] Unable to read ${baseRef}:${SCHEMA_PATH} — treating all tables as new.`);
    return "";
  }
}

function main(): void {
  const baseRef = resolveBaseRef();
  const currentSource = readFileSync(SCHEMA_PATH, "utf8");
  const baseSource = loadBaseSchema(baseRef);
  const exceptions = loadExceptions();
  const { violations, newTables } = checkSchema(
    currentSource,
    baseSource,
    exceptions,
  );
  if (newTables.length > 0) {
    console.log(`[lint:orgid] new tables vs ${baseRef}: ${newTables.join(", ")}`);
  }
  if (violations.length === 0) {
    console.log("[lint:orgid] OK — all new tables carry the org_id slot.");
    return;
  }
  console.error("");
  console.error("R2 violation — the following new tables are missing the `org_id TEXT NULL` slot:");
  for (const t of violations) console.error(`  - ${t}`);
  console.error("");
  console.error("Add `org_id TEXT NULL` to each table (no FK, no Community logic — just the slot),");
  console.error("or justify the exemption in `scripts/orgid-exceptions.json` (reserved for global tables).");
  process.exit(1);
}

const invoked = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "");
if (invoked) main();
