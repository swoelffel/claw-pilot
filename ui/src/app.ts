import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { initLocale, switchLocale, getLocale, allLocales, type SupportedLocale } from "./localization.js";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import type { InstanceInfo, WsMessage } from "./types.js";
import "./components/cluster-view.js";
import "./components/instance-detail.js";

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
  | { view: "instance"; slug: string };

@localized()
@customElement("cp-app")
export class CpApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      background: #0f1117;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, sans-serif;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      height: 56px;
      background: #1a1d27;
      border-bottom: 1px solid #2a2d3a;
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
      color: #e2e8f0;
      letter-spacing: -0.02em;
      cursor: pointer;
      user-select: none;
    }

    .logo span {
      color: #6c63ff;
    }

    .instance-badge {
      display: inline-flex;
      align-items: center;
      background: #6c63ff20;
      color: #6c63ff;
      border: 1px solid #6c63ff40;
      border-radius: 20px;
      padding: 2px 10px;
      font-size: 12px;
      font-weight: 600;
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
      color: #94a3b8;
    }

    .ws-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      transition: background 0.3s;
    }

    .ws-dot.connected {
      background: #10b981;
      box-shadow: 0 0 6px #10b98180;
    }

    .ws-dot.disconnected {
      background: #ef4444;
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
      background: #1a1d27;
      border-top: 1px solid #2a2d3a;
      font-size: 12px;
      color: #4a5568;
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
      color: #64748b;
      letter-spacing: -0.01em;
    }

    .footer-brand span {
      color: #6c63ff;
    }

    .footer-version {
      background: #6c63ff18;
      color: #6c63ff;
      border: 1px solid #6c63ff30;
      border-radius: 4px;
      padding: 1px 7px;
      font-size: 11px;
      font-weight: 600;
      font-family: "Fira Mono", monospace;
    }

    .footer-sep {
      color: #2a2d3a;
    }

    .footer-link {
      color: #4a5568;
      text-decoration: none;
      transition: color 0.15s;
    }

    .footer-link:hover {
      color: #94a3b8;
    }

    .lang-trigger {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: none;
      border: 1px solid #2a2d3a;
      border-radius: 5px;
      color: #64748b;
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
      border-color: #6c63ff60;
      color: #94a3b8;
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
      background: #1a1d27;
      border: 1px solid #2a2d3a;
      border-radius: 8px;
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
      color: #94a3b8;
      font-size: 13px;
      cursor: pointer;
      text-align: left;
      transition: background 0.1s, color 0.1s;
      font-family: inherit;
      white-space: nowrap;
    }

    .lang-option:hover {
      background: #2a2d3a;
      color: #e2e8f0;
    }

    .lang-option.active {
      color: #6c63ff;
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

  `;

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
    const { slug } = (e as CustomEvent<{ slug: string | null }>).detail;
    if (slug === null) {
      this._route = { view: "cluster" };
    } else {
      this._route = { view: "instance", slug };
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
    // view === "instance" — TypeScript narrows slug here
    return html`
      <cp-instance-detail
        .slug=${this._route.slug}
        @navigate=${this._navigate}
        @instance-deleted=${this._onInstanceDeleted}
      ></cp-instance-detail>
    `;
  }

  override render() {
    const instanceCount = this._instances.length;

    return html`
      <header>
        <div class="header-left">
          <div class="logo" @click=${this._goHome}>
            Claw<span>Pilot</span>
          </div>
          ${instanceCount > 0
            ? html`
                <span class="instance-badge">
                  ${instanceCount} ${instanceCount !== 1
                    ? msg("instances", { id: "instance-count-many" })
                    : msg("instance", { id: "instance-count-one" })}
                </span>
              `
            : ""}
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
              @click=${(e: Event) => { e.stopPropagation(); this._langOpen = !this._langOpen; }}
            >
              🌐 ${allLocales.find(l => l.code === this._locale)?.label ?? "EN"}
              <span class="chevron">▼</span>
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
