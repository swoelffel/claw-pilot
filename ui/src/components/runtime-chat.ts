// ui/src/components/runtime-chat.ts
// Composant Lit pour le chat temps réel avec un agent claw-runtime via SSE
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { RuntimeSession } from "../types.js";
import { fetchRuntimeSessions, postRuntimeChat, getRuntimeChatStreamUrl } from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  id?: string;
}

@customElement("cp-runtime-chat")
export class RuntimeChat extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .runtime-chat {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 0;
        background: var(--bg-surface);
      }

      /* ── Header ─────────────────────────────────────────────────────────── */

      .chat-header {
        display: flex;
        flex-direction: row;
        align-items: center;
        padding: 12px;
        border-bottom: 1px solid var(--bg-border);
        gap: 8px;
        flex-shrink: 0;
      }

      .chat-header select {
        flex: 1;
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 13px;
        padding: 6px 10px;
        cursor: pointer;
        outline: none;
      }

      .chat-header select:focus {
        border-color: var(--accent);
        box-shadow: var(--focus-ring);
      }

      /* ── Messages ───────────────────────────────────────────────────────── */

      .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }

      .chat-messages-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted);
        font-size: 13px;
      }

      .message {
        padding: 10px 14px;
        border-radius: var(--radius-md);
        font-size: 13px;
        line-height: 1.5;
        max-width: 85%;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .message.user {
        background: var(--bg-hover);
        align-self: flex-end;
        color: var(--text-primary);
      }

      .message.assistant {
        background: transparent;
        border: 1px solid var(--bg-border);
        align-self: flex-start;
        color: var(--text-primary);
      }

      .message.streaming {
        opacity: 0.85;
      }

      .spinner-row {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
        font-size: 12px;
        align-self: flex-start;
      }

      .spinner-row .spinner {
        width: 16px;
        height: 16px;
        border-width: 2px;
      }

      /* ── Input ──────────────────────────────────────────────────────────── */

      .chat-input-row {
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        padding: 12px;
        border-top: 1px solid var(--bg-border);
        gap: 8px;
        flex-shrink: 0;
      }

      .chat-input-row textarea {
        flex: 1;
        resize: none;
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 13px;
        font-family: inherit;
        padding: 8px 12px;
        outline: none;
        line-height: 1.5;
      }

      .chat-input-row textarea:focus {
        border-color: var(--accent);
        box-shadow: var(--focus-ring);
      }

      .chat-input-row textarea:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .chat-input-row textarea::placeholder {
        color: var(--text-muted);
      }

      .chat-input-row .btn {
        align-self: flex-end;
      }

      /* ── Error banner ───────────────────────────────────────────────────── */

      .error-banner {
        margin: 0 12px 12px;
        flex-shrink: 0;
      }
    `,
  ];

  // ── Public properties ──────────────────────────────────────────────────────

  @property({ type: String }) slug = "";

  // ── Internal state ─────────────────────────────────────────────────────────

  @state() private _sessions: RuntimeSession[] = [];
  @state() private _sessionId: string | null = null;
  @state() private _messages: ChatMessage[] = [];
  @state() private _streamingText = "";
  @state() private _status: "idle" | "loading" | "sending" | "streaming" | "error" = "idle";
  @state() private _error = "";
  @state() private _inputText = "";
  @state() private _sessionsLoading = false;

  private _eventSource: EventSource | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadSessions();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._closeStream();
  }

  // ── Session management ─────────────────────────────────────────────────────

  private async _loadSessions(): Promise<void> {
    if (!this.slug) return;
    this._sessionsLoading = true;
    try {
      this._sessions = await fetchRuntimeSessions(this.slug);
      // Auto-select first active session if none selected
      if (!this._sessionId && this._sessions.length > 0) {
        const firstActive = this._sessions.find((s) => s.state === "active");
        if (firstActive) {
          this._selectSession(firstActive.id);
        }
      }
    } catch {
      // Non-fatal — sessions list will be empty
    } finally {
      this._sessionsLoading = false;
    }
  }

  private _selectSession(id: string): void {
    if (this._sessionId === id) return;
    this._sessionId = id;
    this._messages = [];
    this._streamingText = "";
    this._error = "";
    this._status = "idle";
    this._closeStream();
    this._openStream(id);
  }

  private _createNewSession(): void {
    this._sessionId = null;
    this._messages = [];
    this._streamingText = "";
    this._error = "";
    this._status = "idle";
    this._closeStream();
  }

  // ── SSE stream ─────────────────────────────────────────────────────────────

  private _openStream(sessionId: string): void {
    this._closeStream();

    const url = getRuntimeChatStreamUrl(this.slug, sessionId);
    const es = new EventSource(url);
    this._eventSource = es;

    es.onmessage = (e: MessageEvent) => {
      let event: { type: string; payload: Record<string, unknown> };
      try {
        event = JSON.parse(e.data as string) as typeof event;
      } catch {
        return;
      }

      const payload = event.payload;

      switch (event.type) {
        case "message.part.delta": {
          // Accumulate streaming text delta
          const delta = payload.delta as string | undefined;
          if (delta) {
            this._streamingText += delta;
            this._status = "streaming";
          }
          break;
        }
        case "message.created": {
          // New assistant message starting
          if (payload.role === "assistant") {
            this._streamingText = "";
            this._status = "streaming";
          }
          break;
        }
        case "message.updated": {
          // Message finalized — flush streaming text into messages list
          if (this._streamingText) {
            this._messages = [
              ...this._messages,
              {
                role: "assistant",
                text: this._streamingText,
                ...(payload.messageId !== undefined ? { id: payload.messageId as string } : {}),
              },
            ];
            this._streamingText = "";
          }
          this._status = "idle";
          break;
        }
        case "session.status": {
          const status = payload.status as string;
          if (status === "busy") {
            this._status = "streaming";
          } else if (status === "idle") {
            // Only reset to idle if we're not already processing a message.updated
            if (this._status === "streaming" && !this._streamingText) {
              this._status = "idle";
            }
          }
          break;
        }
        case "session.ended": {
          this._status = "idle";
          this._streamingText = "";
          break;
        }
        default:
          break;
      }
    };

    es.addEventListener("ping", () => {
      // Keep-alive ping — ignore
    });

    es.onerror = () => {
      this._status = "error";
      this._error = "Connection to runtime lost. Please refresh.";
      this._closeStream();
    };
  }

  private _closeStream(): void {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
  }

  // ── Send message ───────────────────────────────────────────────────────────

  private async _sendMessage(): Promise<void> {
    const text = this._inputText.trim();
    if (!text || this._status !== "idle") return;

    // Add user message to history immediately
    this._messages = [...this._messages, { role: "user", text }];
    this._inputText = "";
    this._status = "sending";
    this._error = "";

    try {
      const result = await postRuntimeChat(this.slug, {
        message: text,
        ...(this._sessionId !== null ? { sessionId: this._sessionId } : {}),
      });

      // If this was a new session, store the sessionId and open the stream
      if (!this._sessionId) {
        this._sessionId = result.sessionId;
        this._openStream(result.sessionId);
        // Reload sessions list to include the new session
        void this._loadSessions();
      }

      // Status will be updated by SSE events; set to streaming while waiting
      this._status = "streaming";
    } catch (err) {
      this._status = "error";
      this._error = err instanceof Error ? err.message : "Failed to send message";
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    // Enter without Shift → send message
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void this._sendMessage();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  override render() {
    const isDisabled = this._status !== "idle";

    return html`
      <div class="runtime-chat">
        <!-- Header: session selector + new session button -->
        <div class="chat-header">
          <select
            @change=${(e: Event) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val) {
                this._selectSession(val);
              } else {
                this._createNewSession();
              }
            }}
          >
            <option value="" ?selected=${!this._sessionId}>
              ${this._sessionsLoading ? "Loading…" : "New session"}
            </option>
            ${this._sessions.map(
              (s) => html`
                <option value=${s.id} ?selected=${s.id === this._sessionId}>
                  ${s.title ?? s.id.slice(0, 12) + "…"}
                </option>
              `,
            )}
          </select>
          <button
            class="btn btn-ghost"
            style="font-size:12px;padding:5px 10px"
            @click=${this._createNewSession}
          >
            + New
          </button>
        </div>

        <!-- Messages history -->
        <div class="chat-messages">
          ${this._messages.length === 0 && !this._streamingText && this._status === "idle"
            ? html`<div class="chat-messages-empty">Start a conversation with the agent</div>`
            : nothing}
          ${this._messages.map((m) => html` <div class="message ${m.role}">${m.text}</div> `)}
          ${this._streamingText
            ? html`<div class="message assistant streaming">${this._streamingText}▋</div>`
            : nothing}
          ${this._status === "sending" || (this._status === "streaming" && !this._streamingText)
            ? html`
                <div class="spinner-row">
                  <div class="spinner"></div>
                  <span>Agent is thinking…</span>
                </div>
              `
            : nothing}
        </div>

        <!-- Input row -->
        <div class="chat-input-row">
          <textarea
            .value=${this._inputText}
            @input=${(e: Event) => {
              this._inputText = (e.target as HTMLTextAreaElement).value;
            }}
            @keydown=${this._handleKeydown}
            placeholder="Message… (Enter to send, Shift+Enter for newline)"
            ?disabled=${isDisabled}
            rows="2"
          ></textarea>
          <button
            class="btn btn-primary"
            @click=${() => void this._sendMessage()}
            ?disabled=${!this._inputText.trim() || isDisabled}
          >
            Send
          </button>
        </div>

        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-runtime-chat": RuntimeChat;
  }
}
