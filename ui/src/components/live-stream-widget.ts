// ui/src/components/live-stream-widget.ts
// Live event stream dropdown — opens from the header nav bar.
// Renders a dropdown panel with SSE events when expanded.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { getEventsStreamUrl } from "../api.js";
import { getToken } from "../services/auth-state.js";
import type { LiveStreamEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS = 200;
const SSE_RECONNECT_INITIAL_MS = 1_000;
const SSE_RECONNECT_MULTIPLIER = 2;
const SSE_RECONNECT_MAX_MS = 30_000;

const LEVEL_COLORS: Record<string, string> = {
  info: "#60a5fa",
  warn: "#fb923c",
  error: "#f87171",
};

function fmtTimeShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-live-stream-widget")
export class LiveStreamWidget extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        position: relative;
        display: inline-flex;
        align-items: center;
      }

      /* ── Trigger button (in header) ─────────────────────────────── */

      .live-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: none;
        border: 1px solid transparent;
        border-radius: 5px;
        color: var(--text-muted);
        font-size: 12px;
        cursor: pointer;
        padding: 4px 8px;
        font-family: inherit;
        transition:
          border-color 0.15s,
          color 0.15s;
      }
      .live-btn:hover {
        border-color: var(--accent-border);
        color: var(--text-primary);
      }
      .live-btn.open {
        border-color: var(--accent);
        color: var(--accent);
      }

      .ws-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .ws-dot.connected {
        background: #34d399;
      }
      .ws-dot.disconnected {
        background: #94a3b8;
      }

      .badge {
        background: var(--accent);
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
        width: 420px;
        height: 340px;
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
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
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
        padding: var(--space-2);
      }

      .event-line {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        padding: 2px 0;
        line-height: 1.4;
      }

      .ev-time {
        color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
        flex-shrink: 0;
        font-size: 0.7rem;
      }

      .ev-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
        align-self: center;
      }

      .ev-type {
        font-weight: 500;
        color: var(--text-secondary);
        flex-shrink: 0;
        font-size: 0.7rem;
      }

      .ev-summary {
        color: var(--text-primary);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.75rem;
      }

      .empty-state {
        text-align: center;
        color: var(--text-secondary);
        padding: var(--space-4);
      }
    `,
  ];

  @property() slug = "";
  /** Whether the WS monitor connection is active (passed from parent). */
  @property({ type: Boolean }) wsConnected = false;

  @state() private _open = false;
  @state() private _events: LiveStreamEvent[] = [];
  @state() private _newCount = 0;
  @state() private _paused = false;
  @state() private _sseConnected = false;

  private _eventSource: EventSource | null = null;
  private _reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = SSE_RECONNECT_INITIAL_MS;
  private _onVisibilityChange: (() => void) | null = null;
  private _onDocumentClick: ((e: MouseEvent) => void) | null = null;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    this._onVisibilityChange = () => {
      if (document.visibilityState === "visible" && this.slug && !this._sseConnected) {
        this._scheduleReconnect(0);
      }
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);

    // Close panel on outside click
    this._onDocumentClick = (e: MouseEvent) => {
      if (this._open && !this.contains(e.target as Node)) {
        this._open = false;
      }
    };
    document.addEventListener("click", this._onDocumentClick, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._closeStream();
    if (this._onVisibilityChange) {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    if (this._onDocumentClick) {
      document.removeEventListener("click", this._onDocumentClick, true);
      this._onDocumentClick = null;
    }
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug")) {
      const prevSlug = changed.get("slug") as string | undefined;
      if (this.slug && this.slug !== prevSlug) {
        this._closeStream();
        this._events = [];
        this._newCount = 0;
        this._openStream();
      } else if (!this.slug) {
        this._closeStream();
        this._events = [];
        this._newCount = 0;
        this._open = false;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // SSE
  // ---------------------------------------------------------------------------

  private _openStream(): void {
    this._closeStream();
    if (!this.slug) return;

    const token = getToken();
    const baseUrl = getEventsStreamUrl(this.slug);
    const url = token
      ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : baseUrl;

    const es = new EventSource(url);
    this._eventSource = es;

    es.onopen = () => {
      this._sseConnected = true;
      this._reconnectDelay = SSE_RECONNECT_INITIAL_MS;
    };

    es.onmessage = (e: MessageEvent) => {
      let event: LiveStreamEvent;
      try {
        event = JSON.parse(e.data as string) as LiveStreamEvent;
      } catch {
        return;
      }
      this._pushEvent(event);
    };

    es.addEventListener("ping", () => {
      this._sseConnected = true;
    });

    es.onerror = () => {
      this._sseConnected = false;
      this._closeStream();
      this._scheduleReconnect(this._reconnectDelay);
      this._reconnectDelay = Math.min(
        this._reconnectDelay * SSE_RECONNECT_MULTIPLIER,
        SSE_RECONNECT_MAX_MS,
      );
    };
  }

  private _closeStream(): void {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = null;
    }
  }

  private _scheduleReconnect(delayMs: number): void {
    if (this._reconnectTimeout) clearTimeout(this._reconnectTimeout);
    this._reconnectTimeout = setTimeout(() => {
      this._reconnectTimeout = null;
      this._openStream();
    }, delayMs);
  }

  private _pushEvent(event: LiveStreamEvent): void {
    const next = [...this._events, event];
    if (next.length > MAX_EVENTS) next.splice(0, next.length - MAX_EVENTS);
    this._events = next;

    if (!this._open) {
      this._newCount++;
    }

    if (this._open && !this._paused) {
      this.updateComplete.then(() => {
        const body = this.shadowRoot?.querySelector(".panel-body");
        if (body) body.scrollTop = body.scrollHeight;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private _toggle(): void {
    this._open = !this._open;
    if (this._open) {
      this._newCount = 0;
      this.updateComplete.then(() => {
        const body = this.shadowRoot?.querySelector(".panel-body");
        if (body) body.scrollTop = body.scrollHeight;
      });
    }
  }

  private _clear(): void {
    this._events = [];
    this._newCount = 0;
  }

  private _togglePause(): void {
    this._paused = !this._paused;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /** The effective connection state: SSE connected (when instance selected) or WS connected. */
  private get _connected(): boolean {
    return this.slug ? this._sseConnected : this.wsConnected;
  }

  override render() {
    return html`
      <button class="live-btn ${this._open ? "open" : ""}" @click=${this._toggle}>
        <span class="ws-dot ${this._connected ? "connected" : "disconnected"}"></span>
        ${this._connected ? msg("Live", { id: "ws-live" }) : msg("Offline", { id: "ws-offline" })}
        ${this._newCount > 0 ? html`<span class="badge">${this._newCount}</span>` : nothing}
      </button>
      ${this._open && this.slug ? this._renderPanel() : nothing}
    `;
  }

  private _renderPanel() {
    return html`
      <div class="panel">
        <div class="panel-header">
          <span class="ws-dot ${this._sseConnected ? "connected" : "disconnected"}"></span>
          <span class="panel-title">${msg("Live", { id: "live.panel-title" })}</span>
          <button
            class="panel-btn"
            @click=${this._togglePause}
            title=${this._paused ? "Play" : "Pause"}
          >
            ${this._paused ? "▶" : "⏸"}
          </button>
          <button class="panel-btn" @click=${this._clear} title="Clear">✕</button>
        </div>
        <div class="panel-body">
          ${this._events.length === 0
            ? html`<div class="empty-state">${msg("No events yet", { id: "live.empty" })}</div>`
            : this._events.map((ev) => this._renderEventLine(ev))}
        </div>
      </div>
    `;
  }

  private _renderEventLine(ev: LiveStreamEvent) {
    return html`
      <div class="event-line">
        <span class="ev-time">${fmtTimeShort(ev.timestamp)}</span>
        <span class="ev-dot" style="background:${LEVEL_COLORS[ev.level] ?? "#94a3b8"}"></span>
        <span class="ev-type">${ev.type}</span>
        <span class="ev-summary">${ev.summary}</span>
      </div>
    `;
  }
}
