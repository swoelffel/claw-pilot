// ui/src/components/triggers/cp-trigger-list.ts
//
// Compact row list of triggers — name, kind, flow link, enabled toggle,
// last fired, action menu. Visual rhythm mirrors `cp-flow-list`.

import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles } from "../../styles/shared.js";
import { deleteTrigger, fireTrigger, updateTrigger, type FlowTrigger } from "../../api.js";

@localized()
@customElement("cp-trigger-list")
export class CpTriggerList extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    css`
      :host {
        display: block;
        font-family: var(--font-ui);
      }
      .trigger-table {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .trigger-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        transition: border-color 0.15s;
      }
      .trigger-row:hover {
        border-color: var(--accent-border);
      }
      .kind {
        font-family: var(--font-mono);
        font-size: 11px;
        padding: 2px 8px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        background: var(--bg-base);
        color: var(--text-secondary);
        flex-shrink: 0;
      }
      .trigger-info {
        flex: 1;
        min-width: 0;
      }
      .trigger-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .trigger-name:hover {
        color: var(--accent);
      }
      .trigger-meta {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 2px;
        font-family: var(--font-mono);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Toggle switch — copied from flow-list canonical */
      .trigger-toggle {
        flex-shrink: 0;
      }
      .toggle-switch {
        position: relative;
        display: inline-block;
        width: 36px;
        height: 20px;
        cursor: pointer;
      }
      .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .toggle-slider {
        position: absolute;
        inset: 0;
        background: var(--bg-border);
        border-radius: 10px;
        transition: background 0.2s;
      }
      .toggle-slider::before {
        content: "";
        position: absolute;
        width: 14px;
        height: 14px;
        left: 3px;
        bottom: 3px;
        background: var(--text-secondary);
        border-radius: 50%;
        transition:
          transform 0.2s,
          background 0.2s;
      }
      .toggle-switch input:checked + .toggle-slider {
        background: var(--accent);
      }
      .toggle-switch input:checked + .toggle-slider::before {
        transform: translateX(16px);
        background: #fff;
      }

      /* Action buttons — tinted matrix from flow-list */
      .actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
      .btn-action {
        padding: 4px 10px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-border);
        background: transparent;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        font-family: var(--font-ui);
        transition:
          background 0.15s,
          border-color 0.15s,
          color 0.15s;
      }
      .btn-fire {
        color: var(--state-running);
        border-color: rgba(16, 185, 129, 0.25);
      }
      .btn-fire:hover:not(:disabled) {
        background: rgba(16, 185, 129, 0.1);
      }
      .btn-detail {
        color: var(--accent);
        border-color: var(--accent-border);
      }
      .btn-detail:hover {
        background: var(--accent-subtle);
      }
      .btn-delete {
        color: var(--state-error);
        border-color: rgba(239, 68, 68, 0.25);
      }
      .btn-delete:hover {
        background: rgba(239, 68, 68, 0.1);
      }

      /* Empty state */
      .empty {
        text-align: center;
        padding: 60px 20px;
        color: var(--text-muted);
      }
      .empty-icon {
        font-size: 32px;
        margin-bottom: 12px;
      }
      .empty-headline {
        font-size: 14px;
        color: var(--text-secondary);
        margin-bottom: 6px;
      }
      .empty-hint {
        font-size: 12px;
        color: var(--text-muted);
      }
    `,
  ];

  @property({ type: String }) instanceSlug = "";
  @property({ type: Array }) triggers: FlowTrigger[] = [];

  private _emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private async _onToggle(t: FlowTrigger): Promise<void> {
    const updated = await updateTrigger(this.instanceSlug || t.instanceSlug, t.id, {
      enabled: !t.enabled,
    });
    this._emit("trigger-updated", updated);
  }

  private async _onFire(t: FlowTrigger): Promise<void> {
    await fireTrigger(this.instanceSlug || t.instanceSlug, t.id);
    this._emit("trigger-fired", { id: t.id });
  }

  private async _onDelete(t: FlowTrigger): Promise<void> {
    if (!window.confirm(`Delete trigger '${t.name}'? This cannot be undone.`)) return;
    await deleteTrigger(this.instanceSlug || t.instanceSlug, t.id);
    this._emit("trigger-deleted", { id: t.id });
  }

  override render() {
    if (this.triggers.length === 0) {
      return html`
        <div class="empty">
          <div class="empty-icon">⏰</div>
          <div class="empty-headline">${msg("No triggers yet.", { id: "trigger-list-empty" })}</div>
          <div class="empty-hint">
            ${msg("Schedule a flow to run automatically on a cron expression.", {
              id: "trigger-list-empty-hint",
            })}
          </div>
        </div>
      `;
    }
    return html`
      <div class="trigger-table">
        ${this.triggers.map(
          (t) => html`
            <div class="trigger-row">
              <span class="kind">${t.kind}</span>
              <div class="trigger-info">
                <div class="trigger-name" @click=${() => this._emit("trigger-open", { id: t.id })}>
                  ${t.name}
                </div>
                <div class="trigger-meta">
                  ${t.instanceSlug} → flow #${t.flowId}
                  ${t.lastFiredAt ? html` · last fired ${t.lastFiredAt}` : ""}
                </div>
              </div>
              <div class="trigger-toggle">
                <label
                  class="toggle-switch"
                  aria-label=${t.enabled
                    ? msg("Disable", { id: "trigger-list-disable" })
                    : msg("Enable", { id: "trigger-list-enable" })}
                >
                  <input
                    type="checkbox"
                    .checked=${t.enabled}
                    @change=${() => void this._onToggle(t)}
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="actions">
                <button
                  class="btn-action btn-fire"
                  type="button"
                  @click=${() => void this._onFire(t)}
                >
                  ${msg("Fire", { id: "trigger-list-fire" })}
                </button>
                <button
                  class="btn-action btn-detail"
                  type="button"
                  @click=${() => this._emit("trigger-open", { id: t.id })}
                >
                  ${msg("Detail", { id: "trigger-list-detail" })}
                </button>
                <button
                  class="btn-action btn-delete"
                  type="button"
                  @click=${() => void this._onDelete(t)}
                >
                  ${msg("Delete", { id: "trigger-list-delete" })}
                </button>
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-trigger-list": CpTriggerList;
  }
}
