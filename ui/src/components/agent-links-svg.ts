// ui/src/components/agent-links-svg.ts
import { LitElement, html, css, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { type AgentLink, isArchetypeLink, getArchetypeFromLink } from "../types.js";
import { tokenStyles } from "../styles/tokens.js";

// Archetype color mapping (must match tokens.ts)
const ARCHETYPE_COLORS: Record<string, string> = {
  planner: "#8b5cf6",
  generator: "#10b981",
  evaluator: "#f59e0b",
  orchestrator: "#4f6ef7",
  analyst: "#0ea5e9",
  communicator: "#ec4899",
};

@customElement("cp-agent-links-svg")
export class AgentLinksSvg extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }

      svg {
        width: 100%;
        height: 100%;
        overflow: visible;
      }
    `,
  ];

  @property({ type: Array }) links: AgentLink[] = [];
  @property({ type: Object }) positions: Map<string, { x: number; y: number }> = new Map();
  @property({ type: Object }) pendingRemovals: Set<string> = new Set();
  @property({ type: Object }) pendingAdditions: Map<string, Set<string>> = new Map();

  override render() {
    // Pre-compute bidirectional A2A pairs
    const a2aLinks = this.links.filter((l) => l.link_type === "a2a" && !isArchetypeLink(l));
    const pairKeys = new Set<string>();
    const biPairs = new Set<string>();
    for (const l of a2aLinks) {
      const key = [l.source_agent_id, l.target_agent_id].sort().join("\u2194");
      if (pairKeys.has(key)) biPairs.add(key);
      pairKeys.add(key);
    }
    // Track rendered bi-pairs to avoid duplicates
    const renderedBi = new Set<string>();

    // Collect @archetype links for floating badges
    const archetypeLinks = this.links.filter((l) => l.link_type === "spawn" && isArchetypeLink(l));

    return html`
      <svg>
        <defs>
          <!-- Spawn arrow (filled triangle, gray) -->
          <marker
            id="arrow-delegate"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L8,3 z" fill="#666" />
          </marker>
          <marker
            id="arrow-delegate-pending-remove"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
          </marker>
          <marker
            id="arrow-delegate-pending-add"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L8,3 z" fill="#10b981" />
          </marker>
          <!-- A2A arrow (open chevron, muted) -->
          <marker id="arrow-a2a" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M1,0 L7,3 L1,6" fill="none" stroke="#64748b" stroke-width="1.2" />
          </marker>
          <!-- A2A bidirectional (chevrons at both ends) -->
          <marker
            id="arrow-a2a-start"
            markerWidth="8"
            markerHeight="8"
            refX="1"
            refY="3"
            orient="auto-start-reverse"
          >
            <path d="M7,0 L1,3 L7,6" fill="none" stroke="#64748b" stroke-width="1.2" />
          </marker>
        </defs>

        <!-- Spawn links (dashed, gray) -->
        ${this.links
          .filter((link) => link.link_type === "spawn" && !isArchetypeLink(link))
          .map((link) => {
            const src = this.positions.get(link.source_agent_id);
            const tgt = this.positions.get(link.target_agent_id);
            if (!src || !tgt) return "";

            const isPendingRemove = this.pendingRemovals.has(link.target_agent_id);
            const color = isPendingRemove ? "#ef4444" : "#666";
            const marker = isPendingRemove
              ? "url(#arrow-delegate-pending-remove)"
              : "url(#arrow-delegate)";

            return svg`
              <line
                x1=${src.x} y1=${src.y}
                x2=${tgt.x} y2=${tgt.y}
                stroke=${color}
                stroke-width="1.5"
                stroke-dasharray="6 4"
                stroke-opacity=${isPendingRemove ? "0.8" : "1"}
                marker-end=${marker}
                aria-label="delegates to ${link.target_agent_id}"
              />
            `;
          })}

        <!-- A2A links (dotted, muted — bidirectional merged) -->
        ${a2aLinks.map((link) => {
          const biKey = [link.source_agent_id, link.target_agent_id].sort().join("\u2194");
          const isBi = biPairs.has(biKey);

          // Skip the second direction of a bidirectional pair
          if (isBi && renderedBi.has(biKey)) return "";
          if (isBi) renderedBi.add(biKey);

          const src = this.positions.get(link.source_agent_id);
          const tgt = this.positions.get(link.target_agent_id);
          if (!src || !tgt) return "";

          return svg`
            <line
              x1=${src.x} y1=${src.y}
              x2=${tgt.x} y2=${tgt.y}
              stroke="#64748b"
              stroke-width="1"
              stroke-dasharray="2 3"
              stroke-opacity="0.6"
              marker-end="url(#arrow-a2a)"
              ${isBi ? svg`marker-start="url(#arrow-a2a-start)"` : ""}
              aria-label="${isBi ? "a2a bidirectional" : "a2a"} ${link.source_agent_id} ↔ ${link.target_agent_id}"
            />
          `;
        })}

        <!-- @archetype floating badges -->
        ${archetypeLinks.map((link) => {
          const src = this.positions.get(link.source_agent_id);
          if (!src) return "";
          const archetype = getArchetypeFromLink(link);
          const color = ARCHETYPE_COLORS[archetype] ?? "#64748b";
          const badgeX = src.x + 70;
          const badgeY = src.y + 45;
          const label = `@${archetype}`;
          const textWidth = label.length * 6.5 + 12;

          return svg`
            <line
              x1=${src.x} y1=${src.y}
              x2=${badgeX} y2=${badgeY}
              stroke=${color}
              stroke-width="1.5"
              stroke-dasharray="6 4"
              stroke-opacity="0.7"
            />
            <g transform="translate(${badgeX - textWidth / 2}, ${badgeY - 10})">
              <rect
                rx="4" ry="4"
                width=${textWidth} height="20"
                fill="#1a1d27"
                stroke=${color}
                stroke-width="1"
                stroke-opacity="0.8"
              />
              <text
                x=${textWidth / 2} y="14"
                text-anchor="middle"
                fill=${color}
                font-size="10"
                font-family="var(--font-mono, monospace)"
              >${label}</text>
            </g>
          `;
        })}

        <!-- Pending additions (green dashed) -->
        ${Array.from(this.pendingAdditions.entries()).flatMap(([sourceId, targets]) => {
          const src = this.positions.get(sourceId);
          if (!src) return [];
          return Array.from(targets).map((targetId) => {
            const tgt = this.positions.get(targetId);
            if (!tgt) return "";
            return svg`
              <line
                x1=${src.x} y1=${src.y}
                x2=${tgt.x} y2=${tgt.y}
                stroke="#10b981"
                stroke-width="1.5"
                stroke-dasharray="6 4"
                stroke-opacity="0.8"
                marker-end="url(#arrow-delegate-pending-add)"
                aria-label="will delegate to ${targetId}"
              />
            `;
          });
        })}
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-links-svg": AgentLinksSvg;
  }
}
