// src/dashboard/routes/instances/agents/skills.ts
// GET /api/instances/:slug/skills — liste les skills disponibles via le gateway OpenClaw
import type { Hono } from "hono";
import WebSocket from "ws";
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

type SkillStatusResult = Array<{
  name: string;
  description: string;
  emoji?: string;
  source: string;
  eligible: boolean;
  disabled: boolean;
}>;

/** Appel JSON-RPC skills.status via WebSocket (le gateway n'expose pas de HTTP JSON-RPC). */
function querySkillsViaWs(
  port: number,
  token: string,
  timeoutMs: number,
): Promise<SkillStatusResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.terminate();
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new Error("timeout")));
    }, timeoutMs);

    ws.once("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "skills.status", params: {}, id: 1 }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          id?: number;
          result?: SkillStatusResult;
          error?: unknown;
        };
        // Ignorer les push notifications (pas d'id ou id != 1)
        if (msg.id !== 1) return;
        if (Array.isArray(msg.result)) {
          settle(() => resolve(msg.result as SkillStatusResult));
        } else {
          settle(() => reject(new Error("unexpected response")));
        }
      } catch {
        settle(() => reject(new Error("parse error")));
      }
    });

    ws.once("error", (err) => {
      settle(() => reject(err));
    });

    ws.once("close", (code) => {
      settle(() => reject(new Error(`ws closed with code ${code}`)));
    });
  });
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

    // Appel JSON-RPC skills.status via WebSocket (le gateway n'expose pas de HTTP JSON-RPC)
    try {
      const result = await querySkillsViaWs(inst.port, gatewayToken, 5000);

      const skills: SkillInfo[] = result.map((s) => ({
        name: s.name,
        description: s.description ?? "",
        ...(s.emoji !== undefined && { emoji: s.emoji }),
        source: s.source ?? "unknown",
        eligible: s.eligible ?? true,
        disabled: s.disabled ?? false,
      }));

      return c.json({ available: true, skills } satisfies SkillsListResponse);
    } catch {
      // Gateway non joignable (instance stopped, timeout, auth refusée, etc.)
      return c.json(fallback);
    }
  });
}
