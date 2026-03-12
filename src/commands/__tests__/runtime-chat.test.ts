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
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

async function runCli(args: string[], env?: Record<string, string>): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI, ...args], {
      timeout: 60_000,
      env: { ...process.env, ...env },
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
// Temp directory + runtime.json setup
// ---------------------------------------------------------------------------

let tmpDir: string;
const SLUG = "test-integration-once";

/** Minimal runtime.json for the test instance */
function writeRuntimeJson(dir: string) {
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
  writeFileSync(join(dir, "runtime.json"), JSON.stringify(config, null, 2));
}

beforeAll(() => {
  // Create a temp state dir that mimics ~/.openclaw-<slug>/
  tmpDir = mkdtempSync(join(tmpdir(), `claw-pilot-test-${SLUG}-`));
  writeRuntimeJson(tmpDir);
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
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
        [
          "runtime",
          "chat",
          SLUG,
          "--agent",
          "main",
          "--once",
          "Reply with exactly: PONG",
          "--ensure-config",
        ],
        {
          // Override state dir resolution by pointing HOME to tmpDir parent
          // claw-pilot uses getStateDir(slug) = ~/.openclaw-<slug>/
          // We inject CLAW_PILOT_STATE_DIR_OVERRIDE if supported, otherwise
          // we rely on --ensure-config creating a default config
          ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "",
        },
      );

      expect(result.exitCode).toBe(0);
      // stdout should contain the agent response
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
          "--ensure-config",
        ],
        { ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "" },
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
    const result = await runCli(["runtime", "chat", "nonexistent-slug-xyz-abc", "--once", "hello"]);

    expect(result.exitCode).toBe(1);
  });

  it.skipIf(!HAS_API_KEY)(
    "exits 1 when an invalid model is specified",
    async () => {
      const result = await runCli(
        [
          "runtime",
          "chat",
          SLUG,
          "--model",
          "invalid-format",
          "--once",
          "hello",
          "--ensure-config",
        ],
        { ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "" },
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
      // Use a fresh slug with no pre-existing config
      const freshSlug = `test-ensure-config-${Date.now()}`;

      const result = await runCli(
        ["runtime", "chat", freshSlug, "--agent", "main", "--once", "Say OK", "--ensure-config"],
        { ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "" },
      );

      // Should succeed — config was created automatically
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/Agent:/);
    },
    90_000,
  );
});
