// ui/src/components/delete-agent-dialog.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBuilderInfo, BuilderData } from "../types.js";
import { deleteAgent } from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { spinnerStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-delete-agent-dialog")
export class DeleteAgentDialog extends LitElement {
  static styles = [tokenStyles, spinnerStyles, errorBannerStyles, buttonStyles, css`
    :host { display: block; }

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
      max-width: 440px;
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
    .close-btn:hover { color: var(--text-primary); }
    .close-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .dialog-body {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .warning-box {
      background: color-mix(in srgb, var(--state-error, #ef4444) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--state-error, #ef4444) 30%, transparent);
      border-radius: var(--radius-md);
      padding: 12px 14px;
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.5;
    }

    .agent-info {
      font-size: 13px;
      color: var(--text-secondary);
    }

    .agent-info strong {
      color: var(--text-primary);
      font-family: var(--font-mono);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
    }

    .confirm-hint {
      font-size: 12px;
      color: var(--text-muted);
    }

    .confirm-hint code {
      font-family: var(--font-mono);
      color: var(--text-primary);
      background: var(--bg-base);
      padding: 1px 4px;
      border-radius: 3px;
    }

    input[type="text"] {
      background: var(--bg-base);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 14px;
      font-family: var(--font-mono);
      padding: 8px 12px;
      width: 100%;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.15s;
    }
    input[type="text"]:focus { border-color: var(--state-error, #ef4444); }

    .spinner-overlay {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 48px 24px;
      color: var(--text-secondary);
      font-size: 14px;
    }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 16px 24px 20px;
      border-top: 1px solid var(--bg-border);
    }

    .btn-danger {
      background: var(--state-error, #ef4444);
      border: 1px solid var(--state-error, #ef4444);
      color: white;
      border-radius: var(--radius-md);
      padding: 7px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
      font-family: inherit;
    }
    .btn-danger:hover:not(:disabled) { opacity: 0.85; }
    .btn-danger:disabled { opacity: 0.4; cursor: not-allowed; }
  `];

  @property({ type: String }) instanceSlug = "";
  @property({ type: Object }) agent: AgentBuilderInfo | null = null;

  @state() private _confirmInput = "";
  @state() private _submitting = false;
  @state() private _submitError = "";

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private _isConfirmed(): boolean {
    return this._confirmInput === this.agent?.agent_id;
  }

  private async _submit(): Promise<void> {
    if (!this.agent || !this._isConfirmed() || this._submitting) return;
    this._submitting = true;
    this._submitError = "";
    try {
      const builderData = await deleteAgent(this.instanceSlug, this.agent.agent_id);
      this.dispatchEvent(new CustomEvent("agent-deleted", {
        detail: builderData,
        bubbles: true,
        composed: true,
      }));
    } catch (err) {
      this._submitError = err instanceof Error ? err.message : msg("Failed to delete agent", { id: "dad-error-delete" });
      this._submitting = false;
    }
  }

  private _renderSpinner() {
    return html`
      <div class="spinner-overlay">
        <div class="spinner"></div>
        <div>${msg("Deleting agent...", { id: "dad-spinner-deleting" })} <strong>${this.agent?.agent_id}</strong></div>
      </div>
    `;
  }

  private _renderForm() {
    const a = this.agent;
    if (!a) return html``;
    return html`
      <div class="dialog-body">
        <div class="warning-box">
          ${msg("This will permanently delete all workspace files and unregister the agent from the instance. This action cannot be undone.", { id: "dad-warning" })}
        </div>
        <div class="agent-info">
          ${a.name} — <strong>${a.agent_id}</strong>
        </div>
        <div class="field">
          <label>${msg("Type the agent ID to confirm", { id: "dad-confirm-label" })}</label>
          <span class="confirm-hint"><code>${a.agent_id}</code></span>
          <input
            type="text"
            .value=${this._confirmInput}
            @input=${(e: Event) => { this._confirmInput = (e.target as HTMLInputElement).value; }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") void this._submit(); }}
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        ${this._submitError ? html`<div class="error-banner">${this._submitError}</div>` : ""}
      </div>
      <div class="dialog-footer">
        <button class="btn btn-ghost" @click=${this._close}>${msg("Cancel", { id: "dad-btn-cancel" })}</button>
        <button
          class="btn-danger"
          ?disabled=${!this._isConfirmed()}
          @click=${() => void this._submit()}
        >${msg("Delete", { id: "dad-btn-confirm" })}</button>
      </div>
    `;
  }

  override render() {
    return html`
      <div class="overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._close(); }}>
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">${msg("Delete agent", { id: "dad-title" })}</span>
            <button class="close-btn" aria-label="Close" @click=${this._close} ?disabled=${this._submitting}>✕</button>
          </div>
          ${this._submitting ? this._renderSpinner() : this._renderForm()}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-delete-agent-dialog": DeleteAgentDialog;
  }
}
