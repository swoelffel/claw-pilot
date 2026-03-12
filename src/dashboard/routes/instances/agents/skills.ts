// src/dashboard/routes/instances/agents/skills.ts
// GET /api/instances/:slug/skills — liste les skills disponibles via le gateway OpenClaw
import { randomUUID } from "node:crypto";
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

type GwFrame =
  | { type: "res"; id: string; ok: boolean; payload?: unknown; error?: unknown }
  | { type: "event"; event: string; payload?: unknown }
  | { type: string; [k: string]: unknown };

/**
 * Appel JSON-RPC skills.status via WebSocket avec handshake complet du protocole OpenClaw.
 *
 * Protocole :
 *   1. Gateway envoie connect.challenge (event ignoré)
 *   2. Client envoie connect (auth token, role operator)
 *   3. Gateway répond hello-ok
 *   4. Client envoie skills.status
 *   5. Gateway répond avec la liste des skills
 */
function querySkillsViaWs(
  port: number,
  token: string,
  timeoutMs: number,
): Promise<SkillStatusResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

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

    // IDs des deux requêtes séquentielles
    const connectId = randomUUID();
    const skillsId = randomUUID();

    ws.once("open", () => {
      // Étape 1 : envoyer connect après l'ouverture (le challenge arrive en event)
      ws.send(
        JSON.stringify({
          type: "req",
          id: connectId,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "gateway-client", version: "1.0.0", platform: "linux", mode: "ui" },
            role: "operator",
            scopes: ["operator.read"],
            caps: [],
            auth: { token },
            locale: "en-US",
            userAgent: "claw-pilot",
          },
        }),
      );
    });

    ws.on("message", (raw) => {
      let frame: GwFrame;
      try {
        frame = JSON.parse(String(raw)) as GwFrame;
      } catch {
        return;
      }

      // Ignorer les events (connect.challenge, etc.)
      if (frame.type === "event") return;

      if (frame.type === "res") {
        const res = frame as { type: "res"; id: string; ok: boolean; payload?: unknown };

        if (res.id === connectId) {
          if (!res.ok) {
            settle(() => reject(new Error("connect rejected by gateway")));
            return;
          }
          // Étape 2 : handshake OK → envoyer skills.status
          ws.send(
            JSON.stringify({
              type: "req",
              id: skillsId,
              method: "skills.status",
              params: {},
            }),
          );
          return;
        }

        if (res.id === skillsId) {
          if (!res.ok) {
            settle(() => reject(new Error("skills.status rejected by gateway")));
            return;
          }
          // Le payload est { workspaceDir, managedSkillsDir, skills: [...] }
          const payload = res.payload as { skills?: SkillStatusResult } | SkillStatusResult | null;
          const skills = Array.isArray(payload)
            ? payload
            : (payload as { skills?: SkillStatusResult } | null)?.skills;
          if (Array.isArray(skills)) {
            settle(() => resolve(skills));
          } else {
            settle(() => reject(new Error("unexpected skills.status response shape")));
          }
          return;
        }
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
