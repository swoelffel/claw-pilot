// ui/src/components/delete-instance-dialog.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceInfo } from "../types.js";
import { deleteInstance } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { spinnerStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-delete-instance-dialog")
export class DeleteInstanceDialog extends LitElement {
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

    .instance-info {
      font-size: 13px;
      color: var(--text-secondary);
    }

    .instance-info strong {
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

  @property({ type: Object }) instance: InstanceInfo | null = null;

  @state() private _confirmInput = "";
  @state() private _submitting = false;
  @state() private _submitError = "";

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private _isConfirmed(): boolean {
    return this._confirmInput === this.instance?.slug;
  }

  private async _submit(): Promise<void> {
    if (!this.instance || !this._isConfirmed() || this._submitting) return;
    this._submitting = true;
    this._submitError = "";
    try {
      await deleteInstance(this.instance.slug);
      this.dispatchEvent(new CustomEvent("instance-deleted", {
        detail: { slug: this.instance.slug },
        bubbles: true,
        composed: true,
      }));
    } catch (err) {
      this._submitError = userMessage(err);
      this._submitting = false;
    }
  }

  private _renderSpinner() {
    return html`
      <div class="spinner-overlay">
        <div class="spinner"></div>
        <div>${msg("Destroying instance...", { id: "did-spinner-deleting" })} <strong>${this.instance?.slug}</strong></div>
      </div>
    `;
  }

  private _renderForm() {
    const inst = this.instance;
    if (!inst) return html``;
    return html`
      <div class="dialog-body">
        <div class="warning-box">
          ${msg("This will permanently stop the service, remove all files (state directory, service unit) and delete the instance from the registry. This action cannot be undone.", { id: "did-warning" })}
        </div>
        <div class="instance-info">
          ${inst.display_name ?? inst.slug} — <strong>${inst.slug}</strong>
        </div>
        <div class="field">
          <label>${msg("Type the instance slug to confirm", { id: "did-confirm-label" })}</label>
          <span class="confirm-hint"><code>${inst.slug}</code></span>
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
        <button class="btn btn-ghost" @click=${this._close}>${msg("Cancel", { id: "btn-cancel" })}</button>
        <button
          class="btn-danger"
          ?disabled=${!this._isConfirmed()}
          @click=${() => void this._submit()}
        >${msg("Destroy", { id: "btn-destroy" })}</button>
      </div>
    `;
  }

  override render() {
    return html`
      <div class="overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._close(); }}>
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">${msg("Delete instance", { id: "did-title" })}</span>
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
    "cp-delete-instance-dialog": DeleteInstanceDialog;
  }
}
