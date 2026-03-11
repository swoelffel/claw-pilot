import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceInfo, OpenClawUpdateStatus } from "../types.js";
import { fetchInstances, fetchUpdateStatus, triggerUpdate } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";
import "./instance-card.js";
import "./create-dialog.js";
import "./delete-instance-dialog.js";
import "./update-banner.js";
import "./discover-dialog.js";

@localized()
@customElement("cp-cluster-view")
export class ClusterView extends LitElement {
  static override styles = [
    tokenStyles,
    sectionLabelStyles,
    errorBannerStyles,
    buttonStyles,
    css`
      :host {
        display: block;
        padding: 24px;
      }

      .section-title {
        margin-bottom: 20px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 16px;
      }

      .empty {
        text-align: center;
        padding: 60px 20px;
        color: var(--text-muted);
        font-size: 15px;
      }

      .empty-icon {
        font-size: 40px;
        margin-bottom: 12px;
      }

      .empty-actions {
        margin-top: 20px;
      }

      .loading {
        text-align: center;
        padding: 60px 20px;
        color: var(--text-muted);
        font-size: 14px;
      }

      .error-banner {
        margin-bottom: 20px;
      }

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
      }
    `,
  ];

  @property({ type: Array }) instances: InstanceInfo[] = [];

  @state() private _loading = true;
  @state() private _error = "";
  @state() private _showCreateDialog = false;
  @state() private _deleteTarget: InstanceInfo | null = null;
  @state() private _showDiscoverDialog = false;
  @state() private _updateStatus: OpenClawUpdateStatus | null = null;

  private _pollInterval: ReturnType<typeof setInterval> | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this._load();
    this._loadUpdateStatus();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopPolling();
  }

  private _stopPolling(): void {
    if (this._pollInterval !== null) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  private _startPolling(): void {
    if (this._pollInterval !== null) return;
    this._pollInterval = setInterval(() => {
      this._loadUpdateStatus();
    }, 2_000);
  }

  private async _loadUpdateStatus(): Promise<void> {
    try {
      const status = await fetchUpdateStatus();
      this._updateStatus = status;

      if (status.status === "running") {
        this._startPolling();
      } else {
        if (this._pollInterval !== null) {
          this._stopPolling();
          // Refresh la liste des instances apres update reussi
          if (status.status === "done") {
            await this._load();
          }
        }
      }
    } catch {
      // Silencieux — pas critique si le check echoue
    }
  }

  private async _handleUpdateStart(): Promise<void> {
    try {
      await triggerUpdate();
      await this._loadUpdateStatus();
    } catch (err) {
      // Affiche l'erreur dans le banner via _updateStatus
      this._updateStatus = {
        currentVersion: this._updateStatus?.currentVersion ?? null,
        latestVersion: this._updateStatus?.latestVersion ?? null,
        updateAvailable: this._updateStatus?.updateAvailable ?? false,
        status: "error",
        message: userMessage(err),
      };
    }
  }

  private async _load(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      const data = await fetchInstances();
      this.instances = data;
      // Notify parent of loaded instances for badge count
      this.dispatchEvent(
        new CustomEvent("instances-loaded", {
          detail: data,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private _onNavigate(e: Event): void {
    const detail = (e as CustomEvent<Record<string, unknown>>).detail;
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    if (this._loading) {
      return html`<div class="loading">
        ${msg("Loading instances...", { id: "loading-instances" })}
      </div>`;
    }

    return html`
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}

      <cp-update-banner
        .status=${this._updateStatus}
        @cp-update-action=${this._handleUpdateStart}
      ></cp-update-banner>

      <div class="section-header">
        <div class="section-title">
          ${this.instances.length}
          ${this.instances.length !== 1
            ? msg("instances", { id: "instance-count-many" })
            : msg("instance", { id: "instance-count-one" })}
        </div>
        <button
          class="btn btn-primary"
          @click=${() => {
            this._showCreateDialog = true;
          }}
        >
          ${msg("+ New Instance", { id: "btn-new-instance" })}
        </button>
      </div>

      ${this.instances.length === 0
        ? html`
            <div class="empty">
              <div class="empty-icon">&#9634;</div>
              ${msg("No instances found", { id: "no-instances-found" })}
              <div class="empty-actions">
                <button
                  class="btn btn-secondary"
                  @click=${() => {
                    this._showDiscoverDialog = true;
                  }}
                >
                  ${msg("Discover instances", { id: "discover-btn" })}
                </button>
              </div>
            </div>
          `
        : html`
            <div class="grid">
              ${this.instances.map(
                (inst) => html`
                  <cp-instance-card
                    .instance=${inst}
                    .openclawVersion=${this._updateStatus?.currentVersion ?? null}
                    @navigate=${this._onNavigate}
                    @request-delete=${(e: CustomEvent<{ slug: string }>) => {
                      this._deleteTarget =
                        this.instances.find((i) => i.slug === e.detail.slug) ?? null;
                    }}
                  ></cp-instance-card>
                `,
              )}
            </div>
          `}
      ${this._showCreateDialog
        ? html`
            <cp-create-dialog
              @close-dialog=${() => {
                this._showCreateDialog = false;
              }}
              @instance-created=${() => {
                this._showCreateDialog = false;
                this._load();
              }}
            ></cp-create-dialog>
          `
        : ""}
      ${this._deleteTarget
        ? html`
            <cp-delete-instance-dialog
              .instance=${this._deleteTarget}
              @close-dialog=${() => {
                this._deleteTarget = null;
              }}
              @instance-deleted=${() => {
                this._deleteTarget = null;
                this._load();
              }}
            ></cp-delete-instance-dialog>
          `
        : ""}
      ${this._showDiscoverDialog
        ? html`
            <cp-discover-dialog
              @close-dialog=${() => {
                this._showDiscoverDialog = false;
              }}
              @instances-adopted=${() => {
                this._showDiscoverDialog = false;
                void this._load();
              }}
            ></cp-discover-dialog>
          `
        : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-cluster-view": ClusterView;
  }
}
