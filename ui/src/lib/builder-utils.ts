// ui/src/lib/builder-utils.ts
import type { AgentBuilderInfo } from "../types.js";

/**
 * Compute canvas positions for agents.
 * Priority: 1. in-memory (drag), 2. DB-persisted, 3. concentric fallback
 */
export function computePositions(
  agents: AgentBuilderInfo[],
  canvasWidth: number,
  canvasHeight: number,
  current: Map<string, { x: number; y: number }> = new Map(),
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Priority order:
  //   1. current in-memory position (set by drag or previous recompute)
  //   2. DB-persisted position (agent.position_x/y)
  //   3. concentric fallback (for agents with no position at all)
  const needsLayout: AgentBuilderInfo[] = [];
  for (const agent of agents) {
    const mem = current.get(agent.agent_id);
    if (mem) {
      // Already positioned in this session — keep it
      positions.set(agent.agent_id, mem);
    } else if (agent.position_x != null && agent.position_y != null) {
      // Restore from DB on first load
      positions.set(agent.agent_id, { x: agent.position_x, y: agent.position_y });
    } else {
      // Brand-new agent with no position anywhere — needs layout
      needsLayout.push(agent);
    }
  }

  // Concentric fallback only for agents with no position at all
  if (needsLayout.length > 0) {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const mainAgent = needsLayout.find(a => a.is_default);
    if (mainAgent) {
      positions.set(mainAgent.agent_id, { x: centerX, y: centerY });
    }
    const others = needsLayout.filter(a => !a.is_default);
    if (others.length > 0) {
      const radius = Math.min(canvasWidth, canvasHeight) * 0.35;
      const angleStep = (2 * Math.PI) / others.length;
      const startAngle = -Math.PI / 2;
      others.forEach((agent, i) => {
        const angle = startAngle + i * angleStep;
        positions.set(agent.agent_id, {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      });
    }
  }

  return positions;
}

/** Compute position for a newly created agent (top-left corner). */
export function newAgentPosition(): { x: number; y: number } {
  const CARD_W = 160;
  const CARD_H = 80;
  const MARGIN = 24;
  return { x: CARD_W / 2 + MARGIN, y: CARD_H / 2 + MARGIN };
}
