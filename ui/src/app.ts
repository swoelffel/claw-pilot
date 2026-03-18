import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import {
  initLocale,
  switchLocale,
  getLocale,
  allLocales,
  type SupportedLocale,
} from "./localization.js";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import type { InstanceInfo, WsMessage, HealthUpdate, SelfUpdateStatus } from "./types.js";
import { fetchBlueprints } from "./api.js";
import { tokenStyles } from "./styles/tokens.js";
import { setToken, clearToken } from "./services/auth-state.js";
import { WsMonitor } from "./services/ws-monitor.js";
import { UpdatePoller } from "./services/update-poller.js";
import { hashToRoute, routeToHash, type Route } from "./services/router.js";
import "./components/cluster-view.js";
import "./components/agents-builder.js";
import "./components/blueprints-view.js";
import "./components/blueprint-builder.js";
import "./components/instance-settings.js";
import "./components/runtime-pilot.js";
import "./components/self-update-banner.js";
import "./components/login-view.js";
import "./components/permission-request-overlay.js";
import "./components/bus-alerts.js";

// Initialize locale — resolved before first render via localeReady promise
export const localeReady = initLocale();

declare global {
  const __APP_VERSION__: string;
}

@localized()
@customElement("cp-app")
export class CpApp extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        width: 100%;
        max-width: 100vw;
        overflow-x: hidden;
        min-height: 100vh;
        background: var(--bg-base);
        color: var(--text-primary);
        font-family: var(--font-ui);
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
        height: 56px;
        background: var(--bg-surface);
        border-bottom: 1px solid var(--bg-border);
        position: sticky;
        top: 0;
        z-index: 100;
        gap: 8px;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
        flex: 1;
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
        color: var(--text-muted);
      }

      .ws-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        transition: background 0.3s;
      }

      .ws-dot.connected {
        background: var(--state-success);
        box-shadow: 0 0 6px var(--state-success);
      }

      .ws-dot.disconnected {
        background: var(--text-muted);
      }

      main {
        min-height: calc(100vh - 56px - 48px);
        overflow-x: hidden;
      }

      footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        min-height: 48px;
        background: var(--bg-surface);
        border-top: 1px solid var(--bg-border);
        font-size: 12px;
        color: var(--text-muted);
        flex-wrap: wrap;
        gap: 8px;
      }

      .footer-left,
      .footer-right {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .footer-brand {
        font-weight: 600;
        color: var(--text-secondary);
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
        color: var(--accent);
      }

      .lang-wrapper {
        position: relative;
      }

      .lang-trigger {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: none;
        border: 1px solid var(--bg-border);
        border-radius: 5px;
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        padding: 3px 8px;
        letter-spacing: 0.04em;
        transition:
          border-color 0.15s,
          color 0.15s;
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
        box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.5);
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
        transition:
          background 0.1s,
          color 0.1s;
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

      .nav-tabs {
        display: flex;
        align-items: center;
        gap: 2px;
        margin-left: 8px;
        flex-shrink: 0;
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
        transition:
          color 0.15s,
          border-color 0.15s;
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

      .btn-logout {
        display: inline-flex;
        align-items: center;
        background: none;
        border: 1px solid var(--bg-border);
        border-radius: 5px;
        color: var(--text-muted);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        padding: 4px 10px;
        font-family: inherit;
        flex-shrink: 0;
        transition:
          border-color 0.15s,
          color 0.15s;
      }

      .btn-logout:hover {
        border-color: var(--state-error);
        color: var(--state-error);
      }

      /* ── Responsive ───────────────────────────────────────────────────────── */

      @media (max-width: 640px) {
        header {
          height: auto;
          min-height: 56px;
          padding: 8px 12px;
          flex-wrap: wrap;
          row-gap: 4px;
        }

        .header-left {
          gap: 8px;
        }

        .nav-tabs {
          margin-left: 0;
        }

        .nav-tab {
          height: 40px;
          padding: 0 8px;
          font-size: 12px;
        }

        .logo {
          font-size: 15px;
        }

        .ws-indicator {
          display: none;
        }

        main {
          min-height: calc(100vh - 104px - 48px);
        }

        footer {
          padding: 8px 12px;
        }

        .footer-left,
        .footer-right {
          gap: 10px;
        }
      }

      .auth-checking {
        display: block;
        min-height: 100vh;
        background: var(--bg-base);
      }
    `,
  ];

  @state() private _authenticated = false;
  @state() private _authChecking = true;
  @state() private _sessionExpired = false;
  @state() private _route: Route = { view: "cluster" };
  @state() private _instances: InstanceInfo[] = [];
  @state() private _blueprintCount: number | null = null;
  @state() private _wsConnected = false;
  @state() private _locale: SupportedLocale = getLocale() as SupportedLocale;
  @state() private _langOpen = false;
  @state() private _selfUpdateStatus: SelfUpdateStatus | null = null;

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

  /** Guard to prevent hash→route→hash feedback loops. */
  private _updatingHash = false;

  private _wsMonitor: WsMonitor | null = null;
  private _updatePoller: UpdatePoller | null = null;

  // ---------------------------------------------------------------------------
  // Hash-based routing
  // ---------------------------------------------------------------------------

  private _onHashChange = (): void => {
    if (this._updatingHash) return;
    this._route = hashToRoute(location.hash);
  };

  private _syncHashFromRoute(): void {
    const target = routeToHash(this._route);
    const current = location.hash.replace(/^#?\/?/, "");
    const targetNorm = target.replace(/^\//, "");
    if (current === targetNorm) return;
    this._updatingHash = true;
    location.hash = `#${target}`;
    this._updatingHash = false;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this._onDocClick);
    window.addEventListener("lit-localize-status", this._onLocaleStatus);
    window.addEventListener("cp:session-expired", this._onSessionExpired);
    void this._boot();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("hashchange", this._onHashChange);
    window.removeEventListener("cp:session-expired", this._onSessionExpired);
    window.removeEventListener("lit-localize-status", this._onLocaleStatus);
    document.removeEventListener("click", this._onDocClick);
    this._wsMonitor?.disconnect();
    this._updatePoller?.stop();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("_route")) {
      this._syncHashFromRoute();
    }
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  private _onSessionExpired = (): void => {
    this._authenticated = false;
    this._sessionExpired = true;
    clearToken();
    this._wsMonitor?.disconnect();
    this._wsMonitor = null;
  };

  private async _boot(): Promise<void> {
    await localeReady;
    await this._checkAuth();
    if (this._authenticated) {
      this._initApp();
    }
  }

  private async _checkAuth(): Promise<void> {
    this._authChecking = true;
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = (await res.json()) as { authenticated: boolean; token: string };
        if (data.authenticated && data.token) {
          setToken(data.token);
          this._authenticated = true;
        }
      }
    } catch {
      // Network error — not authenticated
    }
    this._authChecking = false;
  }

  private _onAuthenticated(e: Event): void {
    const { token } = (e as CustomEvent<{ token: string }>).detail;
    setToken(token);
    this._authenticated = true;
    this._sessionExpired = false;
    this._initApp();
  }

  private async _logout(): Promise<void> {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore errors — proceed with local logout
    }
    this._authenticated = false;
    this._sessionExpired = false;
    clearToken();
    window.removeEventListener("hashchange", this._onHashChange);
    this._wsMonitor?.disconnect();
    this._wsMonitor = null;
    this._updatePoller?.stop();
    this._updatePoller = null;
  }

  // ---------------------------------------------------------------------------
  // App initialization (post-auth)
  // ---------------------------------------------------------------------------

  private _initApp(): void {
    // Restore route from URL hash on first load
    this._route = hashToRoute(location.hash);
    window.addEventListener("hashchange", this._onHashChange);

    // Start WebSocket monitor
    this._wsMonitor = new WsMonitor(
      (msg) => this._handleWsMessage(msg),
      () => {
        this._wsConnected = true;
        // If a self-update was running and WS just reconnected, server restarted → reload
        if (this._selfUpdateStatus?.status === "running") {
          location.reload();
        }
      },
      () => {
        this._wsConnected = false;
      },
    );
    this._wsMonitor.connect();

    // Pre-fetch blueprint count so the badge is visible from the start
    void fetchBlueprints()
      .then((bps) => {
        this._blueprintCount = bps.length;
      })
      .catch(() => {});

    // Start self-update poller
    this._updatePoller = new UpdatePoller((status) => {
      this._selfUpdateStatus = status;
    });
    this._updatePoller.start();
  }

  // ---------------------------------------------------------------------------
  // WS message handler
  // ---------------------------------------------------------------------------

  private _handleWsMessage(msg: WsMessage): void {
    if (msg.type === "health_update") {
      const payload = msg.payload as HealthUpdate["payload"];
      const updates = payload.instances ?? [];
      if (updates.length > 0 && this._instances.length > 0) {
        let changed = false;
        const next = this._instances.map((inst) => {
          const update = updates.find((u) => u.slug === inst.slug);
          if (!update) return inst;
          const newState = update.state;
          const newAgentCount = update.agentCount ?? inst.agentCount;
          const newPendingPermissions = update.pendingPermissions ?? inst.pendingPermissions;
          const newTelegram = update.telegram ?? inst.telegram;
          if (
            inst.gateway === update.gateway &&
            inst.state === newState &&
            inst.agentCount === newAgentCount &&
            inst.pendingPermissions === newPendingPermissions &&
            inst.telegram === newTelegram
          ) {
            return inst;
          }
          changed = true;
          return {
            ...inst,
            gateway: update.gateway,
            state: newState,
            ...(newAgentCount !== undefined && { agentCount: newAgentCount }),
            ...(newPendingPermissions !== undefined && {
              pendingPermissions: newPendingPermissions,
            }),
            ...(newTelegram !== undefined && { telegram: newTelegram }),
          };
        });
        if (changed) {
          this._instances = next;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation & locale
  // ---------------------------------------------------------------------------

  private _navigate(e: Event): void {
    const detail = (
      e as CustomEvent<{
        slug?: string | null;
        view?: string;
        blueprintId?: number;
        section?: import("./types.js").SidebarSection;
      }>
    ).detail;
    if (detail.view === "instance-settings" && detail.slug) {
      this._route = {
        view: "instance-settings",
        slug: detail.slug,
        ...(detail.section !== undefined && { initialSection: detail.section }),
      };
    } else if (detail.view === "pilot" && detail.slug) {
      this._route = { view: "pilot", slug: detail.slug };
    } else if (detail.view === "agents-builder" && detail.slug) {
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
    this._instances = this._instances.filter((i) => i.slug !== slug);
    this._route = { view: "cluster" };
  }

  private _onSelfUpdateStart(): void {
    void this._updatePoller?.triggerUpdate();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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
          @blueprints-loaded=${(e: Event) => {
            this._blueprintCount = (e as CustomEvent<number>).detail;
          }}
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
    if (this._route.view === "instance-settings") {
      return html`
        <cp-instance-settings
          .slug=${this._route.slug}
          .initialSection=${this._route.initialSection ?? "general"}
          @navigate=${this._navigate}
        ></cp-instance-settings>
      `;
    }
    if (this._route.view === "pilot") {
      const pilotSlug = this._route.slug;
      return html`
        <div
          style="display:flex;flex-direction:column;height:calc(100vh - 56px - 48px);overflow:hidden;"
        >
          <div
            style="display:flex;align-items:center;gap:8px;padding:0 16px;min-height:48px;flex-wrap:wrap;background:var(--bg-surface);border-bottom:1px solid var(--bg-border);flex-shrink:0;"
          >
            <button
              style="background:none;border:none;color:var(--text-muted);font-size:13px;cursor:pointer;padding:4px 0;font-family:inherit;display:flex;align-items:center;gap:6px;transition:color 0.15s;white-space:nowrap;flex-shrink:0;"
              @click=${() => {
                this._route = { view: "cluster" };
              }}
            >
              ← ${msg("Back", { id: "settings-back" })}
            </button>
            <span style="color:var(--bg-border);font-size:14px;user-select:none;flex-shrink:0;"
              >/</span
            >
            <span
              style="font-size:13px;font-weight:600;color:var(--text-secondary);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;"
              title="${pilotSlug}"
              >${pilotSlug}</span
            >
            <span style="color:var(--bg-border);font-size:14px;user-select:none;flex-shrink:0;"
              >/</span
            >
            <span style="font-size:13px;font-weight:600;color:var(--text-primary);flex-shrink:0;"
              >Pilot</span
            >
          </div>
          <div style="flex:1;overflow:hidden;">
            <cp-runtime-pilot .slug=${pilotSlug}></cp-runtime-pilot>
          </div>
        </div>
      `;
    }
    return html``;
  }

  override render() {
    if (this._authChecking) {
      return html`<div class="auth-checking"></div>`;
    }

    if (!this._authenticated) {
      return html`
        <cp-login-view
          .sessionExpired=${this._sessionExpired}
          @authenticated=${this._onAuthenticated}
        ></cp-login-view>
      `;
    }

    const instanceCount = this._instances.length;

    return html`
      <header>
        <div class="header-left">
          <div class="logo" @click=${this._goHome}>Claw<span>Pilot</span></div>
          <nav class="nav-tabs">
            <button
              class="nav-tab ${this._route.view === "cluster" ||
              this._route.view === "agents-builder" ||
              this._route.view === "instance-settings" ||
              this._route.view === "pilot"
                ? "active"
                : ""}"
              @click=${() => {
                this._route = { view: "cluster" };
              }}
            >
              ${msg("Instances", { id: "nav-instances" })}${instanceCount > 0
                ? html`<span class="nav-badge">${instanceCount}</span>`
                : ""}
            </button>
            <button
              class="nav-tab ${this._route.view === "blueprints" ||
              this._route.view === "blueprint-builder"
                ? "active"
                : ""}"
              @click=${() => {
                this._route = { view: "blueprints" };
              }}
            >
              ${msg("Blueprints", { id: "nav-blueprints" })}${this._blueprintCount !== null &&
              this._blueprintCount > 0
                ? html`<span class="nav-badge">${this._blueprintCount}</span>`
                : ""}
            </button>
          </nav>
        </div>
        <div class="header-right">
          <div class="ws-indicator">
            <span class="ws-dot ${this._wsConnected ? "connected" : "disconnected"}"></span>
            ${this._wsConnected
              ? msg("Live", { id: "ws-live" })
              : msg("Offline", { id: "ws-offline" })}
          </div>
          <button class="btn-logout" @click=${this._logout}>
            ${msg("Sign out", { id: "app-btn-logout" })}
          </button>
        </div>
      </header>

      <main @cp-update-action=${this._onSelfUpdateStart}>
        <cp-self-update-banner .status=${this._selfUpdateStatus}></cp-self-update-banner>
        ${this._renderMain()}
      </main>

      ${"slug" in this._route && this._route.slug
        ? html`
            <cp-permission-request-overlay
              .instanceSlug=${this._route.slug}
            ></cp-permission-request-overlay>
          `
        : nothing}

      <cp-bus-alerts></cp-bus-alerts>

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
            >${msg("GitHub", { id: "footer-github" })}</a
          >
          <span class="footer-sep">·</span>
          <a
            class="footer-link"
            href="https://github.com/swoelffel/claw-pilot/issues"
            target="_blank"
            rel="noopener"
            >${msg("Issues", { id: "footer-issues" })}</a
          >
        </div>
        <div class="footer-right">
          <div class="lang-wrapper" ${ref(this._langWrapperRef)}>
            <button
              class="lang-trigger ${this._langOpen ? "open" : ""}"
              aria-label="Change language"
              @click=${(e: Event) => {
                e.stopPropagation();
                this._langOpen = !this._langOpen;
              }}
            >
              🌐 ${allLocales.find((l) => l.code === this._locale)?.label ?? "EN"}
              <span class="chevron">▾</span>
            </button>
            ${this._langOpen
              ? html`
                  <div class="lang-dropdown">
                    ${allLocales.map(
                      (l) => html`
                        <button
                          class="lang-option ${this._locale === l.code ? "active" : ""}"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this._switchLocale(l.code);
                            this._langOpen = false;
                          }}
                        >
                          <span class="flag">${l.flag}</span>
                          ${l.name}
                          <span class="check">✓</span>
                        </button>
                      `,
                    )}
                  </div>
                `
              : ""}
          </div>
          <span class="footer-sep">·</span>
          <span
            >© ${new Date().getFullYear()} SWO —
            ${msg("MIT License", { id: "footer-license" })}</span
          >
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
