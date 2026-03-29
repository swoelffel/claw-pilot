// ui/src/components/pilot/pilot-message.ts
// Renders a single TimelineEntry in the unified activity timeline.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { TimelineEntry, PilotPart } from "../../types.js";
import { tokenStyles } from "../../styles/tokens.js";
import "./parts/part-text.js";
import "./parts/part-tool.js";
import "./parts/part-reasoning.js";
import "./parts/part-subtask.js";
import "./parts/part-compaction.js";
import "./parts/part-question.js";
import "./parts/part-image.js";
import "./parts/part-artifact.js";
import "./parts/part-suggestion.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimelineTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return `${hh}:${mm}`;
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mo} ${hh}:${mm}`;
}

function formatCost(usd: number): string {
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd >= 0.001) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function shortModel(model: string): string {
  const slash = model.lastIndexOf("/");
  return slash !== -1 ? model.slice(slash + 1) : model;
}

/** Channel badges for cross-channel messages */
const CHANNEL_BADGES: Record<string, { label: string; color: string }> = {
  telegram: { label: "TG", color: "#0088cc" },
  api: { label: "API", color: "var(--text-muted)" },
  cli: { label: "CLI", color: "var(--text-muted)" },
  internal: { label: "INT", color: "var(--text-muted)" },
};

// ---------------------------------------------------------------------------
// Icon & color mapping per kind
// ---------------------------------------------------------------------------

interface KindMeta {
  icon: string;
  bg: string;
}

const KIND_META: Record<string, KindMeta> = {
  user_chat: { icon: "\u{1F4AC}", bg: "var(--accent-subtle)" },
  agent_text: { icon: "\u2B21", bg: "var(--bg-hover)" },
  a2a_sent: { icon: "\u2192\u2B21", bg: "rgba(236, 72, 153, 0.1)" },
  a2a_received: { icon: "\u2B21\u2192", bg: "rgba(236, 72, 153, 0.1)" },
  tool_call: { icon: "\u{1F6E0}", bg: "rgba(245, 158, 11, 0.1)" },
  reasoning: { icon: "\u{1F9E0}", bg: "rgba(139, 92, 246, 0.1)" },
  subtask: { icon: "\u{1F4E6}", bg: "rgba(59, 130, 246, 0.1)" },
  compaction: { icon: "\u2702", bg: "var(--bg-hover)" },
  image: { icon: "\u{1F5BC}", bg: "var(--bg-hover)" },
  suggestion: { icon: "\u2728", bg: "var(--bg-hover)" },
  artifact: { icon: "\u{1F4C4}", bg: "rgba(59, 130, 246, 0.1)" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-pilot-message")
export class PilotMessageEl extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .timeline-entry {
        display: grid;
        grid-template-columns: 52px 22px 1fr;
        gap: 0 8px;
        align-items: start;
        padding: 4px 0;
      }

      /* Timestamp column */
      .ts {
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--text-muted);
        padding-top: 2px;
        text-align: right;
        white-space: nowrap;
        user-select: none;
      }

      /* Icon column */
      .icon {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-size: 11px;
        flex-shrink: 0;
        margin-top: 1px;
        user-select: none;
      }

      /* Content column */
      .content {
        min-width: 0;
        overflow: hidden;
      }

      .source-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
        margin-bottom: 2px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .channel-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 5px;
        border-radius: 3px;
        letter-spacing: 0.04em;
        background: rgba(100, 116, 139, 0.12);
        color: var(--text-muted);
      }

      /* A2A styling */
      .a2a-content {
        border-left: 3px solid rgba(236, 72, 153, 0.5);
        padding: 4px 0 4px 10px;
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-primary);
        white-space: pre-wrap;
        word-break: break-word;
      }

      /* User text (no bubble, left-aligned) */
      .user-text {
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-primary);
        white-space: pre-wrap;
        word-break: break-word;
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 6px 10px;
        max-width: 85%;
      }

      /* Part container */
      .part-wrap {
        width: 100%;
      }

      /* Message footer (model, tokens, cost) */
      .message-footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 0 0;
        flex-wrap: wrap;
      }

      .footer-item {
        font-size: 10px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        white-space: nowrap;
      }

      .footer-sep {
        font-size: 10px;
        color: var(--bg-border);
      }

      .compaction-badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        background: rgba(79, 110, 247, 0.08);
        color: var(--accent);
        border: 1px solid var(--accent-border);
      }
    `,
  ];

  @property({ type: Object }) entry!: TimelineEntry;
  /** Map of subSessionId → subagent result, populated by parent from bus events */
  @property({ type: Object }) subagentResults: Record<
    string,
    { text?: string; steps?: number; tokens?: { input: number; output: number }; model?: string }
  > = {};
  /** Instance slug, passed down for API calls (e.g. question answers) */
  @property() slug = "";
  /** Current session's channel, used to show badge only for cross-channel messages */
  @property() sessionChannel = "web";

  // ── Part rendering (reuses existing part components) ────────────────────

  private _renderPart(part: PilotPart, allParts: PilotPart[]) {
    switch (part.type) {
      case "text":
        return html`<cp-pilot-part-text .content=${part.content ?? ""}></cp-pilot-part-text>`;

      case "image": {
        let mimeType = "image/jpeg";
        let filename = "";
        if (part.metadata) {
          try {
            const meta = JSON.parse(part.metadata) as { mimeType?: string; filename?: string };
            if (meta.mimeType) mimeType = meta.mimeType;
            if (meta.filename) filename = meta.filename;
          } catch {
            /* ignore */
          }
        }
        return html`<cp-pilot-part-image
          .data=${part.content ?? ""}
          .mimeType=${mimeType}
          .filename=${filename}
        ></cp-pilot-part-image>`;
      }

      case "tool_call": {
        let callId: string | undefined;
        try {
          const meta = part.metadata ? JSON.parse(part.metadata) : {};
          callId = (meta as { toolCallId?: string }).toolCallId;
        } catch {
          /* ignore */
        }
        const result = allParts.find(
          (p) =>
            p.type === "tool_result" &&
            (() => {
              try {
                return (
                  (JSON.parse(p.metadata ?? "{}") as { toolCallId?: string }).toolCallId === callId
                );
              } catch {
                return false;
              }
            })(),
        );
        let toolName: string | undefined;
        try {
          toolName = (JSON.parse(part.metadata ?? "{}") as { toolName?: string }).toolName;
        } catch {
          /* ignore */
        }
        if (toolName === "question") {
          return html`<cp-pilot-part-question
            .call=${part}
            .result=${result}
            .slug=${this.slug}
          ></cp-pilot-part-question>`;
        }
        if (toolName === "create_artifact") {
          return html`<cp-pilot-part-artifact
            .call=${part}
            .result=${result}
          ></cp-pilot-part-artifact>`;
        }
        return html`<cp-pilot-part-tool .call=${part} .result=${result}></cp-pilot-part-tool>`;
      }

      case "reasoning":
        return html`<cp-pilot-part-reasoning
          .content=${part.content ?? ""}
        ></cp-pilot-part-reasoning>`;

      case "subtask": {
        let subSessionId: string | undefined;
        try {
          subSessionId = (JSON.parse(part.metadata ?? "{}") as { subSessionId?: string })
            .subSessionId;
        } catch {
          /* ignore */
        }
        const subResult = subSessionId ? this.subagentResults[subSessionId] : undefined;
        return html`<cp-pilot-part-subtask
          .pilotPart=${part}
          .subagentResult=${subResult}
        ></cp-pilot-part-subtask>`;
      }

      case "compaction":
        return html`<cp-pilot-part-compaction
          .metadata=${part.metadata ?? ""}
        ></cp-pilot-part-compaction>`;

      case "suggestion":
        return html`<cp-pilot-part-suggestion
          .content=${part.content ?? "[]"}
        ></cp-pilot-part-suggestion>`;

      default:
        return nothing;
    }
  }

  // ── Content rendering per kind ──────────────────────────────────────────

  private _renderContent() {
    const e = this.entry;

    switch (e.kind) {
      case "user_chat": {
        const channel = e.channel;
        const badge =
          channel && channel !== "web" && channel !== this.sessionChannel
            ? CHANNEL_BADGES[channel]
            : undefined;
        const textPart = e.message.parts.find((p) => p.type === "text");
        const text = textPart?.content ?? "";
        return html`
          <div class="source-label">
            ${msg("You", { id: "role-user" })}
            ${badge
              ? html`<span class="channel-badge" style="color:${badge.color}">${badge.label}</span>`
              : nothing}
          </div>
          <div class="user-text">${text}</div>
        `;
      }

      case "agent_text":
        return html`
          <div class="source-label">
            ${e.source}
            ${e.message.isCompaction
              ? html`<span class="compaction-badge">compaction</span>`
              : nothing}
          </div>
          <div class="part-wrap">
            ${e.part
              ? html`<cp-pilot-part-text .content=${e.part.content ?? ""}></cp-pilot-part-text>`
              : nothing}
          </div>
          ${this._renderFooter()}
        `;

      case "a2a_sent":
        return html`
          <div class="source-label">${e.source} → ${e.a2aTarget}</div>
          <div class="a2a-content">${e.a2aContent}</div>
        `;

      case "a2a_received":
        return html`
          <div class="source-label">${e.a2aTarget} → ${e.source}</div>
          <div class="a2a-content">${e.a2aContent}</div>
        `;

      case "tool_call":
      case "artifact":
        return html`
          <div class="source-label">${e.source}</div>
          <div class="part-wrap">
            ${e.part ? this._renderPart(e.part, e.message.parts) : nothing}
          </div>
          ${this._renderFooter()}
        `;

      case "reasoning":
        return html`
          <div class="source-label">${e.source}</div>
          <div class="part-wrap">
            ${e.part
              ? html`<cp-pilot-part-reasoning
                  .content=${e.part.content ?? ""}
                ></cp-pilot-part-reasoning>`
              : nothing}
          </div>
          ${this._renderFooter()}
        `;

      case "subtask":
        return html`
          <div class="source-label">${e.source}</div>
          <div class="part-wrap">
            ${e.part ? this._renderPart(e.part, e.message.parts) : nothing}
          </div>
          ${this._renderFooter()}
        `;

      case "compaction":
        return html`
          <div class="part-wrap">
            ${e.part
              ? html`<cp-pilot-part-compaction
                  .metadata=${e.part.metadata ?? ""}
                ></cp-pilot-part-compaction>`
              : nothing}
          </div>
        `;

      case "image":
        return html`
          <div class="part-wrap">
            ${e.part ? this._renderPart(e.part, e.message.parts) : nothing}
          </div>
          ${this._renderFooter()}
        `;

      case "suggestion":
        return html`
          <div class="part-wrap">
            ${e.part
              ? html`<cp-pilot-part-suggestion
                  .content=${e.part.content ?? "[]"}
                ></cp-pilot-part-suggestion>`
              : nothing}
          </div>
        `;

      default:
        return nothing;
    }
  }

  // ── Footer (only on last entry of an assistant message) ─────────────────

  private _renderFooter() {
    const e = this.entry;
    if (!e.isLastInMessage) return nothing;

    const m = e.message;
    if (m.role !== "assistant") return nothing;

    const hasModel = Boolean(m.model);
    const hasTokens = m.tokensIn !== undefined || m.tokensOut !== undefined;
    if (!hasModel && !hasTokens && m.costUsd === undefined) return nothing;

    return html`
      <div class="message-footer">
        ${hasModel ? html`<span class="footer-item">${shortModel(m.model!)}</span>` : nothing}
        ${hasModel && (hasTokens || m.costUsd !== undefined)
          ? html`<span class="footer-sep">·</span>`
          : nothing}
        ${m.tokensIn !== undefined
          ? html`<span class="footer-item">${m.tokensIn.toLocaleString()} in</span>`
          : nothing}
        ${m.tokensOut !== undefined
          ? html`<span class="footer-item">${m.tokensOut.toLocaleString()} out</span>`
          : nothing}
        ${m.costUsd !== undefined && m.costUsd > 0
          ? html`<span class="footer-sep">·</span
              ><span class="footer-item">${formatCost(m.costUsd)}</span>`
          : nothing}
        ${m.finishReason && m.finishReason !== "stop"
          ? html`<span class="footer-sep">·</span
              ><span class="footer-item" style="color:var(--state-warning)"
                >${m.finishReason}</span
              >`
          : nothing}
      </div>
    `;
  }

  // ── Main render ─────────────────────────────────────────────────────────

  override render() {
    if (!this.entry) return nothing;

    const meta = KIND_META[this.entry.kind] ?? { icon: "\u2022", bg: "var(--bg-hover)" };

    return html`
      <div class="timeline-entry">
        <span class="ts">${formatTimelineTime(this.entry.timestamp)}</span>
        <span class="icon" style="background:${meta.bg}">${meta.icon}</span>
        <div class="content">${this._renderContent()}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-message": PilotMessageEl;
  }
}
