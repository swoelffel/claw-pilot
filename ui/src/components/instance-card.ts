import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceInfo } from "../types.js";
import { startInstance, stopInstance } from "../api.js";

@localized()
@customElement("cp-instance-card")
export class InstanceCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: #1a1d27;
      border: 1px solid #2a2d3a;
      border-radius: 10px;
      padding: 20px;
      position: relative;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      gap: 10px;
    }

    .card-header-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .slug {
      font-size: 18px;
      font-weight: 700;
      color: #e2e8f0;
      letter-spacing: -0.01em;
    }

    .display-name {
      font-size: 12px;
      color: #94a3b8;
      margin-top: 2px;
    }

    .state-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      flex-shrink: 0;
    }

    .state-badge.running {
      background: #10b98120;
      color: #10b981;
      border: 1px solid #10b98140;
    }

    .state-badge.stopped {
      background: #64748b20;
      color: #64748b;
      border: 1px solid #64748b40;
    }

    .state-badge.error {
      background: #ef444420;
      color: #ef4444;
      border: 1px solid #ef444440;
    }

    .state-badge.unknown {
      background: #f59e0b20;
      color: #f59e0b;
      border: 1px solid #f59e0b40;
    }

    .state-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 13px;
      color: #94a3b8;
    }

    .meta-label {
      color: #4a5568;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .meta-value {
      color: #94a3b8;
      font-family: "Fira Mono", monospace;
    }

    .telegram-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #0088cc20;
      color: #0088cc;
      border: 1px solid #0088cc40;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
    }

    .actions {
      display: flex;
      gap: 8px;
    }

    .btn {
      flex: none;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: opacity 0.15s, background 0.15s;
      text-align: center;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-start {
      background: #10b98120;
      color: #10b981;
      border-color: #10b98140;
    }

    .btn-start:hover:not(:disabled) {
      background: #10b98130;
    }

    .btn-stop {
      background: #ef444420;
      color: #ef4444;
      border-color: #ef444440;
    }

    .btn-stop:hover:not(:disabled) {
      background: #ef444430;
    }

    .btn-ui {
      flex: none;
      padding: 7px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid #f59e0b40;
      background: #f59e0b20;
      color: #f59e0b;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      transition: background 0.15s;
    }

    .btn-ui:hover {
      background: #f59e0b30;
    }

    .btn-builder {
      flex: none;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid #0ea5e940;
      background: #0ea5e920;
      color: #0ea5e9;
      transition: background 0.15s;
    }

    .btn-builder:hover {
      background: #0ea5e940;
    }

    .error-msg {
      margin-top: 8px;
      font-size: 11px;
      color: #ef4444;
    }
  `;

  @property({ type: Object }) instance!: InstanceInfo;

  @state() private _loading = false;
  @state() private _error = "";

  private async _action(
    e: Event,
    fn: (slug: string) => Promise<void>,
  ): Promise<void> {
    e.stopPropagation();
    this._loading = true;
    this._error = "";
    try {
      await fn(this.instance.slug);
    } catch (err) {
      this._error = err instanceof Error ? err.message : msg("Action failed", { id: "action-failed" });
    } finally {
      this._loading = false;
    }
  }

  private _stateClass(): string {
    return this.instance.state ?? "unknown";
  }

  override render() {
    const inst = this.instance;
    const stateClass = this._stateClass();

    return html`
      <div class="card">
        <div class="card-header">
          <div>
            <div class="slug">${inst.slug}</div>
            ${inst.display_name
              ? html`<div class="display-name">${inst.display_name}</div>`
              : ""}
          </div>
          <div class="card-header-right">
            <span class="state-badge ${stateClass}">
              <span class="state-dot"></span>
              ${stateClass}
            </span>
            ${inst.state === "running"
              ? html`<a
                  class="btn-ui"
                  href=${inst.gatewayToken
                    ? `http://localhost:${inst.port}/#token=${inst.gatewayToken}`
                    : `http://localhost:${inst.port}`}
                  target="_blank"
                  rel="noopener"
                  @click=${(e: Event) => e.stopPropagation()}
                >⎋ UI</a>`
              : ""}
          </div>
        </div>

        <div class="meta">
          <div class="meta-item">
            <span class="meta-label">${msg("Port", { id: "meta-port" })}</span>
            <span class="meta-value">:${inst.port}</span>
          </div>
          ${inst.agentCount !== undefined
            ? html`
                <div class="meta-item">
                  <span class="meta-label">${inst.agentCount === 1
                    ? msg("Agent", { id: "meta-agent" })
                    : msg("Agents", { id: "meta-agents" })}</span>
                  <span class="meta-value">:${inst.agentCount}</span>
                </div>
              `
            : ""}
          ${inst.telegram_bot
            ? html`
                <div class="meta-item">
                  <span class="telegram-tag">&#9992; ${inst.telegram_bot}</span>
                </div>
              `
            : ""}
          ${inst.default_model
            ? html`
                <div class="meta-item">
                  <span class="meta-label">${msg("Model", { id: "meta-model" })}</span>
                  <span class="meta-value">${inst.default_model}</span>
                </div>
              `
            : ""}
        </div>

        <div class="actions">
          <button
            class="btn btn-start"
            ?disabled=${this._loading || inst.state === "running"}
            @click=${(e: Event) => this._action(e, startInstance)}
          >
            ${msg("Start", { id: "btn-start" })}
          </button>
          <button
            class="btn btn-stop"
            ?disabled=${this._loading || inst.state !== "running"}
            @click=${(e: Event) => this._action(e, stopInstance)}
          >
            ${msg("Stop", { id: "btn-stop" })}
          </button>
          ${(inst.state === "running" || (inst.agentCount ?? 0) > 0)
            ? html`<button
                class="btn-builder"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.dispatchEvent(new CustomEvent("navigate", {
                    detail: { view: "agents-builder", slug: inst.slug },
                    bubbles: true,
                    composed: true,
                  }));
                }}
              >Agents</button>`
            : ""}
        </div>

        ${this._error
          ? html`<div class="error-msg">${this._error}</div>`
          : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-card": InstanceCard;
  }
}
