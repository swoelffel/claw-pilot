// ui/src/components/agent-card-mini.ts
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBuilderInfo } from "../types.js";
import { tokenStyles } from "../styles/tokens.js";

@localized()
@customElement("cp-agent-card-mini")
export class AgentCardMini extends LitElement {
  static styles = [tokenStyles, css`
    :host {
      display: block;
      position: absolute;
      transform: translate(-50%, -50%);
      cursor: grab;
    }

    .card {
      background: var(--bg-surface);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-md);
      padding: 8px 10px;
      cursor: inherit;
      transition: box-shadow 0.15s, border-color 0.15s;
      user-select: none;
      min-width: 130px;
      max-width: 160px;
      position: relative;
    }

    .card.is-a2a {
      border-color: var(--accent-border);
    }

    .card:hover {
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }

    .card.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent-border);
    }

    :host([is-new]) .card {
      border: 2px solid var(--state-success, #22c55e);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--state-success, #22c55e) 20%, transparent);
      animation: new-agent-pulse 2s ease-out forwards;
    }

    @keyframes new-agent-pulse {
      0%   { box-shadow: 0 0 0 4px color-mix(in srgb, var(--state-success, #22c55e) 30%, transparent); }
      100% { box-shadow: 0 0 0 0px color-mix(in srgb, var(--state-success, #22c55e) 0%, transparent); }
    }

    .card.is-default {
      min-width: 150px;
      max-width: 180px;
    }

    /* row 1 : name + delete button */
    .card-top {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 3px;
    }

    .agent-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }

    /* row 2 : slug (left) + file count (right) */
    .card-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 4px;
    }

    .agent-id {
      font-size: 10px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }

    .file-count {
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* badges (default / a2a) — now unused in card-top, kept for card-bottom if needed */
    .badge-default {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--accent);
      background: var(--accent-subtle);
      border: 1px solid var(--accent-border);
      border-radius: 3px;
      padding: 1px 5px;
      flex-shrink: 0;
    }

    .badge-a2a {
      font-size: 8px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--accent);
      background: var(--accent-subtle);
      border: 1px solid var(--accent-border);
      border-radius: 3px;
      padding: 1px 5px;
      flex-shrink: 0;
    }

    .card-bottom {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
    }

    .badge-role {
      font-size: 9px;
      font-weight: 600;
      color: var(--state-info);
      background: rgba(14, 165, 233, 0.08);
      border: 1px solid rgba(14, 165, 233, 0.25);
      border-radius: 3px;
      padding: 1px 5px;
    }

    .model-label {
      font-size: 9px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 90px;
    }

    .btn-delete {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 2px 3px;
      border-radius: var(--radius-sm);
      opacity: 0.45;
      transition: opacity 0.15s, color 0.15s, background 0.15s;
      flex-shrink: 0;
    }

    .btn-delete:hover {
      opacity: 1;
      color: var(--state-error, #ef4444);
      background: color-mix(in srgb, var(--state-error, #ef4444) 10%, transparent);
    }
  `];

  @property({ type: Object }) agent!: AgentBuilderInfo;
  @property({ type: Boolean }) selected = false;
  @property({ type: Boolean }) isA2A = false;
  @property({ type: Boolean, reflect: true }) isNew = false;
  @property({ type: Boolean }) deletable = false;

  private _truncate(str: string, max: number): string {
    return str.length > max ? str.slice(0, max) + "…" : str;
  }

  /** Resolve model string — handles JSON-stringified objects like {"primary":"provider/model"} */
  private _resolveModel(raw: string | null): string | null {
    if (!raw) return null;
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return (parsed["primary"] as string | undefined) ?? raw;
      } catch {
        return raw;
      }
    }
    return raw;
  }

  override render() {
    const a = this.agent;
    const model = this._resolveModel(a.model);
    const modelShort = model ? this._truncate(model.split("/").pop() ?? model, 18) : null;

    return html`
      <div
        class="card ${a.is_default ? "is-default" : ""} ${this.selected ? "selected" : ""} ${this.isA2A ? "is-a2a" : ""}"
        @click=${() => this.dispatchEvent(new CustomEvent("agent-select", { detail: { agentId: a.agent_id }, bubbles: true, composed: true }))}
      >
        <!-- row 1 : name + delete -->
        <div class="card-top">
          <span class="agent-name" title=${a.name}>${this._truncate(a.name, 22)}</span>
          ${this.deletable ? html`
            <button
              class="btn-delete"
              title=${msg("Delete agent", { id: "acm-btn-delete" })}
              @click=${(e: Event) => {
                e.stopPropagation();
                this.dispatchEvent(new CustomEvent("agent-delete-requested", {
                  detail: { agentId: this.agent.agent_id },
                  bubbles: true,
                  composed: true,
                }));
              }}
            >✕</button>
          ` : nothing}
        </div>
        <!-- row 2 : slug (left) + file count (right) -->
        <div class="card-meta">
          <span class="agent-id">${a.agent_id}</span>
          <span class="file-count">${a.files.length} ${msg("files", { id: "acm-files" })}</span>
        </div>
        <!-- row 3 : badges + model -->
        <div class="card-bottom">
          ${a.is_default
            ? html`<span class="badge-default">${msg("Default", { id: "acm-badge-default" })}</span>`
            : this.isA2A
              ? html`<span class="badge-a2a">${msg("A2A", { id: "acm-badge-a2a" })}</span>`
              : nothing}
          ${a.role ? html`<span class="badge-role">${a.role}</span>` : ""}
          ${modelShort ? html`<span class="model-label" title=${model ?? ""}>${modelShort}</span>` : ""}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-card-mini": AgentCardMini;
  }
}
