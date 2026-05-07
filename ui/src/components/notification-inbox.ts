// ui/src/components/notification-inbox.ts
//
// Persistent notification inbox dropdown in the dashboard header.
// Bell icon with unread badge + scrollable panel with notification items.
// Real-time updates via WebSocket "notification" messages.

import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../api.js";
import { navigateToPath } from "../services/navigation.js";
import type { NotificationItem } from "../types.js";

// ---------------------------------------------------------------------------
// Severity colors (mapped to design tokens)
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  info: "var(--state-info, #0ea5e9)",
  warning: "var(--state-warning, #f59e0b)",
  error: "var(--state-error, #ef4444)",
  success: "var(--state-running, #10b981)",
};

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso + "Z").getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-notification-inbox")
export class NotificationInbox extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        position: relative;
        display: inline-flex;
        align-items: center;
      }

      /* ── Trigger button ─────────────────────────────────────────── */

      .bell-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: 1px solid transparent;
        border-radius: 5px;
        color: var(--text-muted);
        cursor: pointer;
        padding: 4px 8px;
        font-family: inherit;
        transition:
          border-color 0.15s,
          color 0.15s;
        position: relative;
      }
      .bell-btn:hover {
        border-color: var(--accent-border);
        color: var(--text-primary);
      }
      .bell-btn.open {
        border-color: var(--accent);
        color: var(--accent);
      }

      .badge {
        background: var(--state-error, #ef4444);
        color: #fff;
        font-size: 0.6rem;
        font-weight: 600;
        padding: 0 5px;
        border-radius: 999px;
        min-width: 14px;
        text-align: center;
        line-height: 1.4;
      }

      /* ── Dropdown panel ─────────────────────────────────────────── */

      .panel {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 380px;
        max-height: 420px;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        display: flex;
        flex-direction: column;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        z-index: 600;
        font-size: 0.8rem;
      }

      .panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--bg-border);
        flex-shrink: 0;
      }

      .panel-title {
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
      }

      .panel-btn {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
      }
      .panel-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .panel-body {
        flex: 1;
        overflow-y: auto;
        padding: 4px 0;
      }

      .panel-empty {
        padding: 24px;
        text-align: center;
        color: var(--text-muted);
        font-style: italic;
      }

      /* ── Notification item ──────────────────────────────────────── */

      .notif-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        border-left: 3px solid transparent;
        transition: background 0.1s;
      }
      .notif-item:hover {
        background: var(--bg-hover);
      }
      .notif-item.unread {
        border-left-color: var(--accent);
      }

      .notif-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        margin-top: 4px;
      }

      .notif-content {
        flex: 1;
        min-width: 0;
      }

      .notif-title {
        color: var(--text-primary);
        font-size: 0.8rem;
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .notif-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
        font-size: 0.7rem;
        color: var(--text-muted);
      }

      .notif-slug {
        background: var(--bg-hover);
        padding: 1px 5px;
        border-radius: 3px;
        font-family: var(--font-mono, monospace);
        font-size: 0.65rem;
      }

      /* ── Load more ──────────────────────────────────────────────── */

      .load-more {
        display: flex;
        justify-content: center;
        padding: 8px;
        border-top: 1px solid var(--bg-border);
        flex-shrink: 0;
      }

      .load-more-btn {
        background: none;
        border: 1px solid var(--bg-border);
        color: var(--text-secondary);
        cursor: pointer;
        padding: 4px 12px;
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
      }
      .load-more-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }
    `,
  ];

  @state() private _open = false;
  @state() private _notifications: NotificationItem[] = [];
  @state() private _unreadCount = 0;
  @state() private _loading = false;
  @state() private _nextCursor: number | null = null;

  private _onDocumentClick: ((e: MouseEvent) => void) | null = null;
  private _wsHandler: ((e: Event) => void) | null = null;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();

    // Fetch initial unread count
    void this._fetchUnreadCount();

    // Close panel on outside click
    this._onDocumentClick = (e: MouseEvent) => {
      if (this._open && !this.contains(e.target as Node)) {
        this._open = false;
      }
    };
    document.addEventListener("click", this._onDocumentClick, true);

    // Listen for real-time WS notifications
    this._wsHandler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === "notification" && msg.payload) {
        const notif = msg.payload as NotificationItem;
        this._notifications = [notif, ...this._notifications];
        this._unreadCount++;
      }
    };
    window.addEventListener("cp-ws-message", this._wsHandler);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._onDocumentClick) {
      document.removeEventListener("click", this._onDocumentClick, true);
      this._onDocumentClick = null;
    }
    if (this._wsHandler) {
      window.removeEventListener("cp-ws-message", this._wsHandler);
      this._wsHandler = null;
    }
  }

  // -------------------------------------------------------------------------
  // API calls
  // -------------------------------------------------------------------------

  private async _fetchUnreadCount(): Promise<void> {
    try {
      const data = await fetchUnreadCount();
      this._unreadCount = data.count;
    } catch {
      // Ignore — badge will show 0
    }
  }

  private async _fetchNotifications(cursor?: number): Promise<void> {
    this._loading = true;
    try {
      const page = await fetchNotifications(cursor, 20);
      if (cursor) {
        this._notifications = [...this._notifications, ...page.notifications];
      } else {
        this._notifications = page.notifications;
      }
      this._nextCursor = page.nextCursor;
    } catch {
      // Ignore — show empty state
    } finally {
      this._loading = false;
    }
  }

  private async _markRead(id: number): Promise<void> {
    try {
      await markNotificationRead(id);
      this._notifications = this._notifications.map((n) =>
        n.id === id ? { ...n, is_read: 1 } : n,
      );
      this._unreadCount = Math.max(0, this._unreadCount - 1);
    } catch {
      // Ignore
    }
  }

  private async _markAllRead(): Promise<void> {
    try {
      await markAllNotificationsRead();
      this._notifications = this._notifications.map((n) => ({ ...n, is_read: 1 }));
      this._unreadCount = 0;
    } catch {
      // Ignore
    }
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  private _toggle(): void {
    this._open = !this._open;
    if (this._open) {
      void this._fetchNotifications();
    }
  }

  private _onItemClick(notif: NotificationItem): void {
    // Mark as read
    if (!notif.is_read) {
      void this._markRead(notif.id);
    }
    // Navigate if link available
    if (notif.link_route) {
      navigateToPath(notif.link_route);
      this._open = false;
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  override render() {
    return html`
      <button
        class="bell-btn ${this._open ? "open" : ""}"
        title=${msg("Notifications", { id: "inbox-bell-title" })}
        @click=${this._toggle}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        ${this._unreadCount > 0
          ? html`<span class="badge">${this._unreadCount > 99 ? "99+" : this._unreadCount}</span>`
          : nothing}
      </button>

      ${this._open ? this._renderPanel() : nothing}
    `;
  }

  private _renderPanel() {
    return html`
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">${msg("Notifications", { id: "inbox-title" })}</span>
          ${this._unreadCount > 0
            ? html`
                <button class="panel-btn" @click=${this._markAllRead}>
                  ${msg("Mark all read", { id: "inbox-mark-all" })}
                </button>
              `
            : nothing}
        </div>
        <div class="panel-body">
          ${this._notifications.length === 0
            ? html`<div class="panel-empty">${msg("No notifications", { id: "inbox-empty" })}</div>`
            : this._notifications.map((n) => this._renderItem(n))}
        </div>
        ${this._nextCursor !== null
          ? html`
              <div class="load-more">
                <button
                  class="load-more-btn"
                  ?disabled=${this._loading}
                  @click=${() => void this._fetchNotifications(this._nextCursor!)}
                >
                  ${msg("Load more", { id: "inbox-load-more" })}
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderItem(n: NotificationItem) {
    const color = SEVERITY_COLORS[n.severity] ?? SEVERITY_COLORS.info;
    return html`
      <div class="notif-item ${n.is_read ? "" : "unread"}" @click=${() => this._onItemClick(n)}>
        <span class="notif-dot" style="background: ${color}"></span>
        <div class="notif-content">
          <div class="notif-title" title=${n.title}>${n.title}</div>
          <div class="notif-meta">
            <span>${timeAgo(n.created_at)}</span>
            ${n.instance_slug ? html`<span class="notif-slug">${n.instance_slug}</span>` : nothing}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-notification-inbox": NotificationInbox;
  }
}
