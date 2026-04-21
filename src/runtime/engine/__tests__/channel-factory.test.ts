/**
 * runtime/engine/__tests__/channel-factory.test.ts
 *
 * Unit tests for the channel factory.
 * Mocks channel constructors and platform helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createChannels } from "../channel-factory.js";
import { registerSecretProvider, resetSecretProvider } from "../../../core/secrets/index.js";
import { EnvSecretProvider } from "../../../core/secrets/providers/env.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// Mock channel constructors — must use class syntax for `new` to work
vi.mock("../../channel/web-chat.js", () => {
  const WebChatChannel = vi.fn(function (this: any, opts: any) {
    Object.assign(this, { type: "web-chat", ...opts });
  });
  return { WebChatChannel };
});

vi.mock("../../channel/telegram/channel.js", () => {
  const TelegramChannel = vi.fn(function (this: any, opts: any) {
    Object.assign(this, { type: "telegram", ...opts });
  });
  return { TelegramChannel };
});

vi.mock("../../../lib/platform.js", () => ({
  deriveWebChatPort: vi.fn().mockReturnValue(19142),
}));

import { WebChatChannel } from "../../channel/web-chat.js";
import { TelegramChannel } from "../../channel/telegram/channel.js";

const MockWebChatChannel = vi.mocked(WebChatChannel);
const MockTelegramChannel = vi.mocked(TelegramChannel);

const fakeDb = {} as any;

function makeConfig(
  overrides: Partial<{
    webChat: { enabled: boolean; maxSessions: number };
    telegram: {
      enabled: boolean;
      botTokenEnvVar: string;
      pollingIntervalMs: number;
      allowedUserIds: number[];
      dmPolicy: string;
      groupPolicy: string;
    };
  }> = {},
): any {
  return {
    webChat: { enabled: false, maxSessions: 5 },
    telegram: {
      enabled: false,
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      pollingIntervalMs: 1000,
      allowedUserIds: [],
      dmPolicy: "allow",
      groupPolicy: "deny",
    },
    ...overrides,
  };
}

let tmpStateDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  // Clean env vars
  delete process.env["CLAW_RUNTIME_WEB_TOKEN_TEST_INST"];
  delete process.env["CLAW_RUNTIME_WEB_TOKEN"];
  // Register an isolated EnvSecretProvider for each test
  resetSecretProvider();
  tmpStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-secrets-test-"));
  registerSecretProvider(new EnvSecretProvider(tmpStateDir));
});

afterEach(() => {
  delete process.env["CLAW_RUNTIME_WEB_TOKEN_TEST_INST"];
  delete process.env["CLAW_RUNTIME_WEB_TOKEN"];
  resetSecretProvider();
  try {
    fs.rmSync(tmpStateDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("createChannels", () => {
  it("returns empty array when no channels are enabled", async () => {
    const channels = await createChannels(makeConfig(), "test-inst" as any, fakeDb);
    expect(channels).toEqual([]);
  });

  it("creates WebChatChannel when webChat is enabled", async () => {
    const config = makeConfig({ webChat: { enabled: true, maxSessions: 10 } });
    const channels = await createChannels(config, "test-inst" as any, fakeDb);
    expect(channels).toHaveLength(1);
    expect(MockWebChatChannel).toHaveBeenCalledWith({
      port: 19142,
      token: expect.any(String),
      maxConnections: 10,
    });
  });

  it("creates TelegramChannel when telegram is enabled", async () => {
    const config = makeConfig({
      telegram: {
        enabled: true,
        botTokenEnvVar: "MY_BOT_TOKEN",
        pollingIntervalMs: 2000,
        allowedUserIds: [123],
        dmPolicy: "allow",
        groupPolicy: "deny",
      },
    });
    const channels = await createChannels(config, "test-inst" as any, fakeDb);
    expect(channels).toHaveLength(1);
    expect(MockTelegramChannel).toHaveBeenCalledWith({
      botTokenEnvVar: "MY_BOT_TOKEN",
      pollingIntervalMs: 2000,
      allowedUserIds: [123],
      dmPolicy: "allow",
      groupPolicy: "deny",
      db: fakeDb,
      instanceSlug: "test-inst",
    });
  });

  it("creates both channels when both are enabled", async () => {
    const config = makeConfig({
      webChat: { enabled: true, maxSessions: 5 },
      telegram: {
        enabled: true,
        botTokenEnvVar: "BOT",
        pollingIntervalMs: 1000,
        allowedUserIds: [],
        dmPolicy: "allow",
        groupPolicy: "deny",
      },
    });
    const channels = await createChannels(config, "test-inst" as any, fakeDb);
    expect(channels).toHaveLength(2);
  });

  it("uses slug-specific env var for web-chat token", async () => {
    process.env["CLAW_RUNTIME_WEB_TOKEN_TEST_INST"] = "my-secret-token";
    const config = makeConfig({ webChat: { enabled: true, maxSessions: 5 } });
    await createChannels(config, "test-inst" as any, fakeDb);
    expect(MockWebChatChannel).toHaveBeenCalledWith(
      expect.objectContaining({ token: "my-secret-token" }),
    );
  });

  it("falls back to generic CLAW_RUNTIME_WEB_TOKEN env var", async () => {
    process.env["CLAW_RUNTIME_WEB_TOKEN"] = "generic-token";
    const config = makeConfig({ webChat: { enabled: true, maxSessions: 5 } });
    await createChannels(config, "test-inst" as any, fakeDb);
    expect(MockWebChatChannel).toHaveBeenCalledWith(
      expect.objectContaining({ token: "generic-token" }),
    );
  });

  it("falls back to dev token when no env var is set", async () => {
    const config = makeConfig({ webChat: { enabled: true, maxSessions: 5 } });
    await createChannels(config, "test-inst" as any, fakeDb);
    expect(MockWebChatChannel).toHaveBeenCalledWith(
      expect.objectContaining({ token: "dev-token-test-inst" }),
    );
  });

  it("slug-specific env var takes priority over generic", async () => {
    process.env["CLAW_RUNTIME_WEB_TOKEN_TEST_INST"] = "specific";
    process.env["CLAW_RUNTIME_WEB_TOKEN"] = "generic";
    const config = makeConfig({ webChat: { enabled: true, maxSessions: 5 } });
    await createChannels(config, "test-inst" as any, fakeDb);
    expect(MockWebChatChannel).toHaveBeenCalledWith(expect.objectContaining({ token: "specific" }));
  });
});
