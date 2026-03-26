// ui/src/components/agent-links-svg.ts
import { LitElement, html, css, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { type AgentLink, type AgentBuilderInfo, isArchetypeLink } from "../types.js";

@customElement("cp-agent-links-svg")
export class AgentLinksSvg extends LitElement {
  static override styles = css`
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
  `;

  @property({ type: Array }) links: AgentLink[] = [];
  @property({ type: Array }) agents: AgentBuilderInfo[] = [];
  @property({ type: Object }) positions: Map<string, { x: number; y: number }> = new Map();
  @property({ type: Object }) pendingRemovals: Set<string> = new Set();
  @property({ type: Object }) pendingAdditions: Map<string, Set<string>> = new Map();

  /**
   * Resolve the canvas position for a link target.
   * For @archetype targets, find the first agent with a matching archetype tag.
   */
  /**
   * Resolve canvas position for a link target.
   * For @archetype targets, there is no positioned canvas card — returns undefined.
   * These links are shown as badges in the detail panel instead.
   */
  private _resolveTargetPos(
    targetId: string,
  ): { pos: { x: number; y: number }; label: string } | undefined {
    if (targetId.startsWith("@")) return undefined;
    const pos = this.positions.get(targetId);
    return pos ? { pos, label: targetId } : undefined;
  }

  override render() {
    return html`
      <svg>
        <defs>
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
          <marker id="arrow-a2a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
          </marker>
        </defs>
        <!-- Spawn links (dashed) -->
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
        <!-- A2A links (solid, thin) -->
        ${this.links
          .filter((link) => link.link_type === "a2a" && !isArchetypeLink(link))
          .map((link) => {
            const src = this.positions.get(link.source_agent_id);
            const tgt = this.positions.get(link.target_agent_id);
            if (!src || !tgt) return "";

            return svg`
              <line
                x1=${src.x} y1=${src.y}
                x2=${tgt.x} y2=${tgt.y}
                stroke="#94a3b8"
                stroke-width="1"
                marker-end="url(#arrow-a2a)"
                aria-label="a2a link to ${link.target_agent_id}"
              />
            `;
          })}
        <!-- Pending additions -->
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
