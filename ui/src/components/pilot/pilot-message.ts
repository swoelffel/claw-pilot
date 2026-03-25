// ui/src/components/pilot/pilot-message.ts
// Renders a single message with all its parts + metadata footer.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotMessage, PilotPart } from "../../types.js";
import { tokenStyles } from "../../styles/tokens.js";
import "./parts/part-text.js";
import "./parts/part-tool.js";
import "./parts/part-reasoning.js";
import "./parts/part-subtask.js";
import "./parts/part-compaction.js";
import "./parts/part-question.js";
import "./parts/part-image.js";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return msg("just now", { id: "time-just-now" });
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}${msg("m ago", { id: "time-min" })}`;
  if (diff < 86_400_000)
    return `${Math.floor(diff / 3_600_000)}${msg("h ago", { id: "time-hour" })}`;
  return `${Math.floor(diff / 86_400_000)}${msg("d ago", { id: "time-day" })}`;
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

@localized()
@customElement("cp-pilot-message")
export class PilotMessageEl extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .message-wrap {
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      /* User messages — right-aligned bubble */
      .message-wrap.user {
        align-items: flex-end;
      }

      .message-wrap.assistant {
        align-items: flex-start;
        max-width: 100%;
      }

      /* Message header */
      .message-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
        padding: 0 2px;
      }

      .role-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
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

      .compaction-badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        background: rgba(79, 110, 247, 0.08);
        color: var(--accent);
        border: 1px solid var(--accent-border);
      }

      /* User bubble */
      .user-bubble {
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 9px 13px;
        font-size: 13px;
        color: var(--text-primary);
        white-space: pre-wrap;
        word-break: break-word;
        max-width: 80%;
        line-height: 1.5;
      }

      /* Assistant parts container */
      .assistant-parts {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
      }

      /* Message footer */
      .message-footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 2px 0;
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
    `,
  ];

  @property({ type: Object }) message!: PilotMessage;
  /** Map of subSessionId → subagent result, populated by parent from bus events */
  @property({ type: Object }) subagentResults: Record<
    string,
    { text?: string; steps?: number; tokens?: { input: number; output: number }; model?: string }
  > = {};
  /** Instance slug, passed down for API calls (e.g. question answers) */
  @property() slug = "";
  /** Current session's channel, used to show badge only for cross-channel messages */
  @property() sessionChannel = "web";

  private _renderUserMessage() {
    const msg_ = this.message;
    const channel = (msg_ as unknown as { channel?: string }).channel;
    const badge =
      channel && channel !== "web" && channel !== this.sessionChannel
        ? CHANNEL_BADGES[channel]
        : undefined;

    return html`
      <div class="message-wrap user">
        <div class="message-header">
          <span class="role-label">${msg("You", { id: "role-user" })}</span>
          ${badge
            ? html`<span class="channel-badge" style="color:${badge.color}">${badge.label}</span>`
            : nothing}
        </div>
        <div class="user-bubble">${this._getUserText()}</div>
      </div>
    `;
  }

  private _getUserText(): string {
    // User messages: look for a text part, fallback to content field
    const textPart = this.message.parts.find((p) => p.type === "text");
    if (textPart?.content) return textPart.content;
    // Legacy: some user messages stored directly
    return "";
  }

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
        // Find associated tool_result by toolCallId in metadata
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
        // Render question tool as interactive card instead of generic tool block
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
        return html`<cp-pilot-part-tool .call=${part} .result=${result}></cp-pilot-part-tool>`;
      }

      case "tool_result":
        // tool_results are rendered inline with their tool_call — skip standalone render
        return nothing;

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

      default:
        return nothing;
    }
  }

  private _renderAssistantMessage() {
    const m = this.message;
    const parts = [...m.parts].sort((a, b) => a.sortOrder - b.sortOrder);
    const hasModel = Boolean(m.model);
    const hasTokens = m.tokensIn !== undefined || m.tokensOut !== undefined;

    return html`
      <div class="message-wrap assistant">
        <div class="message-header">
          <span class="role-label">${m.agentId ?? msg("agent", { id: "role-agent" })}</span>
          ${m.isCompaction ? html`<span class="compaction-badge">compaction</span>` : nothing}
        </div>

        <div class="assistant-parts">${parts.map((p) => this._renderPart(p, parts))}</div>

        ${hasModel || hasTokens || m.costUsd !== undefined
          ? html`
              <div class="message-footer">
                ${hasModel
                  ? html`<span class="footer-item">${shortModel(m.model!)}</span>`
                  : nothing}
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
                <span class="footer-sep">·</span>
                <span class="footer-item">${relativeTime(m.createdAt)}</span>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  override render() {
    if (!this.message) return nothing;
    return this.message.role === "user"
      ? this._renderUserMessage()
      : this._renderAssistantMessage();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-message": PilotMessageEl;
  }
}
