// ui/src/components/pilot/pilot-input.ts
// Message input: auto-resizing textarea + Send button.
// Enter sends, Shift+Enter inserts newline.
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles } from "../../styles/shared.js";

@localized()
@customElement("cp-pilot-input")
export class PilotInput extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    css`
      :host {
        display: block;
        flex-shrink: 0;
      }

      .input-row {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 10px 12px;
        border-top: 1px solid var(--bg-border);
        background: var(--bg-surface);
      }

      textarea {
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
        min-height: 38px;
        max-height: 140px;
        overflow-y: auto;
        transition: border-color 0.15s;
      }

      textarea:focus {
        border-color: var(--accent);
        box-shadow: var(--focus-ring);
      }

      textarea:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      textarea::placeholder {
        color: var(--text-muted);
      }

      .btn {
        align-self: flex-end;
        padding: 7px 14px;
        flex-shrink: 0;
      }
    `,
  ];

  @property({ type: Boolean }) disabled = false;
  @property() placeholder = "";

  @state() private _text = "";

  private _handleInput(e: Event): void {
    const ta = e.target as HTMLTextAreaElement;
    this._text = ta.value;
    // Auto-resize
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }

  private _handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  private _send(): void {
    const text = this._text.trim();
    if (!text || this.disabled) return;
    this._text = "";
    // Reset textarea height
    const ta = this.shadowRoot?.querySelector("textarea");
    if (ta) ta.style.height = "auto";
    this.dispatchEvent(
      new CustomEvent("send-message", {
        detail: { text },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const placeholder =
      this.placeholder ||
      msg("Message… (Enter to send, Shift+Enter for newline)", {
        id: "pilot-input-placeholder",
      });

    return html`
      <div class="input-row">
        <textarea
          .value=${this._text}
          @input=${this._handleInput}
          @keydown=${this._handleKeydown}
          placeholder=${placeholder}
          ?disabled=${this.disabled}
          rows="1"
        ></textarea>
        <button
          class="btn btn-primary"
          ?disabled=${!this._text.trim() || this.disabled}
          @click=${this._send}
        >
          ${msg("Send", { id: "pilot-btn-send" })}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-input": PilotInput;
  }
}
