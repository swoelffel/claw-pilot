// ui/src/components/blueprint-card.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { Blueprint } from "../types.js";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-blueprint-card")
export class BlueprintCard extends LitElement {
  static styles = [tokenStyles, buttonStyles, css`
    :host {
      display: block;
    }

    .card {
      background: var(--bg-surface);
      border: 1px solid var(--bg-border);
      border-radius: 10px;
      padding: 20px;
      cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s;
      position: relative;
      overflow: hidden;
    }

    .card:hover {
      border-color: var(--accent-border);
      box-shadow: 0 0 0 1px var(--accent-border);
    }

    .card-accent {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      border-radius: 10px 0 0 10px;
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    .card-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-icon {
      font-size: 20px;
      line-height: 1;
    }

    .card-name {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }

    .card-description {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 12px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .agent-count {
      font-size: 12px;
      color: var(--text-muted);
    }

    .tags {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }

    .tag {
      background: var(--accent-subtle);
      color: var(--accent);
      border: 1px solid var(--accent-border);
      border-radius: 20px;
      padding: 1px 8px;
      font-size: 11px;
      font-weight: 500;
    }

    .btn-delete-x {
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

    .btn-delete-x:hover {
      color: var(--state-error);
      border-color: color-mix(in srgb, var(--state-error) 30%, transparent);
      background: color-mix(in srgb, var(--state-error) 8%, transparent);
    }

    .confirm-delete {
      margin-top: 12px;
      padding: 10px 12px;
      background: color-mix(in srgb, var(--state-error, #ef4444) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--state-error, #ef4444) 30%, transparent);
      border-radius: var(--radius-md);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .confirm-delete p {
      margin: 0 0 8px 0;
    }

    .confirm-actions {
      display: flex;
      gap: 8px;
    }

    .btn-confirm-delete {
      background: var(--state-error, #ef4444);
      border: none;
      color: white;
      border-radius: var(--radius-sm);
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }

    .btn-cancel-delete {
      background: none;
      border: 1px solid var(--bg-border);
      color: var(--text-secondary);
      border-radius: var(--radius-sm);
      padding: 4px 12px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }
  `];

  @property({ type: Object }) blueprint!: Blueprint;

  @state() private _confirmDelete = false;

  private _onClick(e: Event): void {
    // Don't navigate if clicking delete area
    if ((e.target as Element).closest(".btn-delete-x, .confirm-delete")) return;
    this.dispatchEvent(new CustomEvent("blueprint-click", {
      detail: { blueprintId: this.blueprint.id },
      bubbles: true,
      composed: true,
    }));
  }

  private _onDeleteClick(e: Event): void {
    e.stopPropagation();
    this._confirmDelete = true;
  }

  private _onCancelDelete(e: Event): void {
    e.stopPropagation();
    this._confirmDelete = false;
  }

  private _onConfirmDelete(e: Event): void {
    e.stopPropagation();
    this._confirmDelete = false;
    this.dispatchEvent(new CustomEvent("blueprint-delete", {
      detail: { blueprintId: this.blueprint.id },
      bubbles: true,
      composed: true,
    }));
  }

  override render() {
    const bp = this.blueprint;
    const tags = bp.tags ? (JSON.parse(bp.tags) as string[]) : [];
    const agentCount = bp.agent_count ?? 0;

    return html`
      <div class="card" @click=${this._onClick}>
        ${bp.color ? html`<div class="card-accent" style="background: ${bp.color}"></div>` : ""}
        <div class="card-header">
          <div class="card-title-row">
            ${bp.icon ? html`<span class="card-icon">${bp.icon}</span>` : ""}
            <span class="card-name">${bp.name}</span>
          </div>
          <button
            class="btn-delete-x"
            aria-label=${msg("Delete", { id: "bp-btn-delete" })}
            @click=${this._onDeleteClick}
          >✕</button>
        </div>

        ${bp.description ? html`
          <div class="card-description">${bp.description}</div>
        ` : ""}

        <div class="card-meta">
          <span class="agent-count">
            ${agentCount === 0
              ? msg("No agents", { id: "bp-card-no-agents" })
              : msg(html`${agentCount} agents`, { id: "bp-card-agents" })}
          </span>
          ${tags.length > 0 ? html`
            <div class="tags">
              ${tags.map(tag => html`<span class="tag">${tag}</span>`)}
            </div>
          ` : ""}
        </div>

        ${this._confirmDelete ? html`
          <div class="confirm-delete" @click=${(e: Event) => e.stopPropagation()}>
            <p>${msg(html`Delete blueprint "${bp.name}"?`, { id: "bp-confirm-delete" })}</p>
            <p style="color: var(--text-muted); font-size: 11px; margin: 0 0 8px 0;">
              ${msg("This will permanently delete the blueprint and all its agents.", { id: "bp-confirm-delete-hint" })}
            </p>
            <div class="confirm-actions">
              <button class="btn-confirm-delete" @click=${this._onConfirmDelete}>
                ${msg("Delete", { id: "bp-btn-delete" })}
              </button>
              <button class="btn-cancel-delete" @click=${this._onCancelDelete}>
                ${msg("Cancel", { id: "cbd-btn-cancel" })}
              </button>
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-blueprint-card": BlueprintCard;
  }
}
