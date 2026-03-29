// ui/src/components/pilot/pilot-messages.ts
// Scrollable message list with auto-scroll, streaming indicator, and infinite scroll upward.
// Transforms PilotMessage[] into a unified TimelineEntry[] and applies filters.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotMessage, TimelineEntry, TimelineFilters } from "../../types.js";
import { DEFAULT_TIMELINE_FILTERS } from "../../types.js";
import { tokenStyles } from "../../styles/tokens.js";
import { spinnerStyles } from "../../styles/shared.js";
import { buildTimeline, filterTimeline } from "./timeline-utils.js";
import "./pilot-message.js";

type AgentStatus = "idle" | "loading" | "sending" | "streaming" | "error";

@localized()
@customElement("cp-pilot-messages")
export class PilotMessages extends LitElement {
  static override styles = [
    tokenStyles,
    spinnerStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      .messages-scroll {
        flex: 1;
        overflow-y: auto;
        padding: 16px 16px 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-height: 0;
        scroll-behavior: smooth;
      }

      /* Load more indicator at the top */
      .load-more {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        flex-shrink: 0;
      }

      .load-more-btn {
        font-size: 11px;
        color: var(--accent);
        background: none;
        border: 1px solid var(--accent-border);
        border-radius: var(--radius-sm);
        padding: 4px 12px;
        cursor: pointer;
        font-family: var(--font-ui);
        transition: background 0.12s;
      }

      .load-more-btn:hover {
        background: var(--accent-subtle);
      }

      /* Empty state */
      .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: var(--text-muted);
        font-size: 13px;
        padding: 24px;
        text-align: center;
      }

      .empty-icon {
        font-size: 28px;
        opacity: 0.4;
      }

      /* Streaming message — timeline-aligned */
      .streaming-entry {
        display: grid;
        grid-template-columns: 52px 22px 1fr;
        gap: 0 8px;
        align-items: start;
        padding: 4px 0;
      }

      .streaming-ts {
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--text-muted);
        padding-top: 2px;
        text-align: right;
        white-space: nowrap;
      }

      .streaming-icon {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-size: 11px;
        background: var(--bg-hover);
        margin-top: 1px;
      }

      .streaming-content {
        min-width: 0;
      }

      .streaming-header {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
        margin-bottom: 2px;
      }

      .streaming-bubble {
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-primary);
        white-space: pre-wrap;
        word-break: break-word;
        opacity: 0.9;
      }

      .streaming-cursor {
        display: inline-block;
        width: 2px;
        height: 14px;
        background: var(--accent);
        margin-left: 1px;
        vertical-align: middle;
        animation: blink 1s step-end infinite;
      }

      @keyframes blink {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0;
        }
      }

      /* Spinner row — timeline-aligned */
      .spinner-entry {
        display: grid;
        grid-template-columns: 52px 22px 1fr;
        gap: 0 8px;
        align-items: center;
        padding: 4px 0;
      }

      .spinner-row {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
        font-size: 12px;
      }

      .spinner-row .spinner {
        width: 14px;
        height: 14px;
        border-width: 2px;
        flex-shrink: 0;
      }
    `,
  ];

  @property({ type: Array }) messages: PilotMessage[] = [];
  @property({ type: Object }) filters: TimelineFilters = DEFAULT_TIMELINE_FILTERS;
  @property() streamingText = "";
  @property() streamingAgentId = "";
  @property() status: AgentStatus = "idle";
  @property({ type: Boolean }) hasMore = false;
  @property({ type: Object }) subagentResults: Record<string, unknown> = {};
  @property() slug = "";
  @property() currentAgentId = "";

  @state() private _userScrolled = false;

  // Memoization for timeline computation
  private _cachedMessages: PilotMessage[] | null = null;
  private _cachedAgentId = "";
  private _cachedTimeline: TimelineEntry[] = [];

  private get _timeline(): TimelineEntry[] {
    if (this._cachedMessages !== this.messages || this._cachedAgentId !== this.currentAgentId) {
      this._cachedMessages = this.messages;
      this._cachedAgentId = this.currentAgentId;
      this._cachedTimeline = buildTimeline(this.messages, this.currentAgentId || undefined);
    }
    return this._cachedTimeline;
  }

  private get _filteredEntries(): TimelineEntry[] {
    return filterTimeline(this._timeline, this.filters);
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("messages") || changed.has("streamingText")) {
      if (!this._userScrolled) {
        this._scrollToBottom();
      }
    }
  }

  private _scrollToBottom(): void {
    const el = this.shadowRoot?.querySelector(".messages-scroll");
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  private _onScroll(e: Event): void {
    const el = e.target as Element;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    this._userScrolled = !atBottom;
  }

  private _nowTime(): string {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  override render() {
    const filtered = this._filteredEntries;
    const allEmpty = this._timeline.length === 0;
    const filteredEmpty = !allEmpty && filtered.length === 0;

    const isEmpty =
      allEmpty && !this.streamingText && this.status !== "loading" && this.status !== "sending";

    return html`
      <div class="messages-scroll" @scroll=${this._onScroll}>
        ${this.hasMore
          ? html`
              <div class="load-more">
                <button
                  class="load-more-btn"
                  @click=${() =>
                    this.dispatchEvent(
                      new CustomEvent("load-more", { bubbles: true, composed: true }),
                    )}
                >
                  ↑ ${msg("Load older messages", { id: "pilot-load-more" })}
                </button>
              </div>
            `
          : nothing}
        ${isEmpty
          ? html`
              <div class="empty-state">
                <span class="empty-icon">⬡</span>
                <span
                  >${msg("Start a conversation with the agent", { id: "pilot-chat-empty" })}</span
                >
              </div>
            `
          : nothing}
        ${filteredEmpty
          ? html`
              <div class="empty-state">
                <span class="empty-icon">🔍</span>
                <span
                  >${msg("No entries match the current filters", {
                    id: "pilot-timeline-empty-filtered",
                  })}</span
                >
              </div>
            `
          : nothing}
        ${filtered.map(
          (entry) => html`
            <cp-pilot-message
              .entry=${entry}
              .slug=${this.slug}
              .subagentResults=${this.subagentResults as Record<
                string,
                {
                  text?: string;
                  steps?: number;
                  tokens?: { input: number; output: number };
                  model?: string;
                }
              >}
            ></cp-pilot-message>
          `,
        )}
        ${this.streamingText
          ? html`
              <div class="streaming-entry">
                <span class="streaming-ts">${this._nowTime()}</span>
                <span class="streaming-icon">⬡</span>
                <div class="streaming-content">
                  <div class="streaming-header">
                    ${this.streamingAgentId || msg("agent", { id: "role-agent" })}
                  </div>
                  <div class="streaming-bubble">
                    ${this.streamingText}<span class="streaming-cursor"></span>
                  </div>
                </div>
              </div>
            `
          : nothing}
        ${(this.status === "sending" || this.status === "loading") && !this.streamingText
          ? html`
              <div class="spinner-entry">
                <span></span>
                <span></span>
                <div class="spinner-row">
                  <div class="spinner"></div>
                  <span>${msg("Agent is thinking\u2026", { id: "pilot-thinking" })}</span>
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-messages": PilotMessages;
  }
}
