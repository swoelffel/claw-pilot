/**
 * runtime/__tests__/channel.test.ts
 *
 * Tests for Phase 3 — Channel system:
 * - Telegram formatter
 * - Pairing codes (SQLite)
 * - Bus events (channel.message.*)
 * - ChannelError
 * - WebChatChannel / TelegramChannel basic lifecycle
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/schema.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

import { markdownToTelegramV2, escapeTelegramV2 } from "../channel/telegram/formatter.js";
import {
  createPairingCode,
  validatePairingCode,
  getPairingCode,
  listPairingCodes,
  deletePairingCode,
} from "../channel/pairing.js";
import { ChannelMessageReceived, ChannelMessageSent } from "../bus/events.js";
import { getBus, disposeBus } from "../bus/index.js";
import { ChannelError } from "../channel/channel.js";
import { WebChatChannel } from "../channel/web-chat.js";
import { TelegramChannel } from "../channel/telegram/channel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-channel-test-"));
  const dbPath = path.join(dir, "test.db");
  return initDatabase(dbPath);
}

function insertTestInstance(db: Database.Database): void {
  db.prepare(`INSERT INTO servers (hostname, openclaw_home) VALUES ('localhost', '/tmp')`).run();
  db.prepare(
    `INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (1, 'test-instance', 18789, '/tmp/cfg', '/tmp/state', 'test.service')`,
  ).run();
}

// ---------------------------------------------------------------------------
// Telegram formatter
// ---------------------------------------------------------------------------

describe("markdownToTelegramV2", () => {
  it("escapes special chars in plain text", () => {
    expect(escapeTelegramV2("Hello. World!")).toBe("Hello\\. World\\!");
    expect(escapeTelegramV2("a+b=c")).toBe("a\\+b\\=c");
  });

  it("converts bold **text**", () => {
    const result = markdownToTelegramV2("Hello **world**!");
    expect(result).toContain("*world*");
  });

  it("converts inline code", () => {
    const result = markdownToTelegramV2("Use `npm install`");
    expect(result).toContain("`npm install`");
  });

  it("converts fenced code block", () => {
    const md = "```ts\nconst x = 1;\n```";
    const result = markdownToTelegramV2(md);
    expect(result).toContain("```ts");
    expect(result).toContain("const x = 1;");
  });

  it("converts headers to bold", () => {
    const result = markdownToTelegramV2("# My Title");
    expect(result).toContain("*My Title*");
  });

  it("converts unordered list items", () => {
    const result = markdownToTelegramV2("- item one\n- item two");
    expect(result).toContain("• item one");
    expect(result).toContain("• item two");
  });

  it("handles empty string", () => {
    expect(markdownToTelegramV2("")).toBe("");
  });

  it("handles plain text without special chars", () => {
    const result = markdownToTelegramV2("Hello world");
    expect(result).toBe("Hello world");
  });
});

// ---------------------------------------------------------------------------
// Pairing codes
// ---------------------------------------------------------------------------

describe("pairing codes", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTempDb();
    insertTestInstance(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates a pairing code", () => {
    const code = createPairingCode(db, "test-instance");
    expect(code.code).toHaveLength(8);
    expect(code.instanceSlug).toBe("test-instance");
    expect(code.used).toBe(false);
    expect(code.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("generates unique codes", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      codes.add(createPairingCode(db, "test-instance").code);
    }
    expect(codes.size).toBe(10);
  });

  it("validates a valid code", () => {
    const created = createPairingCode(db, "test-instance");
    const validated = validatePairingCode(db, created.code);
    expect(validated).toBeDefined();
    expect(validated!.code).toBe(created.code);
    expect(validated!.used).toBe(true);
  });

  it("rejects a used code", () => {
    const created = createPairingCode(db, "test-instance");
    validatePairingCode(db, created.code); // consume it
    const second = validatePairingCode(db, created.code);
    expect(second).toBeUndefined();
  });

  it("rejects an unknown code", () => {
    const result = validatePairingCode(db, "XXXXXXXX");
    expect(result).toBeUndefined();
  });

  it("getPairingCode returns without consuming", () => {
    const created = createPairingCode(db, "test-instance");
    const fetched = getPairingCode(db, created.code);
    expect(fetched).toBeDefined();
    expect(fetched!.used).toBe(false);
    // Still valid after get
    const validated = validatePairingCode(db, created.code);
    expect(validated).toBeDefined();
  });

  it("listPairingCodes returns active codes", () => {
    createPairingCode(db, "test-instance");
    createPairingCode(db, "test-instance");
    const list = listPairingCodes(db, "test-instance");
    expect(list.length).toBe(2);
  });

  it("listPairingCodes excludes used codes", () => {
    const c1 = createPairingCode(db, "test-instance");
    createPairingCode(db, "test-instance");
    validatePairingCode(db, c1.code); // consume c1
    const list = listPairingCodes(db, "test-instance");
    expect(list.length).toBe(1);
  });

  it("deletePairingCode removes the code", () => {
    const created = createPairingCode(db, "test-instance");
    deletePairingCode(db, created.code);
    expect(getPairingCode(db, created.code)).toBeUndefined();
  });

  it("respects custom TTL", () => {
    const code = createPairingCode(db, "test-instance", { ttlMinutes: 60 });
    const diffMs = code.expiresAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(59 * 60 * 1000);
    expect(diffMs).toBeLessThan(61 * 60 * 1000);
  });

  it("stores peerId and meta when provided", () => {
    const code = createPairingCode(db, "test-instance", {
      channel: "telegram",
      ttlMinutes: 60,
      peerId: "telegram:123456",
      meta: { username: "testuser" },
    });
    expect(code.peerId).toBe("telegram:123456");
    expect(code.meta).toEqual({ username: "testuser" });
    expect(code.channel).toBe("telegram");
  });

  it("meta is undefined when not provided", () => {
    const code = createPairingCode(db, "test-instance");
    expect(code.meta).toBeUndefined();
  });

  it("peerId is undefined when not provided", () => {
    const code = createPairingCode(db, "test-instance");
    expect(code.peerId).toBeUndefined();
  });

  it("listPairingCodes returns codes with meta", () => {
    createPairingCode(db, "test-instance", {
      channel: "telegram",
      peerId: "telegram:999",
      meta: { username: "alice" },
    });
    const list = listPairingCodes(db, "test-instance");
    const tgCode = list.find((c) => c.channel === "telegram");
    expect(tgCode).toBeDefined();
    expect(tgCode!.meta).toEqual({ username: "alice" });
    expect(tgCode!.peerId).toBe("telegram:999");
  });
});

// ---------------------------------------------------------------------------
// Bus events — channel.message.*
// ---------------------------------------------------------------------------

describe("channel bus events", () => {
  it("ChannelMessageReceived has correct type", () => {
    expect(ChannelMessageReceived.type).toBe("channel.message.received");
  });

  it("ChannelMessageSent has correct type", () => {
    expect(ChannelMessageSent.type).toBe("channel.message.sent");
  });

  it("can subscribe and receive channel.message.received", () => {
    const bus = getBus("test-slug-ch");
    const received: unknown[] = [];
    bus.subscribe(ChannelMessageReceived, (payload) => {
      received.push(payload);
    });
    bus.publish(ChannelMessageReceived, {
      channelType: "telegram",
      peerId: "telegram:123",
      text: "hello",
    });
    expect(received).toHaveLength(1);
    expect((received[0] as { text: string }).text).toBe("hello");
    disposeBus("test-slug-ch");
  });

  it("can subscribe and receive channel.message.sent", () => {
    const bus = getBus("test-slug-ch2");
    const sent: unknown[] = [];
    bus.subscribe(ChannelMessageSent, (payload) => {
      sent.push(payload);
    });
    bus.publish(ChannelMessageSent, {
      channelType: "web",
      peerId: "web:127.0.0.1:abc",
      text: "response",
      sessionId: "sess-1",
    });
    expect(sent).toHaveLength(1);
    expect((sent[0] as { sessionId: string }).sessionId).toBe("sess-1");
    disposeBus("test-slug-ch2");
  });
});

// ---------------------------------------------------------------------------
// ChannelError
// ---------------------------------------------------------------------------

describe("ChannelError", () => {
  it("includes channelType in message", () => {
    const err = new ChannelError("telegram", "bot token missing");
    expect(err.message).toBe("[telegram] bot token missing");
    expect(err.channelType).toBe("telegram");
    expect(err.name).toBe("ChannelError");
  });

  it("stores cause", () => {
    const cause = new Error("root cause");
    const err = new ChannelError("web", "connection failed", cause);
    expect(err.cause).toBe(cause);
  });

  it("is instanceof Error", () => {
    const err = new ChannelError("web", "test");
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// WebChatChannel — basic lifecycle (no real WS connections)
// ---------------------------------------------------------------------------

describe("WebChatChannel", () => {
  it("has type 'web'", () => {
    const ch = new WebChatChannel({ port: 0, token: "test-token" });
    expect(ch.type).toBe("web");
  });

  it("onMessage registers handler without error", () => {
    const ch = new WebChatChannel({ port: 0, token: "test-token" });
    const handler = vi.fn();
    ch.onMessage(handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TelegramChannel — basic lifecycle
// ---------------------------------------------------------------------------

describe("TelegramChannel", () => {
  it("has type 'telegram'", () => {
    const ch = new TelegramChannel({ botTokenEnvVar: "TELEGRAM_BOT_TOKEN" });
    expect(ch.type).toBe("telegram");
  });

  it("throws ChannelError when token env var not set", async () => {
    const ch = new TelegramChannel({ botTokenEnvVar: "NONEXISTENT_TOKEN_VAR_XYZ" });
    await expect(ch.connect()).rejects.toBeInstanceOf(ChannelError);
  });

  it("disconnect is idempotent when not connected", async () => {
    const ch = new TelegramChannel({ botTokenEnvVar: "TELEGRAM_BOT_TOKEN" });
    await expect(ch.disconnect()).resolves.toBeUndefined();
  });

  it("accepts dmPolicy and groupPolicy options", () => {
    const ch = new TelegramChannel({
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
    });
    expect(ch.type).toBe("telegram");
  });

  it("accepts db and instanceSlug options for pairing", () => {
    const db = makeTempDb();
    insertTestInstance(db);
    const ch = new TelegramChannel({
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      dmPolicy: "pairing",
      db,
      instanceSlug: "test-instance",
    });
    expect(ch.type).toBe("telegram");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// TelegramChannel — pairing code generation (dmPolicy: "pairing")
// ---------------------------------------------------------------------------

describe("TelegramChannel pairing", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTempDb();
    insertTestInstance(db);
  });

  afterEach(() => {
    db.close();
  });

  it("createPairingCode with telegram channel stores peerId", () => {
    const code = createPairingCode(db, "test-instance", {
      channel: "telegram",
      ttlMinutes: 60,
      peerId: "telegram:42",
      meta: { username: "bob" },
    });
    expect(code.channel).toBe("telegram");
    expect(code.peerId).toBe("telegram:42");
    expect(code.meta?.username).toBe("bob");
    expect(code.used).toBe(false);
  });

  it("listPairingCodes filters by channel correctly", () => {
    createPairingCode(db, "test-instance", { channel: "web" });
    createPairingCode(db, "test-instance", {
      channel: "telegram",
      peerId: "telegram:100",
    });
    const all = listPairingCodes(db, "test-instance");
    const tg = all.filter((c) => c.channel === "telegram");
    const web = all.filter((c) => c.channel === "web");
    expect(tg).toHaveLength(1);
    expect(web).toHaveLength(1);
    expect(tg[0]!.peerId).toBe("telegram:100");
  });
});
