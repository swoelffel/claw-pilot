// ui/src/components/triggers/cp-trigger-list.ts
//
// Compact row list of triggers — name, kind, flow link, enabled toggle,
// last fired, action menu.

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
      .row {
        display: grid;
        grid-template-columns: auto 1fr auto auto auto;
        gap: 12px;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
      }
      .row:hover {
        background: var(--surface-alt);
      }
      .kind {
        font-family: var(--font-mono);
        font-size: 11px;
        padding: 2px 6px;
        border: 1px solid var(--border);
        border-radius: 3px;
        color: var(--text-secondary);
      }
      .name {
        cursor: pointer;
      }
      .name:hover {
        color: var(--accent);
      }
      .meta {
        font-size: 11px;
        color: var(--text-secondary);
        font-family: var(--font-mono);
      }
      .enabled-pill {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
      }
      .enabled-pill.on {
        background: color-mix(in srgb, var(--state-success) 18%, transparent);
        color: var(--state-success);
      }
      .enabled-pill.off {
        background: var(--surface-alt);
        color: var(--text-secondary);
      }
      .actions {
        display: flex;
        gap: 4px;
      }
    `,
  ];

  @property({ type: Array }) triggers: FlowTrigger[] = [];

  private _emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private async _onToggle(t: FlowTrigger): Promise<void> {
    const updated = await updateTrigger(t.id, { enabled: !t.enabled });
    this._emit("trigger-updated", updated);
  }

  private async _onFire(t: FlowTrigger): Promise<void> {
    await fireTrigger(t.id);
    this._emit("trigger-fired", { id: t.id });
  }

  private async _onDelete(t: FlowTrigger): Promise<void> {
    await deleteTrigger(t.id);
    this._emit("trigger-deleted", { id: t.id });
  }

  override render() {
    if (this.triggers.length === 0) {
      return html`<p>${msg("No triggers yet.", { id: "trigger-list-empty" })}</p>`;
    }
    return html`
      ${this.triggers.map(
        (t) => html`
          <div class="row">
            <span class="kind">${t.kind}</span>
            <div>
              <span class="name" @click=${() => this._emit("trigger-open", { id: t.id })}>
                ${t.name}
              </span>
              <div class="meta">
                ${t.instanceSlug} → flow #${t.flowId}
                ${t.lastFiredAt ? html` · last fired ${t.lastFiredAt}` : ""}
              </div>
            </div>
            <span class="enabled-pill ${t.enabled ? "on" : "off"}">
              ${t.enabled
                ? msg("ON", { id: "trigger-list-on" })
                : msg("OFF", { id: "trigger-list-off" })}
            </span>
            <div class="actions">
              <button class="btn" type="button" @click=${() => this._onToggle(t)}>
                ${t.enabled
                  ? msg("Disable", { id: "trigger-list-disable" })
                  : msg("Enable", { id: "trigger-list-enable" })}
              </button>
              <button class="btn" type="button" @click=${() => this._onFire(t)}>
                ${msg("Fire", { id: "trigger-list-fire" })}
              </button>
              <button
                class="btn"
                type="button"
                @click=${() => this._emit("trigger-open", { id: t.id })}
              >
                ${msg("Detail", { id: "trigger-list-detail" })}
              </button>
              <button class="btn" type="button" @click=${() => this._onDelete(t)}>
                ${msg("Delete", { id: "trigger-list-delete" })}
              </button>
            </div>
          </div>
        `,
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-trigger-list": CpTriggerList;
  }
}
