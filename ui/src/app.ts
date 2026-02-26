import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { initLocale, switchLocale, getLocale, allLocales, type SupportedLocale } from "./localization.js";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import type { InstanceInfo, WsMessage } from "./types.js";
import { tokenStyles } from "./styles/tokens.js";
import "./components/cluster-view.js";
import "./components/agents-builder.js";
import "./components/blueprints-view.js";
import "./components/blueprint-builder.js";

// Initialize locale — resolved before first render via localeReady promise
export const localeReady = initLocale();

declare global {
  interface Window {
    __CP_TOKEN__?: string;
  }
  const __APP_VERSION__: string;
}

type Route =
  | { view: "cluster" }
  | { view: "agents-builder"; slug: string }
  | { view: "blueprints" }
  | { view: "blueprint-builder"; blueprintId: number };

@localized()
@customElement("cp-app")
export class CpApp extends LitElement {
  static styles = [tokenStyles, css`
    :host {
      display: block;
      min-height: 100vh;
      background: var(--bg-base);
      color: var(--text-primary);
      font-family: var(--font-ui);
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      height: 56px;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--bg-border);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .logo {
      font-size: 17px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.02em;
      cursor: pointer;
      user-select: none;
    }

    .logo span {
      color: var(--accent);
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ws-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .ws-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      transition: background 0.3s;
    }

    .ws-dot.connected {
      background: var(--state-running);
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
    }

    .ws-dot.disconnected {
      background: var(--state-error);
    }

    main {
      min-height: calc(100vh - 56px - 48px);
    }

    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 24px;
      height: 48px;
      background: var(--bg-surface);
      border-top: 1px solid var(--bg-border);
      font-size: 12px;
      color: var(--text-muted);
    }

    .footer-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .footer-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .footer-brand {
      font-weight: 600;
      color: var(--state-stopped);
      letter-spacing: -0.01em;
    }

    .footer-brand span {
      color: var(--accent);
    }

    .footer-version {
      background: var(--accent-subtle);
      color: var(--accent);
      border: 1px solid var(--accent-border);
      border-radius: var(--radius-sm);
      padding: 1px 7px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-mono);
    }

    .footer-sep {
      color: var(--bg-border);
    }

    .footer-link {
      color: var(--text-muted);
      text-decoration: none;
      transition: color 0.15s;
    }

    .footer-link:hover {
      color: var(--text-secondary);
    }

    .lang-trigger {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: none;
      border: 1px solid var(--bg-border);
      border-radius: 5px;
      color: var(--state-stopped);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      padding: 3px 8px;
      letter-spacing: 0.04em;
      transition: border-color 0.15s, color 0.15s;
      font-family: inherit;
      position: relative;
    }

    .lang-trigger:hover {
      border-color: var(--accent-border);
      color: var(--text-secondary);
    }

    .lang-trigger .chevron {
      font-size: 8px;
      opacity: 0.6;
      transition: transform 0.15s;
    }

    .lang-trigger.open .chevron {
      transform: rotate(180deg);
    }

    .lang-dropdown {
      position: absolute;
      bottom: calc(100% + 8px);
      right: 0;
      background: var(--bg-surface);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-md);
      box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
      min-width: 160px;
      overflow: hidden;
      z-index: 200;
    }

    .lang-option {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 9px 14px;
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 13px;
      cursor: pointer;
      text-align: left;
      transition: background 0.1s, color 0.1s;
      font-family: inherit;
      white-space: nowrap;
    }

    .lang-option:hover {
      background: var(--bg-border);
      color: var(--text-primary);
    }

    .lang-option.active {
      color: var(--accent);
    }

    .lang-option .check {
      margin-left: auto;
      font-size: 11px;
      opacity: 0;
    }

    .lang-option.active .check {
      opacity: 1;
    }

    .lang-option .flag {
      font-size: 15px;
      line-height: 1;
    }

    .lang-wrapper {
      position: relative;
    }

    .nav-tabs {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-left: 8px;
    }

    .nav-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      padding: 0 10px;
      height: 56px;
      transition: color 0.15s, border-color 0.15s;
      font-family: inherit;
      white-space: nowrap;
    }

    .nav-tab:hover {
      color: var(--text-primary);
    }

    .nav-tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    .nav-badge {
      display: inline-flex;
      align-items: center;
      background: var(--accent-subtle);
      color: var(--accent);
      border: 1px solid var(--accent-border);
      border-radius: 20px;
      padding: 1px 7px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.4;
    }

  `];

