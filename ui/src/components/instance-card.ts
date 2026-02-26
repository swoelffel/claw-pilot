import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceInfo } from "../types.js";
import { startInstance, stopInstance } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { badgeStyles, buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-instance-card")
export class InstanceCard extends LitElement {
  static styles = [tokenStyles, badgeStyles, buttonStyles, css`
    :host {
      display: block;
    }

    .card {
      background: var(--bg-surface);
      border: 1px solid var(--bg-border);
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
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }

    .display-name {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
    }

    .meta {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 0;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .meta-label {
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .meta-value {
      color: var(--text-secondary);
      font-family: var(--font-mono);
    }

    .telegram-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #0088cc20;
      color: #0088cc;
      border: 1px solid #0088cc40;
      border-radius: var(--radius-sm);
      padding: 2px 8px;
      font-size: 11px;
    }

    .btn-ui {
      flex: none;
      padding: 7px 10px;
      border-radius: var(--radius-md);
      font-size: 12px;
      font-weight: 600;
      border: 1px solid rgba(245, 158, 11, 0.25);
      background: rgba(245, 158, 11, 0.08);
      color: var(--state-warning);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      transition: background 0.15s;
    }

    .btn-ui:hover {
      background: rgba(245, 158, 11, 0.15);
    }

    .btn-builder {
      flex: none;
      padding: 5px 10px;
      border-radius: var(--radius-md);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid rgba(14, 165, 233, 0.25);
      background: rgba(14, 165, 233, 0.08);
      color: var(--state-info);
      transition: background 0.15s;
    }

    .btn-builder:hover {
      background: rgba(14, 165, 233, 0.15);
    }

    .btn-delete-instance {
      flex: none;
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-muted);
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .btn-delete-instance:hover {
      color: var(--state-error);
      border-color: color-mix(in srgb, var(--state-error) 30%, transparent);
      background: color-mix(in srgb, var(--state-error) 8%, transparent);
    }

    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 12px;
    }

    .card-footer-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .error-msg {
      margin-top: 8px;
      font-size: 11px;
      color: var(--state-error);
    }
  `];

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
      this._error = userMessage(err);
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
            <span class="badge ${stateClass}">
              <span class="state-dot"></span>
              ${stateClass}
            </span>
            <button
              class="btn ${inst.state === 'running' ? 'btn-stop' : 'btn-start'}"
              ?disabled=${this._loading}
              @click=${(e: Event) => this._action(e, inst.state === "running" ? stopInstance : startInstance)}
            >
              ${inst.state === "running"
                ? msg("Stop", { id: "btn-stop" })
                : msg("Start", { id: "btn-start" })}
            </button>
            <button
              class="btn-delete-instance"
              aria-label=${msg("Delete", { id: "btn-delete" })}
              @click=${(e: Event) => {
                e.stopPropagation();
                this.dispatchEvent(new CustomEvent("request-delete", {
                  detail: { slug: inst.slug },
                  bubbles: true,
                  composed: true,
                }));
              }}
            >✕</button>
          </div>
        </div>

        <div class="meta">
          <div class="meta-item">
            <span class="meta-label">${msg("Port", { id: "meta-port" })}</span>
            <span class="meta-value">:${inst.port}</span>
          </div>
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

        <div class="card-footer">
          <div class="meta-item">
            ${inst.agentCount !== undefined
              ? html`
                  <span class="meta-label">${inst.agentCount === 1
                    ? msg("Agent", { id: "meta-agent" })
                    : msg("Agents", { id: "meta-agents" })}</span>
                  <span class="meta-value">:${inst.agentCount}</span>
                `
              : ""}
          </div>
          <div class="card-footer-actions">
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
