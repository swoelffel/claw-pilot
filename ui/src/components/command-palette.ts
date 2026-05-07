// ui/src/components/command-palette.ts
//
// Global command palette (Cmd+K / Ctrl+K) — full-text search across all entities.

import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { DialogMixin } from "../lib/dialog-mixin.js";
import { searchEntities } from "../api.js";
import { navigateToPath } from "../services/navigation.js";
import type { SearchResult } from "../types.js";

const GROUP_ORDER: string[] = ["instance", "agent", "task", "blueprint", "agent_blueprint"];
const MAX_PER_GROUP = 5;

/** Group label for each entity type. */
function groupLabel(type: string): string {
  switch (type) {
    case "instance":
      return msg("Instances", { id: "search-group-instances" });
    case "agent":
      return msg("Agents", { id: "search-group-agents" });
    case "task":
      return msg("Tasks", { id: "search-group-tasks" });
    case "blueprint":
      return msg("Blueprints", { id: "search-group-blueprints" });
    case "agent_blueprint":
      return msg("Templates", { id: "search-group-templates" });
    default:
      return type;
  }
}

interface GroupedResults {
  type: string;
  label: string;
  items: SearchResult[];
}

@localized()
@customElement("cp-command-palette")
export class CpCommandPalette extends DialogMixin(LitElement) {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        z-index: 200;
        display: flex;
        justify-content: center;
        align-items: flex-start;
      }

      .palette {
        margin-top: 80px;
        width: 100%;
        max-width: 560px;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg, 12px);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        max-height: 420px;
      }

      .palette-input {
        display: flex;
        align-items: center;
        padding: 0 16px;
        border-bottom: 1px solid var(--bg-border);
      }

      .palette-input svg {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        color: var(--text-secondary);
      }

      .palette-input input {
        flex: 1;
        height: 44px;
        border: none;
        outline: none;
        box-shadow: none;
        -webkit-appearance: none;
        background: transparent;
        color: var(--text-primary);
        font-size: 15px;
        font-family: var(--font-ui);
        padding: 0 10px;
      }

      .palette-input input:focus {
        outline: none;
        box-shadow: none;
      }

      .palette-input input::placeholder {
        color: var(--text-secondary);
      }

      .palette-results {
        overflow-y: auto;
        max-height: 340px;
        padding: 4px 0;
      }

      .group-header {
        padding: 12px 16px 4px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary);
      }

      .result-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 16px;
        cursor: pointer;
        transition: background 0.1s;
      }

      .result-item:hover,
      .result-item.active {
        background: var(--bg-hover, rgba(255, 255, 255, 0.06));
      }

      .result-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .result-subtitle {
        font-size: 12px;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-left: auto;
        flex-shrink: 0;
      }

      .palette-empty {
        padding: 24px 16px;
        text-align: center;
        color: var(--text-secondary);
        font-size: 13px;
      }
    `,
  ];

  @state() private _query = "";
  @state() private _results: SearchResult[] = [];
  @state() private _activeIndex = 0;
  @state() private _searched = false;

  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
  }

  private _onInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    this._query = input.value;
    this._activeIndex = 0;

    if (this._debounceTimer) clearTimeout(this._debounceTimer);

    if (!this._query.trim()) {
      this._results = [];
      this._searched = false;
      return;
    }

    this._debounceTimer = setTimeout(() => {
      void this._doSearch();
    }, 200);
  }

  private async _doSearch(): Promise<void> {
    try {
      this._results = await searchEntities(this._query);
      this._searched = true;
      this._activeIndex = 0;
    } catch {
      this._results = [];
      this._searched = true;
    }
  }

  private _getGroupedResults(): GroupedResults[] {
    const groups = new Map<string, SearchResult[]>();
    for (const r of this._results) {
      if (!groups.has(r.type)) groups.set(r.type, []);
      const arr = groups.get(r.type)!;
      if (arr.length < MAX_PER_GROUP) arr.push(r);
    }

    return GROUP_ORDER.filter((t) => groups.has(t)).map((t) => ({
      type: t,
      label: groupLabel(t),
      items: groups.get(t)!,
    }));
  }

  /** Flat list of visible results (for keyboard navigation). */
  private _getFlatResults(): SearchResult[] {
    return this._getGroupedResults().flatMap((g) => g.items);
  }

  private _onKeydown(e: KeyboardEvent): void {
    const flat = this._getFlatResults();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this._activeIndex = Math.min(this._activeIndex + 1, flat.length - 1);
      this._scrollActiveIntoView();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this._activeIndex = Math.max(this._activeIndex - 1, 0);
      this._scrollActiveIntoView();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = flat[this._activeIndex];
      if (selected) this._navigate(selected);
    }
  }

  private _scrollActiveIntoView(): void {
    this.updateComplete.then(() => {
      const el = this.shadowRoot?.querySelector(".result-item.active");
      el?.scrollIntoView({ block: "nearest" });
    });
  }

  private _navigate(result: SearchResult): void {
    navigateToPath(result.route);
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  override render() {
    const grouped = this._getGroupedResults();
    const flat = this._getFlatResults();
    let flatIndex = 0;

    return html`
      <div class="overlay" @mousedown=${this._onOverlayClick}>
        <div class="palette" @mousedown=${(e: Event) => e.stopPropagation()}>
          <div class="palette-input">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder=${msg("Search instances, agents, tasks...", {
                id: "search-placeholder",
              })}
              .value=${this._query}
              @input=${this._onInput}
              @keydown=${this._onKeydown}
              autofocus
            />
          </div>
          <div class="palette-results">
            ${grouped.length > 0
              ? grouped.map(
                  (group) => html`
                    <div class="group-header">${group.label}</div>
                    ${group.items.map((item) => {
                      const idx = flatIndex++;
                      return html`
                        <div
                          class="result-item ${idx === this._activeIndex ? "active" : ""}"
                          @click=${() => this._navigate(item)}
                          @mouseenter=${() => {
                            this._activeIndex = flat.indexOf(item);
                          }}
                        >
                          <span class="result-title">${item.title}</span>
                          ${item.subtitle
                            ? html`<span class="result-subtitle">${item.subtitle}</span>`
                            : nothing}
                        </div>
                      `;
                    })}
                  `,
                )
              : this._searched && this._query.trim()
                ? html`<div class="palette-empty">
                    ${msg("No results found", { id: "search-no-results" })}
                  </div>`
                : nothing}
          </div>
        </div>
      </div>
    `;
  }

  private _onOverlayClick(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-command-palette": CpCommandPalette;
  }
}
