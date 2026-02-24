// ui/src/components/agent-card-mini.ts
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { AgentBuilderInfo } from "../types.js";

@customElement("cp-agent-card-mini")
export class AgentCardMini extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: absolute;
      transform: translate(-50%, -50%);
    }

    .card {
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 8px 10px;
      cursor: pointer;
      transition: box-shadow 0.15s, border-color 0.15s;
      user-select: none;
      min-width: 130px;
      max-width: 160px;
    }

    .card:hover {
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }

    .card.selected {
      border-color: #6c63ff;
      box-shadow: 0 0 0 1px #6c63ff40;
    }

    .card.is-default {
      min-width: 150px;
      max-width: 180px;
    }

    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .badge-default {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6c63ff;
      background: #6c63ff20;
      border: 1px solid #6c63ff40;
      border-radius: 3px;
      padding: 1px 5px;
    }

    .file-count {
      font-size: 10px;
      color: #4a5568;
    }

    .agent-name {
      font-size: 12px;
      font-weight: 600;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 2px;
    }

    .agent-id {
      font-size: 10px;
      color: #4a5568;
      font-family: "Fira Mono", monospace;
      margin-bottom: 4px;
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
      color: #0ea5e9;
      background: #0ea5e920;
      border: 1px solid #0ea5e940;
      border-radius: 3px;
      padding: 1px 5px;
    }

    .model-label {
      font-size: 9px;
      color: #4a5568;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 90px;
    }
  `;

  @property({ type: Object }) agent!: AgentBuilderInfo;
  @property({ type: Boolean }) selected = false;

  private _truncate(str: string, max: number): string {
    return str.length > max ? str.slice(0, max) + "…" : str;
  }

  override render() {
    const a = this.agent;
    const modelShort = a.model ? this._truncate(a.model.split("/").pop() ?? a.model, 18) : null;

    return html`
      <div
        class="card ${a.is_default ? "is-default" : ""} ${this.selected ? "selected" : ""}"
        @click=${() => this.dispatchEvent(new CustomEvent("agent-select", { detail: { agentId: a.agent_id }, bubbles: true, composed: true }))}
      >
        <div class="card-top">
          ${a.is_default ? html`<span class="badge-default">Default</span>` : html`<span></span>`}
          <span class="file-count">${a.files.length} files</span>
        </div>
        <div class="agent-name" title=${a.name}>${this._truncate(a.name, 25)}</div>
        <div class="agent-id">${a.agent_id}</div>
        <div class="card-bottom">
          ${a.role ? html`<span class="badge-role">${a.role}</span>` : ""}
          ${modelShort ? html`<span class="model-label" title=${a.model ?? ""}>${modelShort}</span>` : ""}
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
