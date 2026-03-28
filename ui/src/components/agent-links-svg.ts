// ui/src/components/agent-links-svg.ts
import { LitElement, html, css, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { type AgentLink, isArchetypeLink } from "../types.js";
import { tokenStyles } from "../styles/tokens.js";

// Card half-dimensions (cards are centered on position via translate(-50%,-50%))
// Fixed card size: 186–200px wide (+ 3px border-left) × 72–96px tall
const CARD_HW = 104; // half-width: ~200px / 2 (use max width for safe margin)
const CARD_HH = 50; // half-height: ~96px / 2 (use max height for safe margin)
const EDGE_PAD = 4; // extra padding so the arrow doesn't touch the border

/**
 * Find where a ray from `center` toward `target` exits a rectangle of given
 * half-width/half-height centered on `center`. Returns the intersection point
 * on the rectangle edge (+ padding).
 */
function rectEdgePoint(
  center: { x: number; y: number },
  target: { x: number; y: number },
  hw: number,
  hh: number,
): { x: number; y: number } {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return { x: center.x, y: center.y };

  // Scale factor to reach each edge
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);

  return { x: center.x + dx * s, y: center.y + dy * s };
}

/**
 * Clip a line so it starts at the edge of the source card and ends at the
 * edge of the target card (ray-rectangle intersection).
 */
function clipLine(
  src: { x: number; y: number },
  tgt: { x: number; y: number },
): { x1: number; y1: number; x2: number; y2: number } {
  const p1 = rectEdgePoint(src, tgt, CARD_HW + EDGE_PAD, CARD_HH + EDGE_PAD);
  const p2 = rectEdgePoint(tgt, src, CARD_HW + EDGE_PAD, CARD_HH + EDGE_PAD);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

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
            const cl = clipLine(src, tgt);

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
          const cl = clipLine(src, tgt);

          return svg`
            <line
              x1=${cl.x1} y1=${cl.y1}
              x2=${cl.x2} y2=${cl.y2}
              stroke="#64748b"
              stroke-width="1.5"
              stroke-dasharray="6 4"
              stroke-opacity="0.6"
              ${isBi ? "" : svg`marker-end="url(#arrow-a2a)"`}
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
            const cl = clipLine(src, tgt);
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
