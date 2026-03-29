// ui/src/components/pilot/pilot-filter-bar.ts
// Horizontal bar of toggle chips for filtering timeline entry types.
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { TimelineFilters } from "../../types.js";
import { tokenStyles } from "../../styles/tokens.js";

interface FilterChip {
  key: keyof TimelineFilters;
  icon: string;
  label: () => string;
}

const CHIPS: FilterChip[] = [
  { key: "chat", icon: "\u{1F4AC}", label: () => msg("Chat", { id: "pilot-filter-chat" }) },
  { key: "a2a", icon: "\u2B21", label: () => msg("A2A", { id: "pilot-filter-a2a" }) },
  { key: "tools", icon: "\u{1F6E0}", label: () => msg("Tools", { id: "pilot-filter-tools" }) },
  {
    key: "thinking",
    icon: "\u{1F9E0}",
    label: () => msg("Think", { id: "pilot-filter-thinking" }),
  },
  {
    key: "subtasks",
    icon: "\u{1F4E6}",
    label: () => msg("Sub", { id: "pilot-filter-subtasks" }),
  },
  {
    key: "suggestions",
    icon: "\u2728",
    label: () => msg("Suggest", { id: "pilot-filter-suggestions" }),
  },
];

@localized()
@customElement("cp-pilot-filter-bar")
export class PilotFilterBar extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        flex-shrink: 0;
        border-bottom: 1px solid var(--bg-border);
      }

      .bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 16px;
        overflow-x: auto;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 10px;
        border-radius: 100px;
        font-size: 11px;
        font-family: var(--font-ui);
        cursor: pointer;
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-muted);
        white-space: nowrap;
        transition:
          background 0.12s,
          color 0.12s,
          border-color 0.12s;
        user-select: none;
      }

      .chip:hover {
        border-color: var(--text-muted);
      }

      .chip.active {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
      }

      .chip.active:hover {
        opacity: 0.9;
        border-color: var(--accent);
      }

      .chip-icon {
        font-size: 12px;
        line-height: 1;
      }
    `,
  ];

  @property({ type: Object }) filters!: TimelineFilters;

  private _toggle(key: keyof TimelineFilters): void {
    const updated = { ...this.filters, [key]: !this.filters[key] };
    this.dispatchEvent(
      new CustomEvent("filter-change", {
        detail: updated,
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="bar">
        ${CHIPS.map(
          (chip) => html`
            <button
              class="chip ${this.filters[chip.key] ? "active" : ""}"
              @click=${() => this._toggle(chip.key)}
            >
              <span class="chip-icon">${chip.icon}</span>
              ${chip.label()}
            </button>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-filter-bar": PilotFilterBar;
  }
}
