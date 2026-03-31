// src/core/__tests__/agent-provisioner.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { AgentProvisioner } from "../agent-provisioner.js";
import { MockConnection } from "./mock-connection.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;
let conn: MockConnection;

const STATE_DIR = "/opt/test-state";
const CONFIG_PATH = `${STATE_DIR}/runtime.json`;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-provisioner-test-"));
  db = initDatabase(path.join(tmpDir, "registry.db"));
  registry = new Registry(db);
  conn = new MockConnection();
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedInstance(slug = "test-inst"): void {
  const server = registry.upsertLocalServer("testhost", "/opt/test");
  registry.createInstance({
    serverId: server.id,
    slug,
    port: 18789,
    configPath: CONFIG_PATH,
    stateDir: STATE_DIR,
    systemdUnit: `claw-runtime-${slug}`,
  });
}

function seedAgent(slug: string, agentId: string, isDefault = false): void {
  const inst = registry.getInstance(slug)!;
  registry.upsertAgent(inst.id, {
    agentId,
    name: agentId,
    model: "anthropic/claude-sonnet-4-5",
    workspacePath: path.join(STATE_DIR, "workspaces", agentId),
    isDefault,
    configJson: JSON.stringify({
      id: agentId,
      name: agentId,
      model: "anthropic/claude-sonnet-4-5",
    }),
  });
}

let sessionSeq = 0;
function insertSession(instanceSlug: string, agentId: string, persistent: number): string {
  const id = `${instanceSlug}:${agentId}:${++sessionSeq}`;
  db.prepare(
    `INSERT INTO rt_sessions (id, instance_slug, agent_id, channel, state, persistent)
     VALUES (?, ?, ?, 'web', 'active', ?)`,
  ).run(id, instanceSlug, agentId, persistent);
  return id;
}

let msgSeq = 0;
function insertMessage(sessionId: string): string {
  const id = `msg-${sessionId}-${++msgSeq}`;
  db.prepare(
    `INSERT INTO rt_messages (id, session_id, role)
     VALUES (?, ?, 'user')`,
  ).run(id, sessionId);
  return id;
}

let partSeq = 0;
function insertPart(messageId: string): void {
  const id = `part-${messageId}-${++partSeq}`;
  db.prepare(
    `INSERT INTO rt_parts (id, message_id, type, content)
     VALUES (?, ?, 'text', '{"text":"hello"}')`,
  ).run(id, messageId);
}

function countSessions(instanceSlug: string, agentId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM rt_sessions WHERE instance_slug = ? AND agent_id = ?")
    .get(instanceSlug, agentId) as { cnt: number };
  return row.cnt;
}

function countMessages(sessionId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM rt_messages WHERE session_id = ?")
    .get(sessionId) as { cnt: number };
  return row.cnt;
}

describe("AgentProvisioner.deleteAgent", () => {
  const slug = "test-inst";

  it("deletes permanent sessions when agent is removed", async () => {
    seedInstance(slug);
    seedAgent(slug, "default-agent", true);
    seedAgent(slug, "doomed-agent");

    // Create permanent + ephemeral sessions for the agent
    const permSessionId = insertSession(slug, "doomed-agent", 1);
    const ephSessionId = insertSession(slug, "doomed-agent", 0);

    // Add messages to verify cascade
    const msgId = insertMessage(permSessionId);
    insertPart(msgId);

    expect(countSessions(slug, "doomed-agent")).toBe(2);

    const instance = registry.getInstance(slug)!;
    const provisioner = new AgentProvisioner(conn, registry);
    await provisioner.deleteAgent(instance, "doomed-agent");

    // All sessions for the deleted agent must be gone
    expect(countSessions(slug, "doomed-agent")).toBe(0);

    // Messages and parts must have cascaded
    expect(countMessages(permSessionId)).toBe(0);
    expect(countMessages(ephSessionId)).toBe(0);
  });

  it("does not affect sessions of other agents", async () => {
    seedInstance(slug);
    seedAgent(slug, "default-agent", true);
    seedAgent(slug, "keep-agent");
    seedAgent(slug, "doomed-agent");

    insertSession(slug, "keep-agent", 1);
    insertSession(slug, "doomed-agent", 1);

    expect(countSessions(slug, "keep-agent")).toBe(1);
    expect(countSessions(slug, "doomed-agent")).toBe(1);

    const instance = registry.getInstance(slug)!;
    const provisioner = new AgentProvisioner(conn, registry);
    await provisioner.deleteAgent(instance, "doomed-agent");

    // Other agent's sessions untouched
    expect(countSessions(slug, "keep-agent")).toBe(1);
    expect(countSessions(slug, "doomed-agent")).toBe(0);
  });
});
