// src/commands/__tests__/context-and-commands.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliError, ClawPilotError, InstanceNotFoundError } from "../../lib/errors.js";

// --- Mocks ----------------------------------------------------------------

const closeFn = vi.fn();
const mockDb = { close: closeFn, prepare: vi.fn(), exec: vi.fn() };

vi.mock("../../db/schema.js", () => ({
  initDatabase: vi.fn(() => mockDb),
}));

vi.mock("../../lib/platform.js", () => ({
  getDbPath: vi.fn(() => "/tmp/test-registry.db"),
}));

const mockExec = vi.fn().mockResolvedValue({ stdout: "1000\n", stderr: "" });
vi.mock("../../server/local.js", () => ({
  LocalConnection: vi.fn(function (this: Record<string, unknown>) {
    this.exec = mockExec;
  }),
}));

vi.mock("../../lib/xdg.js", () => ({
  resolveXdgRuntimeDir: vi.fn().mockResolvedValue("/tmp/xdg-runtime"),
}));

vi.mock("../../core/registry.js", () => ({
  Registry: vi.fn(function (this: Record<string, unknown>, db: unknown) {
    this.db = db;
  }),
}));

vi.mock("../../server/registry.js", () => ({
  bootstrapServerRegistry: vi.fn(),
}));

vi.mock("../../core/secrets/bootstrap.js", () => ({
  bootstrapSecretProvider: vi.fn(),
}));

vi.mock("../../core/audit/index.js", () => ({
  bootstrapAuditBus: vi.fn(),
  shutdownAuditBus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../runtime/plugin/verifier.js", () => ({
  NullPluginVerifier: vi.fn(),
  registerPluginVerifier: vi.fn(),
}));

// --- Imports (after mocks) ------------------------------------------------

import { withContext } from "../_context.js";
import type { CommandContext } from "../_context.js";
import { initDatabase } from "../../db/schema.js";
import { getDbPath } from "../../lib/platform.js";
import { LocalConnection } from "../../server/local.js";
import { Registry } from "../../core/registry.js";

// ---------------------------------------------------------------------------
// withContext — contract tests
// ---------------------------------------------------------------------------

describe("withContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls fn with a CommandContext containing db, registry, conn, xdgRuntimeDir", async () => {
    let captured: CommandContext | undefined;
    await withContext(async (ctx) => {
      captured = ctx;
    });

    expect(captured).toBeDefined();
    expect(captured!.db).toBe(mockDb);
    expect(captured!.registry).toBeDefined();
    expect(captured!.conn).toBeDefined();
    expect(captured!.xdgRuntimeDir).toBe("/tmp/xdg-runtime");
  });

  it("returns the value produced by fn", async () => {
    const result = await withContext(async () => 42);
    expect(result).toBe(42);
  });

  it("returns complex values from fn", async () => {
    const obj = { name: "test", items: [1, 2, 3] };
    const result = await withContext(async () => obj);
    expect(result).toEqual(obj);
  });

  it("closes the database after successful execution", async () => {
    await withContext(async () => "ok");
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it("closes the database even when fn throws", async () => {
    await expect(
      withContext(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(closeFn).toHaveBeenCalledOnce();
  });

  it("propagates errors thrown by fn", async () => {
    const err = new Error("propagated");
    await expect(
      withContext(async () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });

  it("calls initDatabase with the result of getDbPath", async () => {
    await withContext(async () => {});
    expect(getDbPath).toHaveBeenCalled();
    expect(initDatabase).toHaveBeenCalledWith("/tmp/test-registry.db");
  });

  it("instantiates LocalConnection", async () => {
    await withContext(async () => {});
    expect(LocalConnection).toHaveBeenCalledOnce();
  });

  it("instantiates Registry with the database", async () => {
    await withContext(async () => {});
    expect(Registry).toHaveBeenCalledWith(mockDb);
  });
});

// ---------------------------------------------------------------------------
// CliError through withContext
// ---------------------------------------------------------------------------

describe("CliError through withContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("CliError thrown inside withContext propagates with exitCode intact", async () => {
    const cliErr = new CliError("missing argument", 2);

    try {
      await withContext(async () => {
        throw cliErr;
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).exitCode).toBe(2);
      expect((e as CliError).message).toBe("missing argument");
    }

    // DB is still closed in finally
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it("CliError with default exitCode preserves exitCode 1", async () => {
    try {
      await withContext(async () => {
        throw new CliError("generic failure");
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CliError).exitCode).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// ClawPilotError hierarchy through withContext
// ---------------------------------------------------------------------------

describe("ClawPilotError hierarchy through withContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("InstanceNotFoundError propagates with code and message", async () => {
    try {
      await withContext(async () => {
        throw new InstanceNotFoundError("my-agent");
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InstanceNotFoundError);
      expect(e).toBeInstanceOf(ClawPilotError);
      expect((e as ClawPilotError).code).toBe("INSTANCE_NOT_FOUND");
      expect((e as ClawPilotError).message).toContain("my-agent");
    }

    expect(closeFn).toHaveBeenCalledOnce();
  });
});
