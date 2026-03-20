import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceInfo } from "../types.js";
import { startInstance, stopInstance, restartInstance } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { badgeStyles, buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-instance-card")
export class InstanceCard extends LitElement {
  static override styles = [
    tokenStyles,
    badgeStyles,
    buttonStyles,
    css`
      :host {
        display: block;
      }

      .card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: 10px;
        padding: 16px 18px 14px;
        position: relative;
      }

      /* ── Header ─────────────────────────────────────────── */

      .card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
      }

      .card-header-left {
        min-width: 0;
      }

      .display-name {
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .slug {
        font-size: 11px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        margin-top: 2px;
      }

      .card-header-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      /* ── Status bar ──────────────────────────────────────── */

      .status-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        padding: 7px 0;
        border-top: 1px solid var(--bg-border);
        border-bottom: 1px solid var(--bg-border);
        margin-bottom: 10px;
        min-height: 32px;
      }

      .status-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--text-muted);
      }

      .status-item.ok {
        color: var(--state-running);
      }

      .status-item.warn {
        color: var(--state-warning);
      }

      .status-item.error {
        color: var(--state-error);
      }

      .telegram-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: #0088cc18;
        color: #0088cc;
        border: 1px solid #0088cc35;
        border-radius: var(--radius-sm);
        padding: 2px 7px;
        font-size: 11px;
      }

      .telegram-pill.warn {
        background: rgba(245, 158, 11, 0.1);
        color: var(--state-warning);
        border-color: rgba(245, 158, 11, 0.3);
      }

      .agents-count {
        font-size: 12px;
        color: var(--text-muted);
      }

      .perm-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(239, 68, 68, 0.1);
        color: var(--state-error);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: var(--radius-sm);
        padding: 2px 7px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s;
      }

      .perm-pill:hover {
        background: rgba(239, 68, 68, 0.18);
      }

      /* ── Meta (model + tech) ─────────────────────────────── */

      .meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .model-row {
        font-size: 13px;
        color: var(--text-secondary);
        font-family: var(--font-mono);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tech-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .port-value {
        font-size: 11px;
        color: var(--text-muted);
        font-family: var(--font-mono);
      }

      /* ── Spinner (transitioning states) ─────────────────── */

      @keyframes cp-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .spinner {
        display: inline-block;
        width: 8px;
        height: 8px;
        border: 1.5px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: cp-spin 0.7s linear infinite;
        flex-shrink: 0;
      }

      /* ── Menu popover ────────────────────────────────────── */

      .menu-anchor {
        position: relative;
      }

      .btn-menu {
        width: 28px;
        height: 28px;
        border-radius: var(--radius-sm);
        border: 1px solid transparent;
        background: transparent;
        color: var(--text-muted);
        font-size: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
        letter-spacing: 0.05em;
      }

      .btn-menu:hover,
      .btn-menu.open {
        color: var(--text-primary);
        border-color: var(--bg-border);
        background: var(--bg-hover);
      }

      .menu-popover {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        min-width: 164px;
        z-index: 100;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        font-size: 13px;
        color: var(--text-secondary);
        cursor: pointer;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        text-decoration: none;
        transition: background 0.1s;
        font-family: var(--font-ui);
      }

      .menu-item:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .menu-item:disabled {
        opacity: 0.4;
        cursor: default;
      }

      .menu-item:disabled:hover {
        background: none;
        color: var(--text-secondary);
      }

      .menu-item.danger {
        color: var(--state-error);
      }

      .menu-item.danger:hover {
        background: color-mix(in srgb, var(--state-error) 8%, transparent);
      }

      .menu-item.stop {
        color: var(--state-error);
      }

      .menu-item.stop:hover {
        background: color-mix(in srgb, var(--state-error) 8%, transparent);
      }

      .menu-item.start {
        color: var(--state-running);
      }

      .menu-item.start:hover {
        background: color-mix(in srgb, var(--state-running) 8%, transparent);
      }

      .menu-icon {
        font-size: 14px;
        width: 16px;
        text-align: center;
        flex-shrink: 0;
      }

      .menu-separator {
        height: 1px;
        background: var(--bg-border);
        margin: 3px 0;
      }

      /* ── Error ───────────────────────────────────────────── */

      .error-msg {
        margin-top: 8px;
        font-size: 11px;
        color: var(--state-error);
      }
    `,
  ];

  @property({ type: Object }) instance!: InstanceInfo;

  @state() private _loading = false;
  @state() private _error = "";
  @state() private _menuOpen = false;

  private _onDocClick = (e: MouseEvent) => {
    if (!this.shadowRoot?.contains(e.target as Node)) {
      this._menuOpen = false;
    }
  };

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._onDocClick);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._onDocClick);
  }

  private async _action(e: Event, fn: (slug: string) => Promise<void>): Promise<void> {
    e.stopPropagation();
    this._menuOpen = false;
    this._loading = true;
    this._error = "";
    try {
      await fn(this.instance.slug);
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private _stateClass(): string {
    if (this.instance.transitioning) return this.instance.transitioning;
    return this.instance.state ?? "unknown";
  }

  private _stateLabel(): string {
    if (this.instance.transitioning === "starting")
      return msg("Starting", { id: "state-starting" });
    if (this.instance.transitioning === "stopping")
      return msg("Stopping", { id: "state-stopping" });
    return this.instance.state ?? "unknown";
  }

  /** Handles JSON-stringified objects like {"primary":"provider/model"} */
  private _resolveModel(raw: string | null): string | null {
    if (!raw) return null;
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return (parsed["primary"] as string | undefined) ?? raw;
      } catch {
        return raw;
      }
    }
    return raw;
  }

  private _navigate(view: string, extra?: Record<string, unknown>) {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view, slug: this.instance.slug, ...extra },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderStatusBar() {
    const inst = this.instance;
    const items = [];

    // Gateway health — only show if degraded or running
    if (inst.state === "running") {
      if (inst.gateway === "unhealthy") {
        items.push(html`<span class="status-item error">◎ Gateway KO</span>`);
      } else if (inst.gateway === "healthy") {
        items.push(html`<span class="status-item ok">◉ Gateway</span>`);
      }
    }

    // Telegram
    if (inst.telegram_bot) {
      const isDisconnected = inst.telegram === "disconnected";
      items.push(html`
        <span class="telegram-pill ${isDisconnected ? "warn" : ""}">
          ✈ ${inst.telegram_bot}${isDisconnected ? " ⚠" : ""}
        </span>
      `);
    }

    // Agent count
    if (inst.agentCount !== undefined && inst.agentCount > 0) {
      items.push(html`
        <span class="agents-count">
          ⬡ ${inst.agentCount}
          ${inst.agentCount === 1
            ? msg("agent", { id: "meta-agent" })
            : msg("agents", { id: "meta-agents" })}
        </span>
      `);
    }

    // Pending permissions — badge ⚠ PERM (Sprint 1)
    if (inst.pendingPermissions && inst.pendingPermissions > 0) {
      items.push(html`
        <button
          class="perm-pill"
          @click=${(e: Event) => {
            e.stopPropagation();
            this._navigate("pilot");
          }}
        >
          ⚠ PERM
        </button>
      `);
    }

    if (items.length === 0) {
      // Rien à afficher — on masque la barre
      return nothing;
    }

    return html`<div class="status-bar">${items}</div>`;
  }

  private _renderMenu() {
    const inst = this.instance;
    const isRunning = inst.state === "running";

    return html`
      <div class="menu-popover" @click=${(e: Event) => e.stopPropagation()}>
        <button
          class="menu-item ${isRunning ? "stop" : "start"}"
          ?disabled=${this._loading}
          @click=${(e: Event) => this._action(e, isRunning ? stopInstance : startInstance)}
        >
          <span class="menu-icon">${isRunning ? "■" : "▶"}</span>
          ${isRunning ? msg("Stop", { id: "btn-stop" }) : msg("Start", { id: "btn-start" })}
        </button>

        <div class="menu-separator"></div>

        ${isRunning
          ? html`
              <button
                class="menu-item"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._menuOpen = false;
                  this._navigate("pilot");
                }}
              >
                <span class="menu-icon">⚡</span>
                Pilot
              </button>
            `
          : nothing}
        ${isRunning || (inst.agentCount ?? 0) > 0
          ? html`
              <button
                class="menu-item"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._menuOpen = false;
                  this._navigate("agents-builder");
                }}
              >
                <span class="menu-icon">⬡</span>
                ${msg("Agents", { id: "meta-agents" })}
              </button>
            `
          : nothing}

        <button
          class="menu-item"
          @click=${(e: Event) => {
            e.stopPropagation();
            this._menuOpen = false;
            this._navigate("instance-settings");
          }}
        >
          <span class="menu-icon">⚙</span>
          ${msg("Settings", { id: "btn-settings" })}
        </button>

        ${isRunning
          ? html`
              <button
                class="menu-item"
                ?disabled=${this._loading}
                @click=${(e: Event) => this._action(e, restartInstance)}
              >
                <span class="menu-icon">↺</span>
                ${msg("Restart", { id: "btn-restart" })}
              </button>
            `
          : nothing}

        <div class="menu-separator"></div>

        <button
          class="menu-item danger"
          @click=${(e: Event) => {
            e.stopPropagation();
            this._menuOpen = false;
            this.dispatchEvent(
              new CustomEvent("request-delete", {
                detail: { slug: inst.slug },
                bubbles: true,
                composed: true,
              }),
            );
          }}
        >
          <span class="menu-icon">✕</span>
          ${msg("Delete", { id: "btn-delete" })}
        </button>
      </div>
    `;
  }

  override render() {
    const inst = this.instance;
    const stateClass = this._stateClass();
    const model = this._resolveModel(inst.default_model);
    const label = inst.display_name || inst.slug;
    const showSlug = !!inst.display_name;

    return html`
      <div class="card">
        <!-- Header -->
        <div class="card-header">
          <div class="card-header-left">
            <div class="display-name">${label}</div>
            ${showSlug ? html`<div class="slug">${inst.slug}</div>` : nothing}
          </div>
          <div class="card-header-right">
            <span class="badge ${stateClass}">
              ${this.instance.transitioning
                ? html`<span class="spinner"></span>`
                : html`<span class="state-dot"></span>`}
              ${this._stateLabel()}
            </span>
            <div class="menu-anchor">
              <button
                class="btn-menu ${this._menuOpen ? "open" : ""}"
                aria-label="More actions"
                aria-expanded=${this._menuOpen}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._menuOpen = !this._menuOpen;
                }}
              >
                ···
              </button>
              ${this._menuOpen ? this._renderMenu() : nothing}
            </div>
          </div>
        </div>

        <!-- Status bar -->
        ${this._renderStatusBar()}

        <!-- Meta -->
        <div class="meta">
          ${model ? html`<div class="model-row">${model}</div>` : nothing}
          <div class="tech-row">
            <span class="port-value">:${inst.port}</span>
          </div>
        </div>

        ${this._error ? html`<div class="error-msg">${this._error}</div>` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-card": InstanceCard;
  }
}
