import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { initLocale } from "./localization.js";
import type { InstanceInfo, WsMessage } from "./types.js";
import "./components/cluster-view.js";
import "./components/instance-detail.js";

// Initialize locale once at module load (async, non-blocking)
initLocale();

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

  `;

  @state() private _route: Route = { view: "cluster" };
  @state() private _instances: InstanceInfo[] = [];
  @state() private _wsConnected = false;

  private _ws: WebSocket | null = null;
  private _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this._connectWs();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._ws?.close();
    if (this._wsReconnectTimer) clearTimeout(this._wsReconnectTimer);
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
