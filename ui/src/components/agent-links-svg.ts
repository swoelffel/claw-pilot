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

  override render() {
    return html`
      <svg>
        <defs>
          <marker id="arrow-spawn" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#666" />
          </marker>
        </defs>
        ${this.links.map(link => {
          const src = this.positions.get(link.source_agent_id);
          const tgt = this.positions.get(link.target_agent_id);
          if (!src || !tgt) return "";

          if (link.link_type === "a2a") {
            return svg`
              <line
                x1=${src.x} y1=${src.y}
                x2=${tgt.x} y2=${tgt.y}
                stroke="#6c63ff"
                stroke-width="2"
                stroke-opacity="0.6"
              />
            `;
          } else {
            return svg`
              <line
                x1=${src.x} y1=${src.y}
                x2=${tgt.x} y2=${tgt.y}
                stroke="#666"
                stroke-width="1.5"
                stroke-dasharray="6 4"
                marker-end="url(#arrow-spawn)"
              />
            `;
          }
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
