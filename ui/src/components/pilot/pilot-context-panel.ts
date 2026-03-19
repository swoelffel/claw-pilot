// ui/src/components/pilot/pilot-context-panel.ts
// Retractable right panel with 5 collapsible sections.
// Open: 300px with full content. Closed: 40px icon bar.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized } from "@lit/localize";
import type { SessionContext, PilotBusEvent } from "../../types.js";
import { tokenStyles } from "../../styles/tokens.js";
import "./context/context-gauge.js";
import "./context/context-tools.js";
import "./context/context-agents.js";
import "./context/context-system.js";
import "./context/context-events.js";

type SectionId = "gauge" | "tools" | "agents" | "system" | "events";

interface Section {
  id: SectionId;
  icon: string;
  label: string;
}

const SECTIONS: Section[] = [
  { id: "gauge", icon: "◈", label: "Context" },
  { id: "tools", icon: "⚙", label: "Tools" },
  { id: "agents", icon: "⬡", label: "Agents" },
  { id: "system", icon: "☰", label: "System" },
  { id: "events", icon: "⚡", label: "Events" },
];

@localized()
@customElement("cp-pilot-context-panel")
export class PilotContextPanel extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        border-left: 1px solid var(--bg-border);
        background: var(--bg-surface);
        overflow: hidden;
        transition: width 0.2s ease;
      }

      /* Closed mode: icon bar */
      :host([closed]) .panel-content {
        display: none;
      }

      :host([closed]) .icon-bar {
        display: flex;
      }

      :host(:not([closed])) .icon-bar {
        display: none;
      }

      /* Icon bar (closed state) */
      .icon-bar {
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 8px 4px;
        width: 40px;
      }

      .icon-btn {
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        border: none;
        background: none;
        font-size: 14px;
        color: var(--text-muted);
        cursor: pointer;
        transition:
          background 0.12s,
          color 0.12s;
        font-family: var(--font-ui);
        line-height: 1;
      }

      .icon-btn:hover,
      .icon-btn.active {
        background: var(--accent-subtle);
        color: var(--accent);
      }

      /* Open panel content */
      .panel-content {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        width: 300px;
      }

      /* Section tabs */
      .section-tabs {
        display: flex;
        align-items: center;
        border-bottom: 1px solid var(--bg-border);
        flex-shrink: 0;
        overflow-x: auto;
        scrollbar-width: none;
      }

      .section-tabs::-webkit-scrollbar {
        display: none;
      }

      .section-tab {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 7px 8px;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        border-top: none;
        border-left: none;
        border-right: none;
        background: none;
        font-family: var(--font-ui);
        flex-shrink: 0;
        transition: color 0.12s;
      }

      .section-tab.active {
        border-bottom-color: var(--accent);
        color: var(--accent);
      }

      .section-tab:not(.active) {
        color: var(--text-muted);
      }

      .section-tab:hover:not(.active) {
        color: var(--text-secondary);
      }

      .tab-icon {
        font-size: 13px;
        line-height: 1;
      }

      .tab-label {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
      }

      /* Section body */
      .section-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        min-height: 0;
      }
    `,
  ];

  @property({ type: Object }) context: SessionContext | null = null;
  @property({ type: Array }) events: PilotBusEvent[] = [];
  @property({ type: Boolean, reflect: true }) closed = false;

  @state() private _activeSection: SectionId = "gauge";

  private _renderIconBar() {
    return html`
      <div class="icon-bar">
        ${SECTIONS.map(
          (s) => html`
            <button
              class="icon-btn"
              title="${s.label}"
              @click=${() => {
                this._activeSection = s.id;
                this.dispatchEvent(
                  new CustomEvent("toggle-panel", { bubbles: true, composed: true }),
                );
              }}
            >
              ${s.icon}
            </button>
          `,
        )}
      </div>
    `;
  }

  private _renderSectionContent() {
    const ctx = this.context;

    switch (this._activeSection) {
      case "gauge":
        return html`
          <cp-pilot-context-gauge
            .used=${ctx?.tokenUsage.estimated ?? 0}
            .total=${ctx?.tokenUsage.contextWindow ?? 200_000}
            .threshold=${ctx?.tokenUsage.compactionThreshold ?? 0.85}
            .systemPrompt=${ctx?.systemPrompt ?? null}
            .builtAt=${ctx?.systemPromptBuiltAt ?? null}
          ></cp-pilot-context-gauge>
        `;

      case "tools":
        return html`
          <cp-pilot-context-tools
            .tools=${ctx?.tools ?? []}
            .mcpServers=${ctx?.mcpServers ?? []}
          ></cp-pilot-context-tools>
        `;

      case "agents":
        return html`
          <cp-pilot-context-agents
            .agent=${ctx?.agent}
            .teammates=${ctx?.teammates ?? []}
            .sessionTree=${ctx?.sessionTree ?? []}
          ></cp-pilot-context-agents>
        `;

      case "system":
        return html`
          <cp-pilot-context-system
            .systemPromptFiles=${ctx?.systemPromptFiles ?? []}
            .compaction=${ctx?.compaction}
          ></cp-pilot-context-system>
        `;

      case "events":
        return html` <cp-pilot-context-events .events=${this.events}></cp-pilot-context-events> `;

      default:
        return nothing;
    }
  }

  override render() {
    return html`
      ${this._renderIconBar()}

      <div class="panel-content">
        <div class="section-tabs">
          ${SECTIONS.map(
            (s) => html`
              <button
                class="section-tab ${this._activeSection === s.id ? "active" : ""}"
                @click=${() => {
                  this._activeSection = s.id;
                }}
              >
                <span class="tab-icon">${s.icon}</span>
                <span class="tab-label">${s.label}</span>
              </button>
            `,
          )}
        </div>

        <div class="section-body">${this._renderSectionContent()}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-context-panel": PilotContextPanel;
  }
}
