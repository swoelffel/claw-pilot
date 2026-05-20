// src/e2e/skills.e2e.test.ts
//
// SKILLS-002 — End-to-end coverage for the instance-scoped structured-skills
// REST API. Exercises the routes registered in
// `src/dashboard/routes/instances/skills.ts` against a real Hono HTTP server
// with an in-memory SQLite DB.
//
// Each scenario provisions its own instance + agent so tests stay isolated
// even though they share a single TestContext.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { startTestServer, TEST_TOKEN, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, seedLocalServer, seedInstance } from "./helpers/seed.js";
import type { Json } from "./helpers/types.js";

// Minimal runtime.json content so AgentProvisioner can read it via MockConnection.
const MINIMAL_RUNTIME_JSON = JSON.stringify(
  {
    defaultModel: "anthropic/claude-3-5-haiku-20241022",
    agents: [],
  },
  null,
  2,
);

interface ProvisionedInstance {
  slug: string;
  port: number;
  configPath: string;
}

let nextPort = 18860;

function provisionInstance(ctx: TestContext, serverId: number, slug: string): ProvisionedInstance {
  const port = nextPort++;
  const configPath = `/home/test/.openclaw-${slug}/runtime.json`;
  seedInstance(ctx.registry, serverId, { slug, port, state: "stopped" });
  ctx.conn.files.set(configPath, MINIMAL_RUNTIME_JSON);
  return { slug, port, configPath };
}

async function createAgent(ctx: TestContext, slug: string, agentSlug: string): Promise<void> {
  const res = await ctx.client.withBearer().post(`/api/instances/${slug}/agents`, {
    agentSlug,
    name: `Agent ${agentSlug}`,
    role: "assistant",
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
  });
  if (res.status !== 201) {
    throw new Error(`createAgent failed: ${res.status} ${await res.text()}`);
  }
}

function buildSkillZip(skillMd: string, extraFiles: Record<string, string> = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    "SKILL.md": strToU8(skillMd),
  };
  for (const [path, content] of Object.entries(extraFiles)) {
    entries[path] = strToU8(content);
  }
  return zipSync(entries);
}

async function postZip(
  baseUrl: string,
  slug: string,
  zipBytes: Uint8Array,
  filename = "skill.zip",
): Promise<Response> {
  // Copy into a fresh ArrayBuffer so Blob/File accept it uniformly.
  const buf = new ArrayBuffer(zipBytes.byteLength);
  new Uint8Array(buf).set(zipBytes);
  const fd = new FormData();
  fd.append("file", new File([buf], filename, { type: "application/zip" }));
  return fetch(`${baseUrl}/api/instances/${slug}/skills`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    body: fd,
  });
}

