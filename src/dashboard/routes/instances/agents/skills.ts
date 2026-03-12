// src/dashboard/routes/instances/agents/skills.ts
// GET /api/instances/:slug/skills — liste les skills disponibles via le gateway OpenClaw
import type { Hono } from "hono";
import type { RouteDeps } from "../../../route-deps.js";
import { instanceGuard } from "../../../../lib/guards.js";
import { readGatewayToken } from "../../../../lib/env-reader.js";

export interface SkillInfo {
  name: string;
  description: string;
  emoji?: string;
  source: string;
  eligible: boolean;
  disabled: boolean;
}

export interface SkillsListResponse {
  available: boolean;
  skills: SkillInfo[];
}

export function registerAgentSkillsRoutes(app: Hono, deps: RouteDeps): void {
  const { registry, conn } = deps;

  app.get("/api/instances/:slug/skills", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    const guard = instanceGuard(c, instance);
    if (guard) return guard;
    const inst = instance!;

    // Fallback response si le gateway n'est pas joignable
    const fallback: SkillsListResponse = { available: false, skills: [] };

    // Lire le token gateway depuis <stateDir>/.env
    let gatewayToken: string | null = null;
    try {
      gatewayToken = await readGatewayToken(conn, inst.state_dir);
    } catch {
      return c.json(fallback);
    }

    if (!gatewayToken) {
      return c.json(fallback);
    }

    // Appel JSON-RPC skills.status vers le gateway OpenClaw
    try {
      const res = await fetch(`http://127.0.0.1:${inst.port}/api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "skills.status",
          id: 1,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return c.json(fallback);
      }

      const data = (await res.json()) as {
        result?: Array<{
          name: string;
          description: string;
          emoji?: string;
          source: string;
          eligible: boolean;
          disabled: boolean;
        }>;
        error?: unknown;
      };

      if (!data.result || !Array.isArray(data.result)) {
        return c.json(fallback);
      }

      const skills: SkillInfo[] = data.result.map((s) => ({
        name: s.name,
        description: s.description ?? "",
        ...(s.emoji !== undefined && { emoji: s.emoji }),
        source: s.source ?? "unknown",
        eligible: s.eligible ?? true,
        disabled: s.disabled ?? false,
      }));

      return c.json({ available: true, skills } satisfies SkillsListResponse);
    } catch {
      // Gateway non joignable (instance stopped, timeout, etc.)
      return c.json(fallback);
    }
  });
}
