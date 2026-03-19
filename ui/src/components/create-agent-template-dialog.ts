// ui/src/components/create-agent-template-dialog.ts
//
// Modal dialog for creating a new agent blueprint (template) from scratch.
// Fields: name (required), description, category, seedFiles toggle.

import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBlueprintInfo } from "../types.js";
import { createAgentBlueprint } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { spinnerStyles, errorBannerStyles } from "../styles/shared.js";

@localized()
@customElement("cp-create-agent-template-dialog")
export class CreateAgentTemplateDialog extends LitElement {
  static override styles = [
    tokenStyles,
    spinnerStyles,
    errorBannerStyles,
    css`
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

      input,
      textarea,
      select {
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

      input:focus,
      textarea:focus,
      select:focus {
        border-color: var(--accent);
      }

      textarea {
        resize: vertical;
        min-height: 72px;
      }

      .checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .checkbox-row input[type="checkbox"] {
        width: auto;
        accent-color: var(--accent);
      }

      .checkbox-row label {
        text-transform: none;
        font-weight: 400;
        font-size: 13px;
        color: var(--text-primary);
        margin-bottom: 0;
      }

      .checkbox-hint {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 4px;
        margin-left: 24px;
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
    `,
  ];

  @state() private _name = "";
  @state() private _description = "";
  @state() private _category: "user" | "tool" | "system" = "user";
  @state() private _seedFiles = true;
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
      const blueprint = await createAgentBlueprint({
        name: this._name.trim(),
        ...(this._description.trim() ? { description: this._description.trim() } : {}),
        ...(this._category !== "user" ? { category: this._category } : {}),
        seedFiles: this._seedFiles,
      });
      this.dispatchEvent(
        new CustomEvent<AgentBlueprintInfo>("agent-template-created", {
          detail: blueprint,
          bubbles: true,
          composed: true,
        }),
      );
      this._close();
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._creating = false;
    }
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
          <h2 class="dialog-title">${msg("New Agent Template", { id: "catd-title" })}</h2>

          ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}

          <form @submit=${this._submit}>
            <div class="form-group">
              <label>${msg("Name", { id: "catd-name" })} *</label>
              <input
                type="text"
                .value=${this._name}
                @input=${(e: Event) => {
                  this._name = (e.target as HTMLInputElement).value;
                }}
                placeholder=${msg("e.g. Code Reviewer, QA Engineer", {
                  id: "catd-name-placeholder",
                })}
                required
                autofocus
              />
            </div>

            <div class="form-group">
              <label>${msg("Description", { id: "catd-description" })}</label>
              <textarea
                .value=${this._description}
                @input=${(e: Event) => {
                  this._description = (e.target as HTMLTextAreaElement).value;
                }}
                placeholder=${msg("What this agent template is for...", {
                  id: "catd-description-placeholder",
                })}
              ></textarea>
            </div>

            <div class="form-group">
              <label>${msg("Category", { id: "catd-category" })}</label>
              <select
                .value=${this._category}
                @change=${(e: Event) => {
                  this._category = (e.target as HTMLSelectElement).value as
                    | "user"
                    | "tool"
                    | "system";
                }}
              >
                <option value="user">${msg("User", { id: "catd-cat-user" })}</option>
                <option value="tool">${msg("Tool", { id: "catd-cat-tool" })}</option>
                <option value="system">${msg("System", { id: "catd-cat-system" })}</option>
              </select>
            </div>

            <div class="form-group">
              <div class="checkbox-row">
                <input
                  type="checkbox"
                  id="seed-files"
                  .checked=${this._seedFiles}
                  @change=${(e: Event) => {
                    this._seedFiles = (e.target as HTMLInputElement).checked;
                  }}
                />
                <label for="seed-files">
                  ${msg("Seed default workspace files", { id: "catd-seed-files" })}
                </label>
              </div>
              <div class="checkbox-hint">
                ${msg("Creates SOUL.md, AGENTS.md, TOOLS.md, BOOTSTRAP.md, USER.md, HEARTBEAT.md", {
                  id: "catd-seed-files-hint",
                })}
              </div>
            </div>

            <div class="dialog-actions">
              <button type="button" class="btn-cancel" @click=${this._close}>
                ${msg("Cancel", { id: "catd-btn-cancel" })}
              </button>
              <button
                type="submit"
                class="btn-create"
                ?disabled=${this._creating || !this._name.trim()}
              >
                ${this._creating ? html`<div class="spinner"></div>` : ""}
                ${this._creating
                  ? msg("Creating...", { id: "catd-btn-creating" })
                  : msg("Create", { id: "catd-btn-create" })}
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
    "cp-create-agent-template-dialog": CreateAgentTemplateDialog;
  }
}
