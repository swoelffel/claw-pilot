// ui/src/components/create-blueprint-dialog.ts
import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { Blueprint } from "../types.js";
import { createBlueprint } from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { spinnerStyles, errorBannerStyles } from "../styles/shared.js";

const PRESET_COLORS = [
  "#4f6ef7", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#ec4899",
];

@localized()
@customElement("cp-create-blueprint-dialog")
export class CreateBlueprintDialog extends LitElement {
  static styles = [tokenStyles, spinnerStyles, errorBannerStyles, css`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 500;
    }

    .dialog {
      background: var(--bg-surface);
      border: 1px solid var(--bg-border);
      border-radius: 12px;
      padding: 28px;
      width: 480px;
      max-width: calc(100vw - 32px);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    }

    .dialog-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0 0 20px 0;
    }

    .form-group {
      margin-bottom: 16px;
    }

    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }

    input, textarea {
      width: 100%;
      background: var(--bg-base);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 13px;
      font-family: inherit;
      padding: 8px 12px;
      box-sizing: border-box;
      transition: border-color 0.15s;
      outline: none;
    }

    input:focus, textarea:focus {
      border-color: var(--accent);
    }

    textarea {
      resize: vertical;
      min-height: 72px;
    }

    .color-picker {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .color-swatch {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform 0.1s, border-color 0.1s;
    }

    .color-swatch:hover {
      transform: scale(1.15);
    }

    .color-swatch.selected {
      border-color: var(--text-primary);
      transform: scale(1.1);
    }

    .color-swatch.none {
      background: var(--bg-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: var(--text-muted);
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 24px;
    }

    .btn-cancel {
      background: none;
      border: 1px solid var(--bg-border);
      color: var(--text-secondary);
      border-radius: var(--radius-md);
      padding: 8px 18px;
      font-size: 13px;
      cursor: pointer;
      font-family: inherit;
      transition: border-color 0.15s;
    }

    .btn-cancel:hover {
      border-color: var(--accent-border);
    }

    .btn-create {
      background: var(--accent);
      border: none;
      color: white;
      border-radius: var(--radius-md);
      padding: 8px 20px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity 0.15s;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-create:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error-banner {
      margin-bottom: 16px;
    }
  `];

  @state() private _name = "";
  @state() private _description = "";
  @state() private _icon = "";
  @state() private _tags = "";
  @state() private _color = "";
  @state() private _creating = false;
  @state() private _error = "";

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private async _submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!this._name.trim()) return;

    this._creating = true;
    this._error = "";
    try {
      const blueprint = await createBlueprint({
        name: this._name.trim(),
        description: this._description.trim() || undefined,
        icon: this._icon.trim() || undefined,
        tags: this._tags.trim() || undefined,
        color: this._color || undefined,
      });
      this.dispatchEvent(new CustomEvent<Blueprint>("blueprint-created", {
        detail: blueprint,
        bubbles: true,
        composed: true,
      }));
      this._close();
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to create blueprint";
    } finally {
      this._creating = false;
    }
  }

  override render() {
    return html`
      <div class="overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._close(); }}>
        <div class="dialog">
          <h2 class="dialog-title">${msg("New Blueprint", { id: "cbd-title" })}</h2>

          ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}

          <form @submit=${this._submit}>
            <div class="form-group">
              <label>${msg("Name", { id: "cbd-name" })} *</label>
              <input
                type="text"
                .value=${this._name}
                @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}
                placeholder=${msg("e.g. HR Team, Dev Squad", { id: "cbd-name-placeholder" })}
                required
                autofocus
              />
            </div>

            <div class="form-group">
              <label>${msg("Description", { id: "cbd-description" })}</label>
              <textarea
                .value=${this._description}
                @input=${(e: Event) => { this._description = (e.target as HTMLTextAreaElement).value; }}
                placeholder=${msg("What this team does...", { id: "cbd-description-placeholder" })}
              ></textarea>
            </div>

            <div class="form-group">
              <label>${msg("Icon", { id: "cbd-icon" })}</label>
              <input
                type="text"
                .value=${this._icon}
                @input=${(e: Event) => { this._icon = (e.target as HTMLInputElement).value; }}
                placeholder=${msg("Emoji or icon name", { id: "cbd-icon-placeholder" })}
              />
            </div>

            <div class="form-group">
              <label>${msg("Tags", { id: "cbd-tags" })}</label>
              <input
                type="text"
                .value=${this._tags}
                @input=${(e: Event) => { this._tags = (e.target as HTMLInputElement).value; }}
                placeholder=${msg("Comma-separated, e.g. hr, legal", { id: "cbd-tags-placeholder" })}
              />
            </div>

            <div class="form-group">
              <label>${msg("Color", { id: "cbd-color" })}</label>
              <div class="color-picker">
                <div
                  class="color-swatch none ${this._color === "" ? "selected" : ""}"
                  title="No color"
                  @click=${() => { this._color = ""; }}
                >✕</div>
                ${PRESET_COLORS.map(c => html`
                  <div
                    class="color-swatch ${this._color === c ? "selected" : ""}"
                    style="background: ${c}"
                    title="${c}"
                    @click=${() => { this._color = c; }}
                  ></div>
                `)}
              </div>
            </div>

            <div class="dialog-actions">
              <button type="button" class="btn-cancel" @click=${this._close}>
                ${msg("Cancel", { id: "cbd-btn-cancel" })}
              </button>
              <button type="submit" class="btn-create" ?disabled=${this._creating || !this._name.trim()}>
                ${this._creating ? html`<div class="spinner"></div>` : ""}
                ${this._creating
                  ? msg("Creating...", { id: "cbd-btn-creating" })
                  : msg("Create", { id: "cbd-btn-create" })}
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-create-blueprint-dialog": CreateBlueprintDialog;
  }
}
