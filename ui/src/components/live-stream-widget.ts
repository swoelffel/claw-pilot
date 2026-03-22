// ui/src/components/live-stream-widget.ts
// Floating live event stream widget — pill (collapsed) or panel (expanded).
// Lives in cp-app, outside <main>, and survives navigation between instance pages.

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
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 500;
        font-size: 0.8rem;
      }

      /* ── Pill (collapsed) ───────────────────────────────────────── */

      .pill {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: 999px;
        padding: var(--space-1) var(--space-3);
        cursor: pointer;
        max-width: 320px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }
      .pill:hover {
        background: var(--bg-hover);
      }

      .conn-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .conn-dot.connected {
        background: #34d399;
      }
      .conn-dot.disconnected {
        background: #94a3b8;
      }

      .pill-text {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--text-secondary);
      }

      .badge {
        background: var(--accent);
        color: #fff;
        font-size: 0.65rem;
        font-weight: 600;
        padding: 0 6px;
        border-radius: 999px;
        min-width: 16px;
        text-align: center;
      }

      /* ── Panel (expanded) ───────────────────────────────────────── */

      .panel {
        width: 420px;
        height: 320px;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        display: flex;
        flex-direction: column;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
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

  @state() private _mode: "hidden" | "collapsed" | "expanded" = "hidden";
  @state() private _events: LiveStreamEvent[] = [];
  @state() private _newCount = 0;
  @state() private _paused = false;
  @state() private _sseConnected = false;

  private _eventSource: EventSource | null = null;
  private _reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = SSE_RECONNECT_INITIAL_MS;
  private _onVisibilityChange: (() => void) | null = null;

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
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._closeStream();
    if (this._onVisibilityChange) {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug")) {
      const prevSlug = changed.get("slug") as string | undefined;
      if (this.slug && this.slug !== prevSlug) {
        this._closeStream();
        this._events = [];
        this._newCount = 0;
        this._mode = "collapsed";
        this._openStream();
      } else if (!this.slug) {
        this._closeStream();
        this._mode = "hidden";
        this._events = [];
        this._newCount = 0;
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
    // Ring buffer
    const next = [...this._events, event];
    if (next.length > MAX_EVENTS) next.splice(0, next.length - MAX_EVENTS);
    this._events = next;

    if (this._mode === "collapsed") {
      this._newCount++;
    }

    // Auto-scroll if expanded and not paused
    if (this._mode === "expanded" && !this._paused) {
      this.updateComplete.then(() => {
        const body = this.shadowRoot?.querySelector(".panel-body");
        if (body) body.scrollTop = body.scrollHeight;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private _expand(): void {
    this._mode = "expanded";
    this._newCount = 0;
    this.updateComplete.then(() => {
      const body = this.shadowRoot?.querySelector(".panel-body");
      if (body) body.scrollTop = body.scrollHeight;
    });
  }

  private _collapse(): void {
    this._mode = "collapsed";
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

  override render() {
    if (this._mode === "hidden") return nothing;
    if (this._mode === "collapsed") return this._renderPill();
    return this._renderPanel();
  }

  private _renderPill() {
    const last = this._events[this._events.length - 1];
    return html`
      <div class="pill" @click=${this._expand}>
        <span class="conn-dot ${this._sseConnected ? "connected" : "disconnected"}"></span>
        <span class="pill-text">${last ? last.summary : msg("Live", { id: "live.title" })}</span>
        ${this._newCount > 0 ? html`<span class="badge">${this._newCount}</span>` : nothing}
      </div>
    `;
  }

  private _renderPanel() {
    return html`
      <div class="panel">
        <div class="panel-header">
          <span class="conn-dot ${this._sseConnected ? "connected" : "disconnected"}"></span>
          <span class="panel-title">${msg("Live", { id: "live.panel-title" })}</span>
          <button
            class="panel-btn"
            @click=${this._togglePause}
            title=${this._paused ? "Play" : "Pause"}
          >
            ${this._paused ? "▶" : "⏸"}
          </button>
          <button class="panel-btn" @click=${this._clear} title="Clear">✕</button>
          <button class="panel-btn" @click=${this._collapse} title="Collapse">▼</button>
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
