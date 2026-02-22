import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { InstanceInfo, WsMessage } from "./types.js";
import "./components/cluster-view.js";
import "./components/instance-detail.js";

declare global {
  interface Window {
    __CP_TOKEN__?: string;
  }
}

type Route =
  | { view: "cluster" }
  | { view: "instance"; slug: string };

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
      min-height: calc(100vh - 56px);
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
                  ${instanceCount} instance${instanceCount !== 1 ? "s" : ""}
                </span>
              `
            : ""}
        </div>
        <div class="header-right">
          <div class="ws-indicator">
            <span
              class="ws-dot ${this._wsConnected ? "connected" : "disconnected"}"
            ></span>
            ${this._wsConnected ? "Live" : "Offline"}
          </div>
        </div>
      </header>

      <main>
        ${this._renderMain()}
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-app": CpApp;
  }
}
