// src/dashboard/routes/instances/agents/files.ts
// GET /api/instances/:slug/agents/:agentId/files/:filename
// PUT /api/instances/:slug/agents/:agentId/files/:filename
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { apiError } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { AgentProvisioner } from "../../../../core/agent-provisioner.js";
import { EDITABLE_FILES } from "../../../../core/agent-sync.js";
import { ClawPilotError, InstanceNotFoundError } from "../../../../lib/errors.js";

export function registerAgentFileRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn, lifecycle } = deps;

  // GET /api/instances/:slug/agents/:agentId/files/:filename — fetch a single workspace file
  app.get("/api/instances/:slug/agents/:agentId/files/:filename", (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const filename = c.req.param("filename");

    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const agent = registry.getAgentByAgentId(instance!.id, agentId);
    if (!agent) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    const file = registry.getAgentFileContent(agent.id, filename);
    if (!file) return apiError(c, 404, "FILE_NOT_FOUND", "File not found");

    return c.json({
      filename: file.filename,
      content: file.content ?? "",
      content_hash: file.content_hash ?? "",
      updated_at: file.updated_at ?? "",
      editable: EDITABLE_FILES.has(filename),
    });
  });

  // PUT /api/instances/:slug/agents/:agentId/files/:filename — update a workspace file
  app.put("/api/instances/:slug/agents/:agentId/files/:filename", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const filename = c.req.param("filename");

    if (!EDITABLE_FILES.has(filename)) {
      return apiError(c, 403, "FILE_NOT_EDITABLE", "File is not editable");
    }

    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;

    const agentRecord = registry.getAgentByAgentId(instance!.id, agentId);
    if (!agentRecord) return apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");

    let body: { content?: string };
    try {
      body = await c.req.json<{ content?: string }>();
    } catch {
      return apiError(c, 400, "INVALID_JSON", "Invalid JSON body");
    }
    if (typeof body.content !== "string") {
      return apiError(c, 400, "FIELD_REQUIRED", "content is required");
    }
    if (body.content.length > 1_048_576) {
      return apiError(c, 413, "CONTENT_TOO_LARGE", "File content exceeds 1MB limit");
    }

    try {
      const provisioner = new AgentProvisioner(conn, registry);
      await provisioner.updateAgentFile(instance!, agentId, filename, body.content);
    } catch (err: unknown) {
      if (err instanceof InstanceNotFoundError) {
        return apiError(c, 404, "FILE_NOT_FOUND", err.message);
      }
      if (err instanceof ClawPilotError && err.message.includes("not editable")) {
        return apiError(c, 403, "FILE_NOT_EDITABLE", err.message);
      }
      return apiError(
        c,
        500,
        "FILE_SAVE_FAILED",
        err instanceof Error ? err.message : "File save failed",
      );
    }

    // Restart daemon fire-and-forget
    lifecycle.restart(slug).catch(() => {
      /* best-effort restart */
    });

    const updatedFile = registry.getAgentFileContent(agentRecord.id, filename);
    return c.json(
      {
        filename,
        content: updatedFile?.content ?? body.content,
        content_hash: updatedFile?.content_hash ?? "",
        updated_at: updatedFile?.updated_at ?? new Date().toISOString(),
        editable: true,
      },
      200,
    );
  });
}
