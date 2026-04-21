// ui/src/components/pilot/parts/part-question.ts
//
// Renders a question tool_call as an interactive card. In v0.72+, a tool call
// may contain 1..4 questions rendered as tabs, each with its own answerType
// (single / multi / free) and optional "Other…" free-text fallback. A single
// "Send" button submits all answers atomically — no auto-submit on option
// click (guards against mis-clicks).
import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotPart } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";
import { answerQuestion } from "../../../api.js";

// ---------------------------------------------------------------------------
// Types — mirror the runtime QuestionItem / QuestionAnswerPayload shapes
// ---------------------------------------------------------------------------

interface QuestionItem {
  header: string;
  question: string;
  answerType: "single" | "multi" | "free";
  options?: string[];
  allowOther: boolean;
}

interface QuestionArgs {
  questions?: QuestionItem[];
  question?: string;
  options?: string[];
}

interface QuestionMeta {
  toolCallId?: string;
  toolName?: string;
  args?: QuestionArgs;
}

interface TabState {
  selected: Set<string>;
  otherText: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce the tool_call args into a stable QuestionItem[] list. */
function normalizeItems(args: QuestionArgs | undefined): QuestionItem[] {
  if (args?.questions && args.questions.length > 0) {
    return args.questions.map((q) => ({
      header: q.header ?? "",
      question: q.question ?? "",
      answerType: (q.answerType as QuestionItem["answerType"]) ?? "single",
      ...(q.options !== undefined ? { options: q.options } : {}),
      allowOther: Boolean(q.allowOther),
    }));
  }
  if (args?.question !== undefined) {
    const opts = args.options;
    return [
      {
        header: "",
        question: args.question,
        answerType: opts && opts.length > 0 ? "single" : "free",
        ...(opts !== undefined ? { options: opts } : {}),
        allowOther: false,
      },
    ];
  }
  return [];
}

function isTabComplete(item: QuestionItem, state: TabState): boolean {
  if (item.answerType === "free") return state.otherText.trim().length > 0;
  if (item.answerType === "single") {
    return state.selected.size === 1 || (item.allowOther && state.otherText.trim().length > 0);
  }
  // multi
  return state.selected.size >= 1 || (item.allowOther && state.otherText.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

      .tabs {
        display: flex;
        gap: 2px;
        padding: 4px 8px 0;
        background: color-mix(in srgb, var(--accent) 4%, transparent);
        border-bottom: 1px solid var(--bg-border);
        flex-wrap: wrap;
      }

      .tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
        border-radius: var(--radius-sm) var(--radius-sm) 0 0;
        border-bottom: 2px solid transparent;
        transition:
          color 0.12s,
          border-color 0.12s;
      }

      .tab.active {
        color: var(--accent);
        border-bottom-color: var(--accent);
        font-weight: 600;
      }

      .tab .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--bg-border);
        flex-shrink: 0;
      }

      .tab.complete .dot {
        background: var(--state-running);
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
        display: flex;
        align-items: center;
        gap: 10px;
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

      .marker {
        width: 16px;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1.5px solid var(--bg-border);
        color: var(--accent);
        font-size: 11px;
        flex-shrink: 0;
      }

      .marker.radio {
        border-radius: 50%;
      }

      .marker.checkbox {
        border-radius: 3px;
      }

      .option-btn.selected .marker {
        border-color: var(--accent);
        background: var(--accent);
        color: var(--bg-primary);
      }

      .other-block {
        padding: 8px 12px 0;
        font-size: 11px;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .free-input {
        display: flex;
        gap: 8px;
        padding: 6px 12px 12px;
        align-items: flex-end;
      }

      .free-input textarea {
        flex: 1;
        min-height: 36px;
        max-height: 180px;
        padding: 8px 10px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        background: var(--bg-surface);
        color: var(--text-primary);
        font-family: var(--font-ui);
        font-size: 13px;
        line-height: 1.5;
        resize: vertical;
      }

      .free-input textarea:focus {
        outline: none;
        border-color: var(--accent);
      }

      .footer {
        display: flex;
        justify-content: flex-end;
        padding: 10px 12px;
        border-top: 1px solid var(--bg-border);
        background: color-mix(in srgb, var(--accent) 3%, transparent);
      }

      .submit-btn {
        padding: 8px 18px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-sm);
        background: var(--accent);
        color: var(--bg-primary);
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }

      .submit-btn:hover:not(:disabled) {
        opacity: 0.9;
      }

      .submit-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .answered-badge {
        padding: 10px 12px;
        font-size: 12px;
        color: var(--state-running);
        background: color-mix(in srgb, var(--state-running) 8%, transparent);
        border-top: 1px solid var(--bg-border);
        white-space: pre-wrap;
      }
    `,
  ];

  @property({ type: Object }) call!: PilotPart;
  @property({ type: Object }) result?: PilotPart;
  @property({ attribute: false }) slug = "";

  @state() private _activeTab = 0;
  @state() private _tabStates: TabState[] = [];
  @state() private _submitting = false;
  @state() private _answered = false;

  private _initialized = false;

  private _meta(): QuestionMeta {
    try {
      return (this.call.metadata ? JSON.parse(this.call.metadata) : {}) as QuestionMeta;
    } catch {
      return {};
    }
  }

  private _items(): QuestionItem[] {
    return normalizeItems(this._meta().args);
  }

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("call") && changed.get("call") !== undefined) {
      // Reset all interaction state when the underlying tool_call changes
      // (e.g. Lit reuses this DOM element for a new question).
      this._activeTab = 0;
      this._tabStates = [];
      this._submitting = false;
      this._answered = false;
      this._initialized = false;
    }
  }

  private _ensureInit(items: QuestionItem[]): void {
    if (this._initialized) return;
    this._tabStates = items.map(() => ({ selected: new Set<string>(), otherText: "" }));
    this._initialized = true;
  }

  private _toggleOption(item: QuestionItem, tabIdx: number, option: string): void {
    if (this._answered || this._submitting) return;
    const state = this._tabStates[tabIdx];
    if (!state) return;
    const next = new Set(state.selected);
    if (item.answerType === "single") {
      if (next.has(option)) next.delete(option);
      else {
        next.clear();
        next.add(option);
      }
    } else {
      // multi
      if (next.has(option)) next.delete(option);
      else next.add(option);
    }
    // Lit needs a new array reference to re-render.
    const updated = [...this._tabStates];
    updated[tabIdx] = { ...state, selected: next };
    this._tabStates = updated;
  }

  private _updateOther(tabIdx: number, value: string): void {
    if (this._answered || this._submitting) return;
    const state = this._tabStates[tabIdx];
    if (!state) return;
    const updated = [...this._tabStates];
    updated[tabIdx] = { ...state, otherText: value };
    this._tabStates = updated;
  }

  private async _submit(): Promise<void> {
    if (this._submitting || this._answered) return;
    const items = this._items();
    if (items.length === 0) return;
    // All tabs must be valid.
    for (let i = 0; i < items.length; i++) {
      if (!isTabComplete(items[i]!, this._tabStates[i]!)) return;
    }

    const meta = this._meta();
    const questionId = meta.toolCallId;
    if (!questionId || !this.slug) return;

    const payload = items.map((item, i) => {
      const s = this._tabStates[i]!;
      const selected = [...s.selected];
      const result: { selected: string[]; otherText?: string } = { selected };
      if (s.otherText.trim().length > 0) {
        result.otherText = s.otherText.trim();
      }
      return result;
    });

    this._submitting = true;
    try {
      await answerQuestion(this.slug, questionId, JSON.stringify(payload));
      this._answered = true;
      this.dispatchEvent(
        new CustomEvent("question-answered", {
          bubbles: true,
          composed: true,
          detail: { questionId },
        }),
      );
    } catch {
      // Allow retry on error
    } finally {
      this._submitting = false;
    }
  }

  // --- Render helpers -------------------------------------------------------

  private _renderTabs(items: QuestionItem[]): unknown {
    if (items.length <= 1) return nothing;
    return html`<div class="tabs" role="tablist">
      ${items.map((item, i) => {
        const state = this._tabStates[i];
        const complete = state ? isTabComplete(item, state) : false;
        const label = item.header || `Q${i + 1}`;
        return html`<button
          type="button"
          role="tab"
          class="tab ${i === this._activeTab ? "active" : ""} ${complete ? "complete" : ""}"
          @click=${() => {
            this._activeTab = i;
          }}
        >
          <span class="dot"></span>
          ${label}
        </button>`;
      })}
    </div>`;
  }

  private _renderOptions(item: QuestionItem, tabIdx: number): unknown {
    if (item.answerType === "free" || !item.options || item.options.length === 0) return nothing;
    const state = this._tabStates[tabIdx];
    if (!state) return nothing;
    const isMulti = item.answerType === "multi";
    return html`<div class="options">
      ${item.options.map((opt) => {
        const selected = state.selected.has(opt);
        return html`<button
          type="button"
          class="option-btn ${selected ? "selected" : ""}"
          ?disabled=${this._submitting || this._answered}
          @click=${() => this._toggleOption(item, tabIdx, opt)}
        >
          <span class="marker ${isMulti ? "checkbox" : "radio"}">${selected ? "✓" : ""}</span>
          <span>${opt}</span>
        </button>`;
      })}
    </div>`;
  }

  private _renderFreeOrOther(item: QuestionItem, tabIdx: number): unknown {
    const state = this._tabStates[tabIdx];
    if (!state) return nothing;
    const showFree = item.answerType === "free" || item.allowOther;
    if (!showFree) return nothing;
    const placeholder =
      item.answerType === "free"
        ? msg("Type your answer…", { id: "part-question-placeholder-free" })
        : msg("Other (optional)…", { id: "part-question-placeholder-other" });
    const label =
      item.answerType !== "free"
        ? html`<div class="other-block">${msg("Other", { id: "part-question-other-label" })}</div>`
        : nothing;
    return html`${label}
      <div class="free-input">
        <textarea
          rows="2"
          placeholder=${placeholder}
          .value=${state.otherText}
          ?disabled=${this._submitting || this._answered}
          @input=${(e: InputEvent) =>
            this._updateOther(tabIdx, (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>`;
  }

  override render() {
    if (!this.call) return nothing;
    const items = this._items();
    if (items.length === 0) return nothing;
    this._ensureInit(items);

    const isCompleted = this.call.state === "completed" || this.result?.state === "completed";
    const answeredText = this.call.content ?? this.result?.content ?? "";
    const isAnswered = isCompleted || this._answered;

    // Clamp active tab if items list changed (edge case during streaming).
    const activeIdx = Math.min(this._activeTab, items.length - 1);
    const activeItem = items[activeIdx]!;

    const allValid = items.every((it, i) => isTabComplete(it, this._tabStates[i]!));
    const submitLabel =
      items.length > 1
        ? msg("Send answers", { id: "part-question-send-many" })
        : msg("Send", { id: "part-question-send-one" });

    return html`
      <div class="question-card">
        <div class="question-header">
          ?
          ${msg("Question", { id: "part-question-title" })}${items.length > 1
            ? html` <span style="opacity:0.7">(${items.length})</span>`
            : nothing}
        </div>

        ${this._renderTabs(items)}

        <div class="question-text">${activeItem.question}</div>

        ${!isAnswered
          ? html`
              ${this._renderOptions(activeItem, activeIdx)}
              ${this._renderFreeOrOther(activeItem, activeIdx)}
              <div class="footer">
                <button
                  class="submit-btn"
                  ?disabled=${this._submitting || !allValid}
                  @click=${() => void this._submit()}
                >
                  ${submitLabel}
                </button>
              </div>
            `
          : html`
              <div class="answered-badge">
                ✓ ${answeredText || msg("Submitted", { id: "part-question-submitted" })}
              </div>
            `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-question": PilotPartQuestion;
  }
}
