// ui/src/components/workspace-file-dialogs.ts
//
// Two small dialogs for workspace file management:
//   <cp-new-file-dialog>     — path + optional content, emits file-created
//   <cp-delete-file-dialog>  — confirmation, emits file-delete-confirmed
//
// Both close themselves on success (success event is re-dispatched by the
// parent, which is responsible for calling the API and refreshing the tree).
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { DialogMixin } from "../lib/dialog-mixin.js";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, errorBannerStyles } from "../styles/shared.js";

const sharedDialogStyles = css`
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
    display: flex;
    flex-direction: column;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--bg-border);
  }

  .dialog-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 18px;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .dialog-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--bg-border);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  input[type="text"],
  textarea {
    background: var(--bg-base);
    border: 1px solid var(--bg-border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 13px;
    padding: 8px 10px;
    outline: none;
  }

  input[type="text"]:focus,
  textarea:focus {
    border-color: var(--accent);
  }

  textarea {
    min-height: 160px;
    resize: vertical;
  }

  .hint {
    font-size: 11px;
    color: var(--text-muted);
  }

  .btn-danger {
    background: var(--state-error, #ef4444);
    border: 1px solid var(--state-error, #ef4444);
    color: white;
    border-radius: var(--radius-md);
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-danger:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

// ---------------------------------------------------------------------------
// New file dialog
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-new-file-dialog")
export class NewFileDialog extends DialogMixin(LitElement) {
  static override styles = [tokenStyles, buttonStyles, errorBannerStyles, sharedDialogStyles];

  /** Initial directory prefix (e.g. `memory` → field prefilled with `memory/`). */
  @property({ type: String }) parentDir = "";

  @state() private _path = "";
  @state() private _content = "";
  @state() private _error = "";
  @state() private _submitting = false;

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("parentDir")) {
      this._path = this.parentDir ? `${this.parentDir}/` : "";
    }
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private _validateClient(path: string): string | null {
    if (!path) return "Path is required";
    if (path.endsWith("/")) return "Path must include a filename";
    if (path.startsWith("/")) return "Path must be relative";
    if (path.includes("..")) return "Path traversal is not allowed";
    if (!/\.[A-Za-z0-9]+$/.test(path)) return "File must have an extension";
    return null;
  }

  private _submit(): void {
    const err = this._validateClient(this._path.trim());
    if (err) {
      this._error = err;
      return;
    }
    this._submitting = true;
    this._error = "";
    this.dispatchEvent(
      new CustomEvent("file-new-confirmed", {
        detail: { path: this._path.trim(), content: this._content },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Called by parent after the API call fails so the dialog can show the error. */
  showError(message: string): void {
    this._error = message;
    this._submitting = false;
  }

  override render() {
    return html`
      <div
        class="overlay"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._close();
        }}
      >
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">${msg("New workspace file", { id: "nfd-title" })}</span>
            <button class="close-btn" @click=${this._close}>✕</button>
          </div>
          <div class="dialog-body">
            <div class="field">
              <label>${msg("Path", { id: "nfd-path" })}</label>
              <input
                type="text"
                .value=${this._path}
                placeholder="notes.md or memory/new.md"
                @input=${(e: Event) => {
                  this._path = (e.target as HTMLInputElement).value;
                }}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") this._submit();
                }}
                autofocus
              />
              <span class="hint">
                ${msg("Allowed extensions: .md, .txt, .json, .yaml, .yml, .csv, .log", {
                  id: "nfd-hint",
                })}
              </span>
            </div>
            <div class="field">
              <label>${msg("Initial content (optional)", { id: "nfd-content" })}</label>
              <textarea
                .value=${this._content}
                @input=${(e: Event) => {
                  this._content = (e.target as HTMLTextAreaElement).value;
                }}
              ></textarea>
            </div>
            ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" @click=${this._close} ?disabled=${this._submitting}>
              ${msg("Cancel", { id: "nfd-cancel" })}
            </button>
            <button class="btn btn-primary" @click=${this._submit} ?disabled=${this._submitting}>
              ${msg("Create", { id: "nfd-create" })}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------
// Delete file confirmation dialog
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-delete-file-dialog")
export class DeleteFileDialog extends DialogMixin(LitElement) {
  static override styles = [tokenStyles, buttonStyles, errorBannerStyles, sharedDialogStyles];

  @property({ type: String }) filePath = "";

  @state() private _submitting = false;
  @state() private _error = "";

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private _submit(): void {
    this._submitting = true;
    this._error = "";
    this.dispatchEvent(
      new CustomEvent("file-delete-confirmed", {
        detail: { path: this.filePath },
        bubbles: true,
        composed: true,
      }),
    );
  }

  showError(message: string): void {
    this._error = message;
    this._submitting = false;
  }

  override render() {
    return html`
      <div
        class="overlay"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._close();
        }}
      >
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">${msg("Delete workspace file?", { id: "dfd-title" })}</span>
            <button class="close-btn" @click=${this._close}>✕</button>
          </div>
          <div class="dialog-body">
            <p>
              ${msg("This will permanently delete", { id: "dfd-body-prefix" })}
              <code style="font-family: var(--font-mono); font-weight: 600">${this.filePath}</code>
              ${msg("from the agent workspace.", { id: "dfd-body-suffix" })}
            </p>
            ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" @click=${this._close} ?disabled=${this._submitting}>
              ${msg("Cancel", { id: "dfd-cancel" })}
            </button>
            <button class="btn-danger" @click=${this._submit} ?disabled=${this._submitting}>
              ${msg("Delete", { id: "dfd-delete" })}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-new-file-dialog": NewFileDialog;
    "cp-delete-file-dialog": DeleteFileDialog;
  }
}
