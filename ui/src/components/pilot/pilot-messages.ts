// ui/src/components/pilot/pilot-messages.ts
// Scrollable message list with auto-scroll, streaming indicator, and infinite scroll upward.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotMessage } from "../../types.js";
import { tokenStyles } from "../../styles/tokens.js";
import { spinnerStyles } from "../../styles/shared.js";
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
        gap: 14px;
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

      /* Streaming message */
      .streaming-message {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }

      .streaming-header {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
        padding: 0 2px;
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

      /* Spinner row */
      .spinner-row {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
        font-size: 12px;
        padding: 4px 2px;
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
  @property() streamingText = "";
  @property() streamingAgentId = "";
  @property() status: AgentStatus = "idle";
  @property({ type: Boolean }) hasMore = false;
  @property({ type: Object }) subagentResults: Record<string, unknown> = {};
  @property() slug = "";

  @state() private _userScrolled = false;

  private _scrollRef: Element | null = null;

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

  override render() {
    const isEmpty =
      this.messages.length === 0 &&
      !this.streamingText &&
      this.status !== "loading" &&
      this.status !== "sending";

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
        ${this.messages.map(
          (m) => html`
            <cp-pilot-message
              .message=${m}
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
              <div class="streaming-message">
                <div class="streaming-header">
                  ${this.streamingAgentId || msg("agent", { id: "role-agent" })}
                </div>
                <div class="streaming-bubble">
                  ${this.streamingText}<span class="streaming-cursor"></span>
                </div>
              </div>
            `
          : nothing}
        ${(this.status === "sending" || this.status === "loading") && !this.streamingText
          ? html`
              <div class="spinner-row">
                <div class="spinner"></div>
                <span>${msg("Agent is thinking…", { id: "pilot-thinking" })}</span>
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
