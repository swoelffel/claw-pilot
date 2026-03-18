// ui/src/components/agent-templates-view.ts
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBlueprintInfo } from "../types.js";
import {
  fetchAgentBlueprints,
  deleteAgentBlueprint,
  cloneAgentBlueprint,
  createAgentBlueprint,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-agent-templates-view")
export class AgentTemplatesView extends LitElement {
  static override styles = [
    tokenStyles,
    sectionLabelStyles,
    errorBannerStyles,
    buttonStyles,
    css`
      :host {
        display: block;
        padding: 16px;
      }

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
        gap: 12px;
        flex-wrap: wrap;
      }

      @media (max-width: 640px) {
        :host {
          padding: 12px;
        }

        .section-header {
          flex-direction: column;
          align-items: flex-start;
        }

        .section-header button {
          width: 100%;
        }
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
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

      /* --- Card styles --- */

      .card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 16px;
        cursor: pointer;
        transition:
          border-color 0.15s,
          box-shadow 0.15s;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .card:hover {
        border-color: var(--accent-border);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }

      .card-name {
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.01em;
      }

      .card-description {
        font-size: 13px;
        color: var(--text-muted);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .card-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: auto;
      }

      .category-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .category-badge.user {
        background: var(--accent-subtle);
        color: var(--accent);
        border: 1px solid var(--accent-border);
      }

      .category-badge.tool {
        background: rgba(245, 158, 11, 0.08);
        color: var(--state-warning);
        border: 1px solid rgba(245, 158, 11, 0.25);
      }

      .category-badge.system {
        background: rgba(100, 116, 139, 0.08);
        color: var(--state-stopped);
        border: 1px solid rgba(100, 116, 139, 0.25);
      }

      .file-count {
        font-size: 12px;
        color: var(--text-muted);
      }

      .card-date {
        font-size: 11px;
        color: var(--text-muted);
        margin-left: auto;
      }

      .card-actions {
        display: flex;
        gap: 6px;
        margin-top: 8px;
        border-top: 1px solid var(--bg-border);
        padding-top: 10px;
      }

      .btn-card {
        flex: none;
        padding: 4px 10px;
        border-radius: var(--radius-sm);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        transition:
          color 0.15s,
          border-color 0.15s,
          background 0.15s;
        font-family: var(--font-ui);
      }

      .btn-card:hover {
        color: var(--text-primary);
        border-color: var(--accent);
      }

      .btn-card.delete:hover {
        color: var(--state-error);
        border-color: color-mix(in srgb, var(--state-error) 30%, transparent);
        background: color-mix(in srgb, var(--state-error) 8%, transparent);
      }

      .btn-card.open {
        margin-left: auto;
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
      }

      .btn-card.open:hover {
        background: var(--accent-hover);
        border-color: var(--accent-hover);
      }
    `,
  ];

  @state() private _blueprints: AgentBlueprintInfo[] = [];
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
      this._blueprints = await fetchAgentBlueprints();
      this._emitCount();
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private _emitCount(): void {
    this.dispatchEvent(
      new CustomEvent("agent-templates-loaded", {
        detail: { count: this._blueprints.length },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _navigateToDetail(templateId: string): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "agent-template-detail", templateId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onCardClick(templateId: string): void {
    this._navigateToDetail(templateId);
  }

  private async _onClone(e: Event, bp: AgentBlueprintInfo): Promise<void> {
    e.stopPropagation();
    try {
      const cloned = await cloneAgentBlueprint(bp.id);
      this._blueprints = [...this._blueprints, cloned];
      this._emitCount();
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private async _onDelete(e: Event, bp: AgentBlueprintInfo): Promise<void> {
    e.stopPropagation();
    try {
      await deleteAgentBlueprint(bp.id);
      this._blueprints = this._blueprints.filter((b) => b.id !== bp.id);
      this._emitCount();
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private _onOpen(e: Event, templateId: string): void {
    e.stopPropagation();
    this._navigateToDetail(templateId);
  }

  private _formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return msg("Today", { id: "atv-date-today" });
      if (diffDays === 1) return msg("Yesterday", { id: "atv-date-yesterday" });
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toISOString().slice(0, 10);
    } catch {
      return iso;
    }
  }

  override render() {
    if (this._loading) {
      return html`<div class="loading">
        ${msg("Loading agent templates...", { id: "atv-loading" })}
      </div>`;
    }

    return html`
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}

      <div class="section-header">
        <div class="section-title">
          ${this._blueprints.length}
          ${this._blueprints.length !== 1
            ? msg("agent templates", { id: "atv-count-many" })
            : msg("agent template", { id: "atv-count-one" })}
        </div>
        <button
          class="btn btn-primary"
          @click=${() => {
            this._showCreateDialog = true;
          }}
        >
          ${msg("+ New template", { id: "atv-btn-create" })}
        </button>
      </div>

      ${this._blueprints.length === 0
        ? html`
            <div class="empty">
              <div class="empty-icon">🧩</div>
              <div>${msg("No agent templates yet", { id: "atv-empty" })}</div>
              <div class="empty-hint">
                ${msg("Create your first reusable agent template to get started.", {
                  id: "atv-empty-hint",
                })}
              </div>
            </div>
          `
        : html` <div class="grid">${this._blueprints.map((bp) => this._renderCard(bp))}</div> `}
    `;
  }

  private _renderCard(bp: AgentBlueprintInfo) {
    const fileCount = bp.file_count ?? bp.files?.length ?? 0;

    return html`
      <div class="card" @click=${() => this._onCardClick(bp.id)}>
        <div class="card-header">
          <span class="card-name">${bp.name}</span>
        </div>

        ${bp.description ? html`<div class="card-description">${bp.description}</div>` : nothing}

        <div class="card-meta">
          <span class="category-badge ${bp.category}">${bp.category}</span>
          <span class="file-count">
            ${fileCount}
            ${fileCount !== 1
              ? msg("files", { id: "atv-card-files-many" })
              : msg("file", { id: "atv-card-file-one" })}
          </span>
          <span class="card-date">${this._formatDate(bp.created_at)}</span>
        </div>

        <div class="card-actions">
          <button
            class="btn-card"
            @click=${(e: Event) => this._onClone(e, bp)}
            title=${msg("Clone", { id: "atv-btn-clone" })}
          >
            ${msg("Clone", { id: "atv-btn-clone" })}
          </button>
          <button
            class="btn-card delete"
            @click=${(e: Event) => this._onDelete(e, bp)}
            title=${msg("Delete", { id: "atv-btn-delete" })}
          >
            ${msg("Delete", { id: "atv-btn-delete" })}
          </button>
          <button
            class="btn-card open"
            @click=${(e: Event) => this._onOpen(e, bp.id)}
            title=${msg("Open", { id: "atv-btn-open" })}
          >
            ${msg("Open", { id: "atv-btn-open" })}
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-templates-view": AgentTemplatesView;
  }
}
