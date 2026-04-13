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
        max-height: 280px;
        overflow-y: auto;
      }

      .reasoning-preview {
        font-size: 11px;
        font-style: italic;
        color: var(--text-muted);
        opacity: 0.8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1 1 auto;
        min-width: 0;
        margin-left: 4px;
      }

      .reasoning-pulse {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--text-muted);
        margin-left: 2px;
        animation: cp-reasoning-pulse 1.1s ease-in-out infinite;
        flex-shrink: 0;
      }

      @keyframes cp-reasoning-pulse {
        0%,
        100% {
          opacity: 0.3;
          transform: scale(0.85);
        }
        50% {
          opacity: 1;
          transform: scale(1.1);
        }
      }
    `,
  ];

  @property() content = "";
  /** True while the reasoning part is still being streamed from the runtime. */
  @property({ type: Boolean }) isStreaming = false;
  @state() private _expanded = false;

  /** Extract the last non-empty line, truncated for inline preview. */
  private _previewLine(): string {
    const line = this.content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .pop();
    if (!line) return "";
    return line.length > 80 ? `…${line.slice(-79)}` : line;
  }

  override updated(changed: Map<string | number | symbol, unknown>): void {
    // When streaming and expanded, keep the content view pinned to the bottom
    // so the user sees the latest tokens without manual scrolling.
    if (this.isStreaming && this._expanded && changed.has("content")) {
      const el = this.renderRoot.querySelector<HTMLDivElement>(".reasoning-content");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }

  override render() {
    const preview = this.isStreaming && !this._expanded ? this._previewLine() : "";
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
          ${this.isStreaming ? html`<span class="reasoning-pulse"></span>` : nothing}
          ${!this._expanded
            ? this.isStreaming && preview
              ? html`<span class="reasoning-preview">${preview}</span>`
              : html`<span style="font-size:10px;color:var(--text-muted)">
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
