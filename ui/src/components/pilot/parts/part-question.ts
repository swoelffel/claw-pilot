// ui/src/components/pilot/parts/part-question.ts
// Renders a question tool_call as an interactive card with clickable option buttons.
// When the user clicks an option (or submits free text), the answer is sent to the API.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotPart } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";
import { answerQuestion } from "../../../api.js";

interface QuestionMeta {
  toolCallId?: string;
  toolName?: string;
  args?: { question?: string; options?: string[] };
}

@localized()
@customElement("cp-pilot-part-question")
export class PilotPartQuestion extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .question-card {
        border: 1px solid var(--accent);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .question-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: color-mix(in srgb, var(--accent) 8%, transparent);
        font-size: 12px;
        font-weight: 600;
        color: var(--accent);
      }

      .question-text {
        padding: 12px;
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-primary);
        white-space: pre-wrap;
      }

      .options {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 0 12px 12px;
      }

      .option-btn {
        display: block;
        width: 100%;
        padding: 10px 14px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        background: var(--bg-surface);
        color: var(--text-primary);
        font-family: var(--font-ui);
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition:
          border-color 0.12s,
          background-color 0.12s;
      }

      .option-btn:hover:not(:disabled) {
        border-color: var(--accent);
        background: color-mix(in srgb, var(--accent) 6%, transparent);
      }

      .option-btn:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .option-btn.selected {
        border-color: var(--accent);
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        font-weight: 600;
      }

      .free-input {
        display: flex;
        gap: 8px;
        padding: 0 12px 12px;
      }

      .free-input input {
        flex: 1;
        padding: 8px 10px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        background: var(--bg-surface);
        color: var(--text-primary);
        font-family: var(--font-ui);
        font-size: 13px;
      }

      .free-input input:focus {
        outline: none;
        border-color: var(--accent);
      }

      .free-input button {
        padding: 8px 14px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-sm);
        background: var(--accent);
        color: var(--bg-primary);
        font-family: var(--font-ui);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }

      .free-input button:hover:not(:disabled) {
        opacity: 0.9;
      }

      .free-input button:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .answered-badge {
        padding: 8px 12px;
        font-size: 12px;
        color: var(--state-running);
        background: color-mix(in srgb, var(--state-running) 8%, transparent);
        border-top: 1px solid var(--bg-border);
      }
    `,
  ];

  @property({ type: Object }) call!: PilotPart;
  @property({ type: Object }) result?: PilotPart;
  @property({ attribute: false }) slug = "";

  @state() private _submitting = false;
  @state() private _answered = false;
  @state() private _selectedAnswer = "";
  @state() private _freeText = "";

  private _meta(): QuestionMeta {
    try {
      return (this.call.metadata ? JSON.parse(this.call.metadata) : {}) as QuestionMeta;
    } catch {
      return {};
    }
  }

  private async _submitAnswer(answer: string): Promise<void> {
    if (this._submitting || this._answered) return;

    const meta = this._meta();
    const questionId = meta.toolCallId;
    if (!questionId || !this.slug) return;

    this._submitting = true;
    this._selectedAnswer = answer;

    try {
      await answerQuestion(this.slug, questionId, answer);
      this._answered = true;
    } catch {
      // On error, allow retry
      this._selectedAnswer = "";
    } finally {
      this._submitting = false;
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && this._freeText.trim()) {
      void this._submitAnswer(this._freeText.trim());
    }
  }

  override render() {
    if (!this.call) return nothing;

    const meta = this._meta();
    const question = meta.args?.question ?? "";
    const options = meta.args?.options ?? [];
    const isCompleted = this.result?.state === "completed";
    const answeredText = this.result?.content ?? "";
    const isAnswered = isCompleted || this._answered;

    return html`
      <div class="question-card">
        <div class="question-header">? ${msg("Question", { id: "part-question-title" })}</div>

        <div class="question-text">${question}</div>

        ${options.length > 0 && !isAnswered
          ? html`
              <div class="options">
                ${options.map(
                  (opt) => html`
                    <button
                      class="option-btn ${this._selectedAnswer === opt ? "selected" : ""}"
                      ?disabled=${this._submitting}
                      @click=${() => void this._submitAnswer(opt)}
                    >
                      ${opt}
                    </button>
                  `,
                )}
              </div>
            `
          : nothing}
        ${options.length === 0 && !isAnswered
          ? html`
              <div class="free-input">
                <input
                  type="text"
                  placeholder="${msg("Type your answer…", { id: "part-question-placeholder" })}"
                  .value=${this._freeText}
                  @input=${(e: InputEvent) => {
                    this._freeText = (e.target as HTMLInputElement).value;
                  }}
                  @keydown=${this._handleKeydown}
                  ?disabled=${this._submitting}
                />
                <button
                  ?disabled=${this._submitting || !this._freeText.trim()}
                  @click=${() => void this._submitAnswer(this._freeText.trim())}
                >
                  ${msg("Send", { id: "part-question-send" })}
                </button>
              </div>
            `
          : nothing}
        ${isAnswered
          ? html`
              <div class="answered-badge">
                ${answeredText ? html`✓ ${answeredText}` : html`✓ ${this._selectedAnswer}`}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-question": PilotPartQuestion;
  }
}