  @state() private _route: Route = { view: "cluster" };
  @state() private _instances: InstanceInfo[] = [];
  @state() private _wsConnected = false;
  @state() private _locale: SupportedLocale = getLocale() as SupportedLocale;
  @state() private _langOpen = false;

  private _langWrapperRef: Ref<HTMLElement> = createRef();
  private _onDocClick = (e: MouseEvent) => {
    const wrapper = this._langWrapperRef.value;
    if (wrapper && !wrapper.contains(e.target as Node)) {
      this._langOpen = false;
    }
  };
  private _onLocaleStatus = (e: Event) => {
    const detail = (e as CustomEvent<{ status: string; readyLocale?: string }>).detail;
    if (detail.status === "ready") {
      this._locale = getLocale() as SupportedLocale;
    }
  };

  private _ws: WebSocket | null = null;
  private _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this._connectWs();
    document.addEventListener("click", this._onDocClick);
    window.addEventListener("lit-localize-status", this._onLocaleStatus);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._ws?.close();
    if (this._wsReconnectTimer) clearTimeout(this._wsReconnectTimer);
    document.removeEventListener("click", this._onDocClick);
    window.removeEventListener("lit-localize-status", this._onLocaleStatus);
  }

  private _connectWs(): void {
    const token = window.__CP_TOKEN__ ?? "";
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`;

    try {
      this._ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this._ws.addEventListener("open", () => {
      this._wsConnected = true;
    });

    this._ws.addEventListener("close", () => {
      this._wsConnected = false;
      this._scheduleReconnect();
    });

    this._ws.addEventListener("error", () => {
      this._wsConnected = false;
    });

    this._ws.addEventListener("message", (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsMessage;
        this._handleWsMessage(msg);
        // Broadcast to child components via window event
        window.dispatchEvent(
          new CustomEvent("cp-ws-message", { detail: msg }),
        );
      } catch {
        // Ignore malformed messages
      }
    });
  }

  private _scheduleReconnect(): void {
    if (this._wsReconnectTimer) return;
    this._wsReconnectTimer = setTimeout(() => {
      this._wsReconnectTimer = null;
      this._connectWs();
    }, 5000);
  }

  private _handleWsMessage(msg: WsMessage): void {
    if (msg.type === "health_update") {
      const payload = msg.payload as {
        instances?: Array<{
          slug: string;
          gateway: "healthy" | "unhealthy" | "unknown";
          systemd: "active" | "inactive" | "failed" | "unknown";
        }>;
      };
      const updates = payload.instances ?? [];
      if (updates.length > 0 && this._instances.length > 0) {
        this._instances = this._instances.map((inst) => {
          const update = updates.find((u) => u.slug === inst.slug);
          if (!update) return inst;
          // Derive state from health
          const state: InstanceInfo["state"] =
            update.gateway === "healthy"
              ? "running"
              : update.systemd === "inactive"
                ? "stopped"
                : update.systemd === "failed"
                  ? "error"
                  : "unknown";
          return {
            ...inst,
            gateway: update.gateway,
            systemd: update.systemd,
            state,
          };
        });
      }
    }
  }

  private _navigate(e: Event): void {
    const detail = (e as CustomEvent<{ slug?: string | null; view?: string; blueprintId?: number }>).detail;
    if (detail.view === "agents-builder" && detail.slug) {
      this._route = { view: "agents-builder", slug: detail.slug };
    } else if (detail.view === "blueprints") {
      this._route = { view: "blueprints" };
    } else if (detail.view === "blueprint-builder" && detail.blueprintId !== undefined) {
      this._route = { view: "blueprint-builder", blueprintId: detail.blueprintId };
    } else {
      this._route = { view: "cluster" };
    }
  }

  private _goHome(): void {
    this._route = { view: "cluster" };
  }

  private async _switchLocale(locale: SupportedLocale): Promise<void> {
    if (locale === this._locale) return;
    await switchLocale(locale);
    this._locale = locale;
  }

  private _onInstanceDeleted(e: Event): void {
    const { slug } = (e as CustomEvent<{ slug: string }>).detail;
    // Remove from local instances list immediately (optimistic update)
    this._instances = this._instances.filter((i) => i.slug !== slug);
    // Navigate back to cluster view
    this._route = { view: "cluster" };
  }

  private _renderMain() {
    if (this._route.view === "cluster") {
      return html`
        <cp-cluster-view
          .instances=${this._instances}
          @navigate=${this._navigate}
          @instances-loaded=${(e: Event) => {
            this._instances = (e as CustomEvent<InstanceInfo[]>).detail;
          }}
        ></cp-cluster-view>
      `;
    }
    if (this._route.view === "agents-builder") {
      return html`
        <cp-agents-builder
          .slug=${this._route.slug}
          @navigate=${this._navigate}
        ></cp-agents-builder>
      `;
    }
    if (this._route.view === "blueprints") {
      return html`
        <cp-blueprints-view
          @navigate=${this._navigate}
        ></cp-blueprints-view>
      `;
    }
    if (this._route.view === "blueprint-builder") {
      return html`
        <cp-blueprint-builder
          .blueprintId=${this._route.blueprintId}
          @navigate=${this._navigate}
        ></cp-blueprint-builder>
      `;
    }
    return html``;
  }

  override render() {
    const instanceCount = this._instances.length;

    return html`
      <header>
        <div class="header-left">
          <div class="logo" @click=${this._goHome}>
            Claw<span>Pilot</span>
          </div>
          <nav class="nav-tabs">
            <button
              class="nav-tab ${this._route.view === "cluster" || this._route.view === "agents-builder" ? "active" : ""}"
              @click=${() => { this._route = { view: "cluster" }; }}
            >
              ${msg("Instances", { id: "nav-instances" })}
              ${instanceCount > 0 ? html`<span class="nav-badge">${instanceCount}</span>` : ""}
            </button>
            <button
              class="nav-tab ${this._route.view === "blueprints" || this._route.view === "blueprint-builder" ? "active" : ""}"
              @click=${() => { this._route = { view: "blueprints" }; }}
            >
              ${msg("Blueprints", { id: "nav-blueprints" })}
            </button>
          </nav>
        </div>
        <div class="header-right">
          <div class="ws-indicator">
            <span
              class="ws-dot ${this._wsConnected ? "connected" : "disconnected"}"
            ></span>
            ${this._wsConnected
              ? msg("Live", { id: "ws-live" })
              : msg("Offline", { id: "ws-offline" })}
          </div>
        </div>
      </header>

      <main>
        ${this._renderMain()}
      </main>

      <footer>
        <div class="footer-left">
          <span class="footer-brand">Claw<span>Pilot</span></span>
          <span class="footer-version">v${__APP_VERSION__}</span>
          <span class="footer-sep">·</span>
          <a
            class="footer-link"
            href="https://github.com/swoelffel/claw-pilot"
            target="_blank"
            rel="noopener"
          >${msg("GitHub", { id: "footer-github" })}</a>
          <span class="footer-sep">·</span>
          <a
            class="footer-link"
            href="https://github.com/swoelffel/claw-pilot/issues"
            target="_blank"
            rel="noopener"
          >${msg("Issues", { id: "footer-issues" })}</a>
        </div>
        <div class="footer-right">
          <div class="lang-wrapper" ${ref(this._langWrapperRef)}>
            <button
              class="lang-trigger ${this._langOpen ? "open" : ""}"
              aria-label="Change language"
              @click=${(e: Event) => { e.stopPropagation(); this._langOpen = !this._langOpen; }}
            >
              🌐 ${allLocales.find(l => l.code === this._locale)?.label ?? "EN"}
              <span class="chevron">▾</span>
            </button>
            ${this._langOpen ? html`
              <div class="lang-dropdown">
                ${allLocales.map(l => html`
                  <button
                    class="lang-option ${this._locale === l.code ? "active" : ""}"
                    @click=${(e: Event) => { e.stopPropagation(); this._switchLocale(l.code); this._langOpen = false; }}
                  >
                    <span class="flag">${l.flag}</span>
                    ${l.name}
                    <span class="check">✓</span>
                  </button>
                `)}
              </div>
            ` : ""}
          </div>
          <span class="footer-sep">·</span>
          <span>© ${new Date().getFullYear()} SWO — ${msg("MIT License", { id: "footer-license" })}</span>
        </div>
      </footer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-app": CpApp;
  }
}
