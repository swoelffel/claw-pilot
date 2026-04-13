// ui/src/components/pilot/parts/part-delegation-expand.ts
// Inline accordion that drills into a sub-session's full timeline on demand.
// Lazy-fetches messages the first time the user expands the card. Supports
// nested drill-down: a delegation entry inside the sub-session is itself
// expandable.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotMessage, TimelineFilters } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";
import { fetchSessionMessages } from "../../../api.js";
import { buildTimeline, filterTimeline } from "../timeline-utils.js";
// Import via sibling so the bundle graph wires it up; the reference itself
// happens through the custom element tag in the template.
import "../pilot-message.js";

interface Summary {
  steps: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd >= 0.001) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m${sec.toString().padStart(2, "0")}s`;
}

function computeSummary(messages: PilotMessage[]): Summary {
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let steps = 0;
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const m of messages) {
    if (m.tokensIn) tokensIn += m.tokensIn;
    if (m.tokensOut) tokensOut += m.tokensOut;
    if (m.costUsd) costUsd += m.costUsd;
    if (m.role === "assistant") {
      steps += m.parts.filter((p) => p.type === "tool_call").length;
    }
    const t = new Date(m.createdAt).getTime();
    if (!Number.isNaN(t)) {
      if (t < minTs) minTs = t;
      if (t > maxTs) maxTs = t;
    }
  }
  return {
    steps,
    tokensIn,
    tokensOut,
    costUsd,
    durationMs: maxTs > minTs ? maxTs - minTs : 0,
  };
}

@localized()
@customElement("cp-pilot-part-delegation-expand")
export class PilotPartDelegationExpand extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .expand-block {
        border-left: 2px solid var(--accent-border);
        border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        margin-top: 6px;
      }

      .expand-toggle {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 5px 10px;
        background: none;
        border: none;
        width: 100%;
        text-align: left;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--text-muted);
        cursor: pointer;
        transition: color 0.12s;
      }

      .expand-toggle:hover {
        color: var(--accent);
      }

      .expand-chevron {
        font-size: 9px;
        transition: transform 0.15s;
        flex-shrink: 0;
      }

      .expand-toggle.expanded .expand-chevron {
        transform: rotate(90deg);
      }

      .expand-label {
        font-weight: 600;
      }

      .summary-pill {
        display: inline-flex;
        gap: 6px;
        padding: 1px 7px;
        border-radius: 100px;
        background: var(--bg-hover);
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--text-muted);
        flex-shrink: 0;
      }

      .summary-pill span {
        white-space: nowrap;
      }

      .expand-body {
        padding: 6px 4px 8px 10px;
        background: var(--bg-hover);
        border-radius: var(--radius-sm);
      }

      .loading,
      .empty,
      .error {
        padding: 8px 10px;
        font-size: 11px;
        color: var(--text-muted);
        font-style: italic;
      }

      .error {
        color: var(--state-error);
      }

      .nested-timeline {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
    `,
  ];

  @property() slug = "";
  @property() subSessionId = "";
  /** Agent id of the sub-session (used to resolve `currentAgentId` for nested A2A rendering). */
  @property() targetAgentId = "";
  /** Filters from the parent timeline — propagated so the nested timeline honors the same toggles. */
  @property({ type: Object }) filters: TimelineFilters | null = null;
  /** Subagent results map passed through for potential nested subtask rendering. */
  @property({ type: Object }) subagentResults: Record<string, unknown> = {};

  @state() private _expanded = false;
  @state() private _loading = false;
  @state() private _error = "";
  @state() private _messages: PilotMessage[] | null = null;
  @state() private _summary: Summary | null = null;

  private async _toggle(): Promise<void> {
    this._expanded = !this._expanded;
    if (!this._expanded || this._messages !== null || this._loading) return;
    if (!this.slug || !this.subSessionId) return;
    this._loading = true;
    this._error = "";
    try {
      const { messages } = await fetchSessionMessages(this.slug, this.subSessionId, {
        limit: 100,
      });
      this._messages = messages;
      this._summary = computeSummary(messages);
    } catch (err) {
      this._error =
        err instanceof Error
          ? err.message
          : msg("Failed to load sub-session", {
              id: "delegation-expand-error",
            });
    } finally {
      this._loading = false;
    }
  }

  private _renderSummary(): unknown {
    if (!this._summary) return nothing;
    const s = this._summary;
    const tokensTotal = s.tokensIn + s.tokensOut;
    return html`<span class="summary-pill">
      ${s.steps > 0
        ? html`<span>${s.steps} ${msg("steps", { id: "delegation-summary-steps" })}</span>`
        : nothing}
      ${tokensTotal > 0 ? html`<span>${formatTokens(tokensTotal)} tok</span>` : nothing}
      ${s.costUsd > 0 ? html`<span>${formatCost(s.costUsd)}</span>` : nothing}
      ${s.durationMs > 0 ? html`<span>${formatDuration(s.durationMs)}</span>` : nothing}
    </span>`;
  }

  private _renderBody(): unknown {
    if (this._loading) {
      return html`<div class="loading">
        ${msg("Loading sub-session\u2026", { id: "delegation-expand-loading" })}
      </div>`;
    }
    if (this._error) {
      return html`<div class="error">${this._error}</div>`;
    }
    if (!this._messages) return nothing;
    if (this._messages.length === 0) {
      return html`<div class="empty">
        ${msg("No messages in this sub-session", { id: "delegation-expand-empty" })}
      </div>`;
    }
    const timeline = buildTimeline(this._messages, this.targetAgentId || undefined);
    const filtered = this.filters ? filterTimeline(timeline, this.filters) : timeline;
    return html`<div class="nested-timeline">
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
            .filters=${this.filters}
          ></cp-pilot-message>
        `,
      )}
    </div>`;
  }

  override render(): unknown {
    const disabled = !this.slug || !this.subSessionId;
    return html`
      <div class="expand-block">
        <button
          class="expand-toggle ${this._expanded ? "expanded" : ""}"
          ?disabled=${disabled}
          @click=${this._toggle}
        >
          <span class="expand-chevron">▶</span>
          <span class="expand-label">
            ${this._expanded
              ? msg("Hide sub-session", { id: "delegation-expand-hide" })
              : msg("View sub-session", { id: "delegation-expand-show" })}
          </span>
          ${this._summary ? this._renderSummary() : nothing}
        </button>
        ${this._expanded ? html`<div class="expand-body">${this._renderBody()}</div>` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-delegation-expand": PilotPartDelegationExpand;
  }
}
