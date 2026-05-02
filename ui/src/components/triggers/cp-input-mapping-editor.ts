// ui/src/components/triggers/cp-input-mapping-editor.ts
//
// Lit web component — array editor for input mapping rows. Each row is a
// `{ from: <JSONPath> ; to: <flowVar> }` pair. Emits a `change` CustomEvent
// with the latest array on every mutation.

import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles } from "../../styles/shared.js";
import type { InputMappingEntry } from "../../api.js";

@localized()
@customElement("cp-input-mapping-editor")
export class CpInputMappingEditor extends LitElement {
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
        grid-template-columns: 1fr 1fr auto;
        gap: 8px;
        margin-bottom: 6px;
      }
      input {
        font-family: var(--font-mono);
        font-size: 13px;
        padding: 6px 8px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text-primary);
        border-radius: 4px;
      }
      .empty {
        color: var(--text-secondary);
        font-style: italic;
        margin-bottom: 6px;
      }
      .hint {
        color: var(--text-secondary);
        font-size: 12px;
        margin-top: 4px;
      }
      .remove {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--state-error);
        cursor: pointer;
        border-radius: 4px;
        padding: 4px 8px;
      }
      .add {
        margin-top: 4px;
      }
    `,
  ];

  @property({ type: Array }) value: InputMappingEntry[] = [];
  @state() private _rows: InputMappingEntry[] = [];

  override connectedCallback(): void {
    super.connectedCallback();
    this._rows = [...this.value];
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("value")) {
      this._rows = [...this.value];
    }
  }

  private _emit(): void {
    this.dispatchEvent(
      new CustomEvent<InputMappingEntry[]>("change", {
        detail: [...this._rows],
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _add(): void {
    this._rows = [...this._rows, { from: "", to: "" }];
    this._emit();
  }

  private _remove(index: number): void {
    this._rows = this._rows.filter((_, i) => i !== index);
    this._emit();
  }

  private _update(index: number, key: "from" | "to", value: string): void {
    this._rows = this._rows.map((row, i) => (i === index ? { ...row, [key]: value } : row));
    this._emit();
  }

  override render() {
    return html`
      ${this._rows.length === 0
        ? html`<div class="empty">
            ${msg("No mapping defined", { id: "trigger-mapping-empty" })}
          </div>`
        : ""}
      ${this._rows.map(
        (row, i) => html`
          <div class="row">
            <input
              type="text"
              .value=${row.from}
              placeholder="$.path.to.field"
              @input=${(e: Event) => this._update(i, "from", (e.target as HTMLInputElement).value)}
            />
            <input
              type="text"
              .value=${row.to}
              placeholder="flow_var_name"
              @input=${(e: Event) => this._update(i, "to", (e.target as HTMLInputElement).value)}
            />
            <button class="remove" type="button" @click=${() => this._remove(i)}>
              ${msg("Remove", { id: "trigger-mapping-remove" })}
            </button>
          </div>
        `,
      )}
      <button class="btn add" type="button" @click=${this._add}>
        ${msg("Add mapping", { id: "trigger-mapping-add" })}
      </button>
      <div class="hint">
        ${msg("Use JSONPath in the left column, target flow variable on the right.", {
          id: "trigger-mapping-hint",
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-input-mapping-editor": CpInputMappingEditor;
  }
}