describe("Skills API — E2E", () => {
  let ctx: TestContext;
  let serverId: number;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
    serverId = seedLocalServer(ctx.registry);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ─── 1. Blank skill lifecycle ────────────────────────────────────────────

  it("blank skill lifecycle: create → edit SKILL.md → assign → list", async () => {
    const { slug } = provisionInstance(ctx, serverId, "skills-blank");
    await createAgent(ctx, slug, "pilot");

    // Create blank skill
    const createRes = await ctx.client.withBearer().post(`/api/instances/${slug}/skills`, {
      mode: "blank",
      name: "test",
      description: "d",
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as Json;
    expect(typeof createBody.id).toBe("string");
    const skillId: string = createBody.id;

    // Edit SKILL.md
    const updatedManifest = "---\nname: test\ndescription: updated\n---\nhi";
    const editRes = await ctx.client
      .withBearer()
      .put(`/api/instances/${slug}/skills/${skillId}/files/SKILL.md`, {
        content: updatedManifest,
      });
    expect(editRes.status).toBe(200);
    const editBody = (await editRes.json()) as Json;
    expect(editBody.path).toBe("SKILL.md");
    expect(editBody.content).toBe(updatedManifest);

    // Assign skill to agent
    const assignRes = await ctx.client
      .withBearer()
      .post(`/api/instances/${slug}/skills/${skillId}/agents/pilot`);
    expect(assignRes.status).toBe(204);

    // List shows agentCount: 1
    const listRes = await ctx.client.withBearer().get(`/api/instances/${slug}/skills`);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as Json;
    expect(Array.isArray(listBody.skills)).toBe(true);
    const summary = listBody.skills.find((s: Json) => s.id === skillId);
    expect(summary).toBeDefined();
    expect(summary.agentCount).toBe(1);
  });

  // ─── 2. ZIP import → export → round-trip ─────────────────────────────────

  it("zip import → export → round-trip into a second instance", async () => {
    const { slug: srcSlug } = provisionInstance(ctx, serverId, "skills-zip-src");

    const skillMd = "---\nname: rt\nversion: 1.0.0\n---\nbody";
    const zipBytes = buildSkillZip(skillMd, {
      "tools/x.ts": "export const x = 1;\n",
    });

    // Import zip
    const importRes = await postZip(ctx.baseUrl, srcSlug, zipBytes, "rt.zip");
    expect(importRes.status).toBe(201);
    const importBody = (await importRes.json()) as Json;
    const skillId: string = importBody.id;
    expect(typeof skillId).toBe("string");

    // Export zip
    const exportRes = await ctx.client
      .withBearer()
      .get(`/api/instances/${srcSlug}/skills/${skillId}/export`);
    expect(exportRes.status).toBe(200);
    const contentType = exportRes.headers.get("content-type") ?? "";
    expect(contentType.toLowerCase()).toContain("zip");
    const exportedBytes = new Uint8Array(await exportRes.arrayBuffer());
    expect(exportedBytes.byteLength).toBeGreaterThan(0);

    // Round-trip: re-import into a fresh instance
    const { slug: dstSlug } = provisionInstance(ctx, serverId, "skills-zip-dst");
    const roundTripRes = await postZip(ctx.baseUrl, dstSlug, exportedBytes, "rt-export.zip");
    expect(roundTripRes.status).toBe(201);
    const roundTripBody = (await roundTripRes.json()) as Json;
    expect(typeof roundTripBody.id).toBe("string");

    // Verify round-tripped skill carries the same manifest fields.
    const detailRes = await ctx.client
      .withBearer()
      .get(`/api/instances/${dstSlug}/skills/${roundTripBody.id}`);
    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as Json;
    expect(detailBody.skill.name).toBe("rt");
    expect(detailBody.skill.version).toBe("1.0.0");
    const paths = (detailBody.files as Array<{ path: string }>).map((f) => f.path).sort();
    expect(paths).toEqual(["SKILL.md", "tools/x.ts"]);
  });

  // ─── 3. Delete cascade ───────────────────────────────────────────────────

  it("delete cascade: removing a skill drops its agent_skills bindings", async () => {
    const { slug } = provisionInstance(ctx, serverId, "skills-delete");
    await createAgent(ctx, slug, "pilot");

    const createRes = await ctx.client.withBearer().post(`/api/instances/${slug}/skills`, {
      mode: "blank",
      name: "doomed",
      description: "to be deleted",
    });
    expect(createRes.status).toBe(201);
    const { id: skillId } = (await createRes.json()) as { id: string };

    const assignRes = await ctx.client
      .withBearer()
      .post(`/api/instances/${slug}/skills/${skillId}/agents/pilot`);
    expect(assignRes.status).toBe(204);

    // Pre-check: binding row exists
    const preRows = ctx.db
      .prepare("SELECT skill_id, agent_id FROM agent_skills WHERE skill_id = ?")
      .all(skillId) as Array<{ skill_id: string; agent_id: string }>;
    expect(preRows.length).toBe(1);

    // Delete the skill
    const deleteRes = await ctx.client
      .withBearer()
      .delete(`/api/instances/${slug}/skills/${skillId}`);
    expect(deleteRes.status).toBe(204);

    // List returns empty
    const listRes = await ctx.client.withBearer().get(`/api/instances/${slug}/skills`);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as Json;
    expect(listBody.skills).toEqual([]);

    // agent_skills row is gone
    const postRows = ctx.db
      .prepare("SELECT skill_id, agent_id FROM agent_skills WHERE skill_id = ?")
      .all(skillId) as Array<{ skill_id: string; agent_id: string }>;
    expect(postRows.length).toBe(0);
  });

  // ─── 4. Cross-instance isolation ─────────────────────────────────────────

  it("cross-instance isolation: a skill from instance A is not visible from instance B", async () => {
    const { slug: slugA } = provisionInstance(ctx, serverId, "skills-iso-a");
    const { slug: slugB } = provisionInstance(ctx, serverId, "skills-iso-b");

    const createRes = await ctx.client.withBearer().post(`/api/instances/${slugA}/skills`, {
      mode: "blank",
      name: "private",
      description: "owned by A",
    });
    expect(createRes.status).toBe(201);
    const { id: skillId } = (await createRes.json()) as { id: string };

    // Visible from owner instance
    const ownerRes = await ctx.client.withBearer().get(`/api/instances/${slugA}/skills/${skillId}`);
    expect(ownerRes.status).toBe(200);

    // Invisible (404) from a different instance
    const foreignRes = await ctx.client
      .withBearer()
      .get(`/api/instances/${slugB}/skills/${skillId}`);
    expect(foreignRes.status).toBe(404);
    const foreignBody = (await foreignRes.json()) as Json;
    expect(foreignBody.code).toBe("NOT_FOUND");

    // The other instance's list does not contain it either.
    const listRes = await ctx.client.withBearer().get(`/api/instances/${slugB}/skills`);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as Json;
    const leaked = (listBody.skills as Array<{ id: string }>).find((s) => s.id === skillId);
    expect(leaked).toBeUndefined();

    // And cross-instance file ops are also rejected with 404.
    const fileRes = await ctx.client
      .withBearer()
      .get(`/api/instances/${slugB}/skills/${skillId}/files/SKILL.md`);
    expect(fileRes.status).toBe(404);
  });
});
