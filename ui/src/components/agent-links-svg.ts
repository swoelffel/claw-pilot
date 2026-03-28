// ui/src/components/agent-links-svg.ts
import { LitElement, html, css, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { type AgentLink, isArchetypeLink } from "../types.js";
import { tokenStyles } from "../styles/tokens.js";

/** Shorten a line by `margin` px from each endpoint so it clears the cards. */
function clipLine(
  src: { x: number; y: number },
  tgt: { x: number; y: number },
  margin: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < margin * 2) return { x1: src.x, y1: src.y, x2: tgt.x, y2: tgt.y };
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: src.x + ux * margin,
    y1: src.y + uy * margin,
    x2: tgt.x - ux * margin,
    y2: tgt.y - uy * margin,
  };
}

const CARD_MARGIN = 75;

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

        <!-- Spawn links (dotted, gray) -->
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
            const cl = clipLine(src, tgt, CARD_MARGIN);

            return svg`
              <line
                x1=${cl.x1} y1=${cl.y1}
                x2=${cl.x2} y2=${cl.y2}
                stroke=${color}
                stroke-width="1"
                stroke-dasharray="2 3"
                stroke-opacity=${isPendingRemove ? "0.8" : "0.7"}
                marker-end=${marker}
                aria-label="delegates to ${link.target_agent_id}"
              />
            `;
          })}

        <!-- A2A links (dashed, muted — bidirectional merged) -->
        ${a2aLinks.map((link) => {
          const biKey = [link.source_agent_id, link.target_agent_id].sort().join("\u2194");
          const isBi = biPairs.has(biKey);

          // Skip the second direction of a bidirectional pair
          if (isBi && renderedBi.has(biKey)) return "";
          if (isBi) renderedBi.add(biKey);

          const src = this.positions.get(link.source_agent_id);
          const tgt = this.positions.get(link.target_agent_id);
          if (!src || !tgt) return "";
          const cl = clipLine(src, tgt, CARD_MARGIN);

          return svg`
            <line
              x1=${cl.x1} y1=${cl.y1}
              x2=${cl.x2} y2=${cl.y2}
              stroke="#64748b"
              stroke-width="1.5"
              stroke-dasharray="6 4"
              stroke-opacity="0.6"
              marker-end="url(#arrow-a2a)"
              ${isBi ? svg`marker-start="url(#arrow-a2a-start)"` : ""}
              aria-label="${isBi ? "a2a bidirectional" : "a2a"} ${link.source_agent_id} ↔ ${link.target_agent_id}"
            />
          `;
        })}

        <!-- Pending additions (green dashed) -->
        ${Array.from(this.pendingAdditions.entries()).flatMap(([sourceId, targets]) => {
          const src = this.positions.get(sourceId);
          if (!src) return [];
          return Array.from(targets).map((targetId) => {
            const tgt = this.positions.get(targetId);
            if (!tgt) return "";
            const cl = clipLine(src, tgt, CARD_MARGIN);
            return svg`
              <line
                x1=${cl.x1} y1=${cl.y1}
                x2=${cl.x2} y2=${cl.y2}
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
