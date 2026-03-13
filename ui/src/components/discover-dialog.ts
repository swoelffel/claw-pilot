// ui/src/components/discover-dialog.ts
import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { DiscoveredInstanceInfo } from "../types.js";
import { discoverInstances, adoptInstances } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { DialogMixin } from "../lib/dialog-mixin.js";
import { tokenStyles } from "../styles/tokens.js";
import { spinnerStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";

type Phase = "scanning" | "results" | "adopting" | "done" | "error";

@localized()
@customElement("cp-discover-dialog")
export class DiscoverDialog extends DialogMixin(LitElement) {
  static override styles = [
    tokenStyles,
    spinnerStyles,
    errorBannerStyles,
    buttonStyles,
    css`
      :host {
        display: block;
      }

      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        z-index: 200;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }

      .dialog {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 520px;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
      }

      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 24px 16px;
        border-bottom: 1px solid var(--bg-border);
      }

      .dialog-title {
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.01em;
      }

      .close-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 4px;
        border-radius: var(--radius-sm);
        transition: color 0.15s;
      }
      .close-btn:hover {
        color: var(--text-primary);
      }
      .close-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .dialog-body {
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      /* Scanning / adopting spinner state */
      .spinner-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        padding: 48px 24px;
        color: var(--text-secondary);
        font-size: 14px;
        text-align: center;
      }

      .spinner-hint {
        font-size: 12px;
        color: var(--text-muted);
      }

      /* Done state */
      .done-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 48px 24px;
        color: var(--text-secondary);
        font-size: 14px;
        text-align: center;
      }

      .done-icon {
        font-size: 28px;
        color: var(--state-success, #22c55e);
      }

      /* Results */
      .found-label {
        font-size: 13px;
        color: var(--text-secondary);
      }

      .instance-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 320px;
        overflow-y: auto;
      }

      .instance-card {
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .instance-card-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .instance-slug {
        font-weight: 700;
        color: var(--text-primary);
        font-size: 14px;
      }

      .badge-running {
        font-size: 11px;
        font-weight: 600;
        color: var(--state-success, #22c55e);
        background: color-mix(in srgb, var(--state-success, #22c55e) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--state-success, #22c55e) 30%, transparent);
        border-radius: 999px;
        padding: 2px 8px;
      }

      .badge-stopped {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        background: color-mix(in srgb, var(--text-muted) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--text-muted) 20%, transparent);
        border-radius: 999px;
        padding: 2px 8px;
      }

      .instance-meta {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .meta-port {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-muted);
      }

      .meta-telegram {
        font-size: 12px;
        color: #0088cc;
        background: color-mix(in srgb, #0088cc 10%, transparent);
        border: 1px solid color-mix(in srgb, #0088cc 25%, transparent);
        border-radius: 999px;
        padding: 1px 7px;
      }

      .meta-model {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-muted);
      }

      .meta-agents {
        font-size: 12px;
        color: var(--text-muted);
      }

      /* Empty results */
      .empty-results {
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.6;
      }

      .empty-results p {
        margin: 0 0 8px;
      }

      .empty-results p:last-child {
        margin: 0;
        color: var(--text-muted);
        font-size: 12px;
      }

      /* Footer */
      .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 16px 24px 20px;
        border-top: 1px solid var(--bg-border);
      }
    `,
  ];

  @state() private _phase: Phase = "scanning";
  @state() private _found: DiscoveredInstanceInfo[] = [];
  @state() private _errorMsg = "";
  @state() private _adoptedCount = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._scan();
  }

  private async _scan(): Promise<void> {
    this._phase = "scanning";
    try {
      const result = await discoverInstances();
      this._found = result.found;
      this._phase = "results";
    } catch (err) {
      this._errorMsg = userMessage(err);
      this._phase = "error";
    }
  }

  private async _adopt(): Promise<void> {
    if (this._phase !== "results" || this._found.length === 0) return;
    this._phase = "adopting";
    try {
      const slugs = this._found.map((i) => i.slug);
      const result = await adoptInstances(slugs);
      this._adoptedCount = result.adopted.length;
      this._phase = "done";
      // Auto-close after 1.5s and notify parent
      setTimeout(() => {
        this.dispatchEvent(
          new CustomEvent("instances-adopted", {
            detail: { count: this._adoptedCount },
            bubbles: true,
            composed: true,
          }),
        );
      }, 1500);
    } catch (err) {
      this._errorMsg = userMessage(err);
      this._phase = "error";
    }
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private _renderInstanceCard(inst: DiscoveredInstanceInfo) {
    return html`
      <div class="instance-card">
        <div class="instance-card-row">
          <span class="instance-slug">${inst.slug}</span>
          ${inst.gatewayHealthy
            ? html`<span class="badge-running">● running</span>`
            : html`<span class="badge-stopped">○ stopped</span>`}
        </div>
        <div class="instance-meta">
          <span class="meta-port">:${inst.port}</span>
          ${inst.telegramBot ? html`<span class="meta-telegram">✈ ${inst.telegramBot}</span>` : ""}
          ${inst.defaultModel ? html`<span class="meta-model">${inst.defaultModel}</span>` : ""}
          ${inst.agentCount > 0
            ? html`<span class="meta-agents"
                >${inst.agentCount} agent${inst.agentCount !== 1 ? "s" : ""}</span
              >`
            : ""}
        </div>
      </div>
    `;
  }

  private _renderBody() {
    switch (this._phase) {
      case "scanning":
        return html`
          <div class="spinner-state">
            <div class="spinner"></div>
            <div>${msg("Scanning system...", { id: "discover-scanning" })}</div>
            <div class="spinner-hint">
              ${msg("Looking for existing instances", { id: "discover-scanning-hint" })}
            </div>
          </div>
        `;

      case "results":
        if (this._found.length === 0) {
          return html`
            <div class="dialog-body">
              <div class="empty-results">
                <p>
                  ${msg("No instances found on this system.", {
                    id: "discover-none-found",
                  })}
                </p>
                <p>Make sure at least one instance directory exists.</p>
              </div>
            </div>
            <div class="dialog-footer">
              <button class="btn btn-ghost" @click=${this._close}>
                ${msg("Close", { id: "btn-cancel" })}
              </button>
            </div>
          `;
        }
        return html`
          <div class="dialog-body">
            <div class="found-label">
              ${msg(`Found ${this._found.length} instance(s) on this system:`, {
                id: "discover-found-n",
              })}
            </div>
            <div class="instance-list">
              ${this._found.map((inst) => this._renderInstanceCard(inst))}
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" @click=${this._close}>
              ${msg("Cancel", { id: "btn-cancel" })}
            </button>
            <button class="btn btn-primary" @click=${() => void this._adopt()}>
              ${msg(`Adopt all (${this._found.length})`, { id: "discover-adopt-btn" })}
            </button>
          </div>
        `;

      case "adopting":
        return html`
          <div class="spinner-state">
            <div class="spinner"></div>
            <div>${msg("Registering instances...", { id: "discover-adopting" })}</div>
          </div>
        `;

      case "done":
        return html`
          <div class="done-state">
            <div class="done-icon">✓</div>
            <div>
              ${msg(`${this._adoptedCount} instance(s) registered successfully.`, {
                id: "discover-done",
              })}
            </div>
          </div>
        `;

      case "error":
        return html`
          <div class="dialog-body">
            <div class="error-banner">${this._errorMsg}</div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" @click=${this._close}>
              ${msg("Close", { id: "btn-cancel" })}
            </button>
            <button class="btn btn-secondary" @click=${() => void this._scan()}>Retry</button>
          </div>
        `;
    }
  }

  private _isCloseable(): boolean {
    return this._phase !== "adopting";
  }

  override render() {
    return html`
      <div
        class="overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discover-dialog-title"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget && this._isCloseable()) this._close();
        }}
      >
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title" id="discover-dialog-title">
              ${msg("Discover instances", { id: "discover-dialog-title" })}
            </span>
            <button
              class="close-btn"
              aria-label="Close"
              @click=${this._close}
              ?disabled=${!this._isCloseable()}
            >
              ✕
            </button>
          </div>
          ${this._renderBody()}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-discover-dialog": DiscoverDialog;
  }
}
