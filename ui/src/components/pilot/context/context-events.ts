// ui/src/components/pilot/context/context-events.ts
// Real-time event log: bus events that are not chat messages.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotBusEvent } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";

interface EventStyle {
  icon: string;
  color: string;
  summary: (payload: Record<string, unknown>) => string;
}

const EVENT_STYLES: Record<string, EventStyle> = {
  "permission.asked": {
    icon: "?",
    color: "var(--state-warning)",
    summary: (p) =>
      `allow ${String(p.toolName ?? p.permission ?? "")} ${String(p.pattern ?? "")}`.trim(),
  },
  "permission.replied": {
    icon: "✓",
    color: "var(--state-running)",
    summary: (p) => `${String(p.action ?? "")} ${String(p.permission ?? p.pattern ?? "")}`.trim(),
  },
  "provider.failover": {
    icon: "↺",
    color: "var(--state-info)",
    summary: (p) =>
      `${String(p.providerId ?? "")} ${String(p.fromProfileId ?? "")} → ${String(p.toProfileId ?? "")}`,
  },
  "provider.auth_failed": {
    icon: "✕",
    color: "var(--state-error)",
    summary: (p) => `${String(p.providerId ?? "")} — ${String(p.reason ?? "")}`,
  },
  "tool.doom_loop": {
    icon: "⚠",
    color: "var(--state-warning)",
    summary: (p) => `${String(p.toolName ?? "")} (3× same args)`,
  },
  "mcp.tools.changed": {
    icon: "⚙",
    color: "var(--text-muted)",
    summary: (p) => `${String(p.serverId ?? "")} — ${Number(p.toolCount ?? 0)} tools`,
  },
  "llm.chunk_timeout": {
    icon: "⏱",
    color: "var(--state-warning)",
    summary: (p) => `${String(p.agentId ?? "")} — ${Number(p.elapsedMs ?? 0)}ms`,
  },
  "agent.timeout": {
    icon: "⏱",
    color: "var(--state-error)",
    summary: (p) => `${String(p.agentId ?? "")} — ${Number(p.timeoutMs ?? 0)}ms`,
  },
  "subagent.completed": {
    icon: "⬡",
    color: "var(--state-running)",
    summary: (p) => {
      const result = p.result as
        | { steps?: number; tokens?: { input: number; output: number } }
        | undefined;
      return result
        ? `${result.steps ?? 0} steps · ${((result.tokens?.input ?? 0) + (result.tokens?.output ?? 0)).toLocaleString()} tok`
        : "";
    },
  },
  "session.created": {
    icon: "+",
    color: "var(--accent)",
    summary: (p) => `${String(p.agentId ?? "")} (${String(p.channel ?? "")})`,
  },
  "session.updated": {
    icon: "↑",
    color: "var(--text-muted)",
    summary: (p) => String(p.title ?? ""),
  },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

@localized()
@customElement("cp-pilot-context-events")
export class PilotContextEvents extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .events-header {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
        margin-bottom: 6px;
      }

      .events-list {
        display: flex;
        flex-direction: column;
        gap: 0;
        max-height: 200px;
        overflow-y: auto;
      }

      .event-row {
        display: grid;
        grid-template-columns: 52px 14px 1fr;
        align-items: baseline;
        gap: 6px;
        padding: 3px 0;
        border-bottom: 1px solid var(--bg-border);
        animation: slide-in 0.2s ease-out;
      }

      .event-row:last-child {
        border-bottom: none;
      }

      @keyframes slide-in {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .event-time {
        font-size: 9px;
        font-family: var(--font-mono);
        color: var(--text-muted);
        white-space: nowrap;
      }

      .event-icon {
        font-size: 11px;
        text-align: center;
      }

      .event-body {
        font-size: 11px;
        color: var(--text-secondary);
        overflow: hidden;
      }

      .event-type {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
      }

      .event-summary {
        color: var(--text-secondary);
        font-size: 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .empty {
        font-size: 11px;
        color: var(--text-muted);
        font-style: italic;
        padding: 4px 0;
      }
    `,
  ];

  @property({ type: Array }) events: PilotBusEvent[] = [];

  override render() {
    // Show most recent first
    const sorted = [...this.events].reverse();

    return html`
      <div class="events-header">
        ${msg("Event log", { id: "context-events-title" })}
        ${this.events.length > 0
          ? html`<span
              style="font-size:10px;font-weight:400;margin-left:6px;color:var(--text-muted)"
              >(${this.events.length})</span
            >`
          : nothing}
      </div>

      ${sorted.length === 0
        ? html`<div class="empty">${msg("No events yet", { id: "context-events-empty" })}</div>`
        : html`
            <div class="events-list">
              ${sorted.map((ev) => {
                const style = EVENT_STYLES[ev.type];
                const summary = style?.summary(ev.payload) ?? "";
                return html`
                  <div class="event-row">
                    <span class="event-time">${formatTime(ev.timestamp)}</span>
                    <span class="event-icon" style="color:${style?.color ?? "var(--text-muted)"}">
                      ${style?.icon ?? "·"}
                    </span>
                    <div class="event-body">
                      <div class="event-type">${ev.type}</div>
                      ${summary ? html`<div class="event-summary">${summary}</div>` : nothing}
                    </div>
                  </div>
                `;
              })}
            </div>
          `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-context-events": PilotContextEvents;
  }
}
