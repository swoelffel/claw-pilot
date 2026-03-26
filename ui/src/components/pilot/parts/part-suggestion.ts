// ui/src/components/pilot/parts/part-suggestion.ts
// Renders follow-up suggestion chips — clickable pills that send a new user message.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tokenStyles } from "../../../styles/tokens.js";

@customElement("cp-pilot-part-suggestion")
export class PilotPartSuggestion extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }
      .suggestions-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 6px 0 2px;
      }
      .suggestion-chip {
        padding: 5px 12px;
        border: 1px solid var(--accent-border);
        border-radius: 16px;
        background: var(--bg-surface);
        color: var(--text-secondary);
        font-size: 12px;
        font-family: var(--font-ui);
        cursor: pointer;
        transition:
          border-color 0.12s,
          background-color 0.12s,
          color 0.12s;
        line-height: 1.4;
      }
      .suggestion-chip:hover {
        border-color: var(--accent);
        background: var(--accent-subtle);
        color: var(--text-primary);
      }
    `,
  ];

  /** JSON-encoded array of suggestion strings */
  @property() content = "[]";

  private get _suggestions(): string[] {
    try {
      const parsed: unknown = JSON.parse(this.content);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
    } catch {
      return [];
    }
  }

  private _onClick(text: string): void {
    this.dispatchEvent(
      new CustomEvent("suggestion-click", {
        detail: { text },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const suggestions = this._suggestions;
    if (suggestions.length === 0) return nothing;

    return html`
      <div class="suggestions-row">
        ${suggestions.map(
          (s) => html`
            <button class="suggestion-chip" @click=${() => this._onClick(s)}>${s}</button>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-suggestion": PilotPartSuggestion;
  }
}
