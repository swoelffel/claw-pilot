// ui/src/components/agent-links-svg.ts
import { LitElement, html, css, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { AgentLink } from "../types.js";

@customElement("cp-agent-links-svg")
export class AgentLinksSvg extends LitElement {
  static styles = css`
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
  @property({ type: Object }) positions: Map<string, { x: number; y: number }> = new Map();
  @property({ type: Object }) pendingRemovals: Set<string> = new Set();
  @property({ type: Object }) pendingAdditions: Map<string, Set<string>> = new Map();

  override render() {
    return html`
      <svg>
        <defs>
          <marker id="arrow-spawn" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#666" />
          </marker>
          <marker id="arrow-spawn-pending-remove" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
          </marker>
          <marker id="arrow-spawn-pending-add" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#10b981" />
          </marker>
        </defs>
        ${this.links
          .filter(link => link.link_type === "spawn")
          .map(link => {
            const src = this.positions.get(link.source_agent_id);
            const tgt = this.positions.get(link.target_agent_id);
            if (!src || !tgt) return "";

            const isPendingRemove = this.pendingRemovals.has(link.target_agent_id);
            const color = isPendingRemove ? "#ef4444" : "#666";
            const marker = isPendingRemove ? "url(#arrow-spawn-pending-remove)" : "url(#arrow-spawn)";

            return svg`
              <line
                x1=${src.x} y1=${src.y}
                x2=${tgt.x} y2=${tgt.y}
                stroke=${color}
                stroke-width="1.5"
                stroke-dasharray="6 4"
                stroke-opacity=${isPendingRemove ? "0.8" : "1"}
                marker-end=${marker}
              />
            `;
          })}
        ${Array.from(this.pendingAdditions.entries()).flatMap(([sourceId, targets]) => {
          const src = this.positions.get(sourceId);
          if (!src) return [];
          return Array.from(targets).map(targetId => {
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
                marker-end="url(#arrow-spawn-pending-add)"
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
