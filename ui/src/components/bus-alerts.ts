// ui/src/components/bus-alerts.ts
// Toasts d'alertes bus live — doom-loop, heartbeat, provider failover, timeouts
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";

type AlertVariant = "warning" | "error" | "info";

interface Toast {
  id: string;
  variant: AlertVariant;
  icon: string;
  title: string;
  body: string;
  persistent: boolean;
  showView: boolean;
  sessionId: string | undefined;
  slug: string | undefined;
  createdAt: number;
  timerId: ReturnType<typeof setTimeout> | undefined;
}

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 8000;

@localized()
@customElement("cp-bus-alerts")
export class BusAlerts extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        position: fixed;
        bottom: 100px;
        right: 24px;
        z-index: 9998;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      }

      .toast {
        pointer-events: all;
        width: 360px;
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        animation: slide-in 0.2s ease-out;
      }

      @keyframes slide-in {
        from {
          transform: translateX(20px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      .toast.warning {
        border-left: 3px solid var(--state-warning);
      }
      .toast.error {
        border-left: 3px solid var(--state-error);
      }
      .toast.info {
        border-left: 3px solid var(--state-info);
      }

      .toast-inner {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 14px;
      }

      .toast-icon {
        font-size: 16px;
        flex-shrink: 0;
        margin-top: 1px;
      }

      .toast-icon.warning {
        color: var(--state-warning);
      }
      .toast-icon.error {
        color: var(--state-error);
      }
      .toast-icon.info {
        color: var(--state-info);
      }

      .toast-content {
        flex: 1;
        min-width: 0;
      }

      .toast-title {
        font-size: 12px;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: 2px;
      }

      .toast-body {
        font-size: 11px;
        color: var(--text-secondary);
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .toast-actions {
        display: flex;
        gap: 6px;
        margin-top: 6px;
      }

      .btn-toast-view {
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--state-warning);
        background: rgba(245, 158, 11, 0.08);
        color: var(--state-warning);
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
        font-family: var(--font-ui);
      }

      .btn-toast-view:hover {
        background: rgba(245, 158, 11, 0.15);
      }

      .btn-toast-close {
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 14px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        flex-shrink: 0;
        transition: color 0.15s;
        margin-top: 1px;
      }

      .btn-toast-close:hover {
        color: var(--text-primary);
      }
    `,
  ];

  @state() private _toasts: Toast[] = [];

  // ── Public API — appelé depuis app.ts via ref ou event ────────────────────

  addAlert(event: { type: string; payload: Record<string, unknown>; slug?: string }): void {
    const { type, payload, slug } = event;

    type ToastInit = {
      variant: AlertVariant;
      icon: string;
      title: string;
      body: string;
      persistent: boolean;
      showView: boolean;
      sessionId: string | undefined;
      slug: string | undefined;
    };

    let init: ToastInit | null = null;

    switch (type) {
      case "tool.doom_loop":
        init = {
          variant: "warning",
          icon: "⚠",
          title: msg("Doom loop detected", { id: "alert-doom-loop-title" }),
          body: `${msg("Agent", { id: "alert-agent" })}: ${String(payload.agentId ?? "?")}`,
          persistent: true,
          showView: false,
          sessionId: undefined,
          slug,
        };
        break;

      case "heartbeat.alert":
        init = {
          variant: "warning",
          icon: "♥",
          title: msg("Heartbeat alert", { id: "alert-heartbeat-title" }),
          body: String(payload.text ?? ""),
          persistent: true,
          showView: true,
          sessionId: String(payload.sessionId ?? ""),
          slug,
        };
        break;

      case "provider.failover":
        init = {
          variant: "info",
          icon: "↺",
          title: msg("Provider failover", { id: "alert-failover-title" }),
          body: `${String(payload.providerId ?? "?")} — ${String(payload.reason ?? "")}`,
          persistent: false,
          showView: false,
          sessionId: undefined,
          slug,
        };
        break;

      case "provider.auth_failed":
        init = {
          variant: "error",
          icon: "✕",
          title: msg("Provider auth failed", { id: "alert-auth-failed-title" }),
          body: `${String(payload.providerId ?? "?")} — ${String(payload.reason ?? "")}`,
          persistent: true,
          showView: false,
          sessionId: undefined,
          slug,
        };
        break;

      case "llm.chunk_timeout":
        init = {
          variant: "warning",
          icon: "⏱",
          title: msg("LLM chunk timeout", { id: "alert-chunk-timeout-title" }),
          body: `${msg("Agent", { id: "alert-agent" })}: ${String(payload.agentId ?? "?")}`,
          persistent: false,
          showView: false,
          sessionId: undefined,
          slug,
        };
        break;

      case "agent.timeout":
        init = {
          variant: "error",
          icon: "⏱",
          title: msg("Agent timeout", { id: "alert-agent-timeout-title" }),
          body: `${String(payload.agentId ?? "?")}`,
          persistent: true,
          showView: false,
          sessionId: undefined,
          slug,
        };
        break;

      default:
        return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newToast: Toast = { ...init, id, createdAt: Date.now(), timerId: undefined };

    if (!newToast.persistent) {
      newToast.timerId = setTimeout(() => this._dismiss(id), AUTO_DISMISS_MS);
    }

    // FIFO — retire le plus ancien si on dépasse MAX_TOASTS
    let next = [...this._toasts, newToast];
    if (next.length > MAX_TOASTS) {
      const removed = next.shift();
      if (removed?.timerId) clearTimeout(removed.timerId);
    }
    this._toasts = next;
  }

  private _dismiss(id: string): void {
    const toast = this._toasts.find((t) => t.id === id);
    if (toast?.timerId) clearTimeout(toast.timerId);
    this._toasts = this._toasts.filter((t) => t.id !== id);
  }

  override render() {
    if (this._toasts.length === 0) return nothing;

    return html`
      ${this._toasts.map(
        (toast) => html`
          <div class="toast ${toast.variant}">
            <div class="toast-inner">
              <span class="toast-icon ${toast.variant}">${toast.icon}</span>
              <div class="toast-content">
                <div class="toast-title">${toast.title}</div>
                <div class="toast-body" title=${toast.body}>${toast.body}</div>
                ${toast.showView
                  ? html`
                      <div class="toast-actions">
                        <button
                          class="btn-toast-view"
                          @click=${() => {
                            this.dispatchEvent(
                              new CustomEvent("navigate-to-session", {
                                detail: { sessionId: toast.sessionId, slug: toast.slug },
                                bubbles: true,
                                composed: true,
                              }),
                            );
                            this._dismiss(toast.id);
                          }}
                        >
                          ${msg("View", { id: "alert-btn-view" })}
                        </button>
                      </div>
                    `
                  : nothing}
              </div>
              <button
                class="btn-toast-close"
                @click=${() => this._dismiss(toast.id)}
                aria-label=${msg("Close", { id: "alert-btn-close" })}
              >
                ✕
              </button>
            </div>
          </div>
        `,
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-bus-alerts": BusAlerts;
  }
}
