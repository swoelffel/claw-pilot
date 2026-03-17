// ui/src/components/pilot/parts/part-reasoning.ts
// Part type "reasoning" — collapsible thinking trace, closed by default.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../../styles/tokens.js";

@localized()
@customElement("cp-pilot-part-reasoning")
export class PilotPartReasoning extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .reasoning-block {
        border-left: 2px solid var(--bg-border);
        border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        overflow: hidden;
      }

      .reasoning-toggle {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 5px 10px;
        background: none;
        border: none;
        width: 100%;
        text-align: left;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--text-muted);
        cursor: pointer;
        transition: color 0.12s;
      }

      .reasoning-toggle:hover {
        color: var(--text-secondary);
      }

      .reasoning-chevron {
        font-size: 9px;
        transition: transform 0.15s;
        flex-shrink: 0;
      }

      .reasoning-toggle.expanded .reasoning-chevron {
        transform: rotate(90deg);
      }

      .reasoning-label {
        font-style: italic;
      }

      .reasoning-content {
        padding: 6px 12px 8px;
        background: var(--bg-hover);
        font-size: 12px;
        font-style: italic;
        color: var(--text-muted);
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.5;
      }
    `,
  ];

  @property() content = "";
  @state() private _expanded = false;

  override render() {
    return html`
      <div class="reasoning-block">
        <button
          class="reasoning-toggle ${this._expanded ? "expanded" : ""}"
          @click=${() => {
            this._expanded = !this._expanded;
          }}
        >
          <span class="reasoning-chevron">▶</span>
          <span class="reasoning-label">
            💭 ${msg("Thinking…", { id: "part-reasoning-label" })}
          </span>
          ${!this._expanded
            ? html`<span style="font-size:10px;color:var(--text-muted)">
                (${this.content.length.toLocaleString()} chars)
              </span>`
            : nothing}
        </button>
        ${this._expanded ? html`<div class="reasoning-content">${this.content}</div>` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-reasoning": PilotPartReasoning;
  }
}
