// ui/src/components/blueprints-view.ts
import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { Blueprint } from "../types.js";
import { fetchBlueprints, deleteBlueprint } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";
import "./blueprint-card.js";
import "./create-blueprint-dialog.js";

@localized()
@customElement("cp-blueprints-view")
export class BlueprintsView extends LitElement {
  static override styles = [
    tokenStyles,
    sectionLabelStyles,
    errorBannerStyles,
    buttonStyles,
    css`
      :host {
        display: block;
        padding: 24px;
      }

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 16px;
      }

      .empty {
        text-align: center;
        padding: 60px 20px;
        color: var(--text-muted);
        font-size: 15px;
      }

      .empty-icon {
        font-size: 40px;
        margin-bottom: 12px;
      }

      .empty-hint {
        font-size: 13px;
        color: var(--text-muted);
        margin-top: 6px;
      }

      .loading {
        text-align: center;
        padding: 60px 20px;
        color: var(--text-muted);
        font-size: 14px;
      }

      .error-banner {
        margin-bottom: 20px;
      }
    `,
  ];

  @state() private _blueprints: Blueprint[] = [];
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _showCreateDialog = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  private async _load(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      this._blueprints = await fetchBlueprints();
      this._emitCount();
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private _emitCount(): void {
    this.dispatchEvent(
      new CustomEvent("blueprints-loaded", {
        detail: this._blueprints.length,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onBlueprintClick(e: Event): void {
    const { blueprintId } = (e as CustomEvent<{ blueprintId: number }>).detail;
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "blueprint-builder", blueprintId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async _onBlueprintDelete(e: Event): Promise<void> {
    const { blueprintId } = (e as CustomEvent<{ blueprintId: number }>).detail;
    try {
      await deleteBlueprint(blueprintId);
      this._blueprints = this._blueprints.filter((bp) => bp.id !== blueprintId);
      this._emitCount();
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private _onBlueprintCreated(e: Event): void {
    this._showCreateDialog = false;
    this._blueprints = [...this._blueprints, (e as CustomEvent<Blueprint>).detail];
    this._emitCount();
  }

  override render() {
    if (this._loading) {
      return html`<div class="loading">
        ${msg("Loading blueprints...", { id: "loading-blueprints" })}
      </div>`;
    }

    return html`
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}

      <div class="section-header">
        <div class="section-title">
          ${this._blueprints.length}
          ${this._blueprints.length !== 1
            ? msg("blueprints", { id: "blueprint-count-many" })
            : msg("blueprint", { id: "blueprint-count-one" })}
        </div>
        <button
          class="btn btn-primary"
          @click=${() => {
            this._showCreateDialog = true;
          }}
        >
          ${msg("+ New Blueprint", { id: "bp-btn-create" })}
        </button>
      </div>

      ${this._blueprints.length === 0
        ? html`
            <div class="empty">
              <div class="empty-icon">📋</div>
              <div>${msg("No blueprints yet", { id: "bp-empty" })}</div>
              <div class="empty-hint">
                ${msg("Create your first team blueprint to get started.", { id: "bp-empty-hint" })}
              </div>
            </div>
          `
        : html`
            <div class="grid">
              ${this._blueprints.map(
                (bp) => html`
                  <cp-blueprint-card
                    .blueprint=${bp}
                    @blueprint-click=${this._onBlueprintClick}
                    @blueprint-delete=${this._onBlueprintDelete}
                  ></cp-blueprint-card>
                `,
              )}
            </div>
          `}
      ${this._showCreateDialog
        ? html`
            <cp-create-blueprint-dialog
              @close-dialog=${() => {
                this._showCreateDialog = false;
              }}
              @blueprint-created=${this._onBlueprintCreated}
            ></cp-create-blueprint-dialog>
          `
        : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-blueprints-view": BlueprintsView;
  }
}
