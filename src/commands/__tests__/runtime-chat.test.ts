/**
 * commands/__tests__/runtime-chat.test.ts
 *
 * Integration tests for `claw-pilot runtime chat <slug> --once <message>`.
 *
 * These tests spawn the compiled CLI (dist/index.mjs) and verify stdout/exit codes.
 * They require ANTHROPIC_API_KEY in the environment and make real LLM calls.
 * Tests are skipped automatically when the key is absent (e.g. in CI without secrets).
 *
 * Prerequisites: `pnpm build:cli` must have been run before these tests.
 *
 * Setup strategy:
 * - A temporary HOME directory is created for each test run
 * - The CLI is invoked with HOME=<tmpHome> so it uses an isolated DB
 * - initDatabase() is used to create the full schema, then the instance row
 *   is inserted so that `createSession` FK constraint is satisfied
 * - openclaw_home in the servers table is set to tmpHome so getStateDir()
 *   resolves correctly
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase } from "../../db/schema.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Skip guard — no API key = no real LLM calls
// ---------------------------------------------------------------------------

const HAS_API_KEY = Boolean(process.env["ANTHROPIC_API_KEY"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLI = join(import.meta.dirname, "../../../dist/index.mjs");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], baseEnv: Record<string, string> = {}): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI, ...args], {
      timeout: 60_000,
      env: { ...process.env, ...baseEnv },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Temp HOME + DB setup
// ---------------------------------------------------------------------------

let tmpHome: string;
const SLUG = "test-integration-once";

/** Minimal runtime.json for the test instance */
function writeRuntimeJson(stateDir: string) {
  mkdirSync(stateDir, { recursive: true });
  const config = {
    defaultModel: "anthropic/claude-haiku-4-5",
    agents: [
      {
        id: "main",
        name: "main",
        model: "anthropic/claude-haiku-4-5",
        permissions: [],
        maxSteps: 3,
        allowSubAgents: false,
        toolProfile: "coding",
        isDefault: true,
      },
    ],
    mcpEnabled: false,
    mcpServers: [],
    webChat: { enabled: false },
    telegram: { enabled: false },
    providers: [],
  };
  writeFileSync(join(stateDir, "runtime.json"), JSON.stringify(config, null, 2));
}

/** Shared env for all CLI invocations — points HOME to the isolated tmpHome */
function cliEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    HOME: tmpHome,
    ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "",
    ...extra,
  };
}

beforeAll(() => {
  // Create isolated HOME for this test run
  tmpHome = mkdtempSync(join(tmpdir(), "claw-pilot-integration-"));

  // Create ~/.claw-pilot/ directory
  const dataDir = join(tmpHome, ".claw-pilot");
  mkdirSync(dataDir, { recursive: true });

  // Use initDatabase() to create the full schema (all migrations applied)
  const dbPath = join(dataDir, "registry.db");
  const db = initDatabase(dbPath);

  // Insert server with openclaw_home = tmpHome so getStateDir() resolves correctly
  db.prepare(`INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', ?)`).run(
    tmpHome,
  );
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };

  // Insert the test instance
  db.prepare(
    `INSERT OR IGNORE INTO instances
     (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, SLUG, 19099, "/tmp/config.json", "/tmp/state", `openclaw-${SLUG}.service`);

  db.close();

  // Create the state dir + runtime.json for the test slug
  // getRuntimeStateDir(slug) = ~/.claw-pilot/instances/<slug>
  const stateDir = join(tmpHome, ".claw-pilot/instances", SLUG);
  writeRuntimeJson(stateDir);
});

afterAll(() => {
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runtime chat --once", () => {
  it.skipIf(!HAS_API_KEY)(
    "returns a response and exits 0 for a simple question",
    async () => {
      const result = await runCli(
        ["runtime", "chat", SLUG, "--agent", "main", "--once", "Reply with exactly: PONG"],
        cliEnv(),
      );

      expect(result.exitCode).toBe(0);
      // stdout should contain the agent response prefix
      expect(result.stdout).toMatch(/Agent:/);
      // Should contain token info line
      expect(result.stdout).toMatch(/\[.*tokens.*\]/);
    },
    90_000,
  );

  it.skipIf(!HAS_API_KEY)(
    "stdout contains the response text",
    async () => {
      const result = await runCli(
        [
          "runtime",
          "chat",
          SLUG,
          "--agent",
          "main",
          "--once",
          "What is 1+1? Reply with just the number.",
        ],
        cliEnv(),
      );

      expect(result.exitCode).toBe(0);
      // The response should contain "2"
      expect(result.stdout).toContain("2");
    },
    90_000,
  );
});

describe("runtime chat --once — error cases", () => {
  it("exits 1 when runtime.json is missing and --ensure-config is not passed", async () => {
    // Use a slug that has no state dir
    const result = await runCli(
      ["runtime", "chat", "nonexistent-slug-xyz-abc-999", "--once", "hello"],
      cliEnv(),
    );

    expect(result.exitCode).toBe(1);
  });

  it.skipIf(!HAS_API_KEY)(
    "exits 1 when an invalid model format is specified",
    async () => {
      const result = await runCli(
        ["runtime", "chat", SLUG, "--model", "invalid-format", "--once", "hello"],
        cliEnv(),
      );

      expect(result.exitCode).toBe(1);
    },
    30_000,
  );
});

describe("runtime chat --once — --ensure-config", () => {
  it.skipIf(!HAS_API_KEY)(
    "creates runtime.json on the fly when --ensure-config is passed",
    async () => {
      // Use a fresh slug with no pre-existing runtime.json but with an instance in DB
      const freshSlug = `test-ensure-${Date.now()}`;

      // Seed the DB with this fresh slug
      const dbPath = join(tmpHome, ".claw-pilot", "registry.db");
      const db = initDatabase(dbPath);
      const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
      db.prepare(
        `INSERT OR IGNORE INTO instances
         (server_id, slug, port, config_path, state_dir, systemd_unit)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        server.id,
        freshSlug,
        19098,
        "/tmp/config.json",
        "/tmp/state",
        `openclaw-${freshSlug}.service`,
      );
      db.close();

      const result = await runCli(
        ["runtime", "chat", freshSlug, "--agent", "main", "--once", "Say OK", "--ensure-config"],
        cliEnv(),
      );

      // Should succeed — config was created automatically by --ensure-config
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/Agent:/);
    },
    90_000,
  );
});
