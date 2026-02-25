import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceInfo } from "../types.js";
import { fetchInstances } from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";
import "./instance-card.js";
import "./create-dialog.js";

@localized()
@customElement("cp-cluster-view")
export class ClusterView extends LitElement {
  static styles = [tokenStyles, sectionLabelStyles, errorBannerStyles, buttonStyles, css`
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
  `];

  @property({ type: Array }) instances: InstanceInfo[] = [];

  @state() private _loading = true;
  @state() private _error = "";
  @state() private _showCreateDialog = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this._load();
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
      this._error = err instanceof Error ? err.message : msg("Failed to load instances", { id: "error-load-instances" });
    } finally {
      this._loading = false;
    }
  }

  private _onNavigate(e: Event): void {
    const slug = (e as CustomEvent<{ slug: string }>).detail.slug;
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { slug },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    if (this._loading) {
      return html`<div class="loading">${msg("Loading instances...", { id: "loading-instances" })}</div>`;
    }

    return html`
      ${this._error
        ? html`<div class="error-banner">${this._error}</div>`
        : ""}

      <div class="section-header">
        <div class="section-title">
          ${this.instances.length} ${this.instances.length !== 1
            ? msg("instances", { id: "instance-count-many" })
            : msg("instance", { id: "instance-count-one" })}
        </div>
        <button class="btn btn-primary" @click=${() => { this._showCreateDialog = true; }}>
          ${msg("+ New Instance", { id: "btn-new-instance" })}
        </button>
      </div>

      ${this.instances.length === 0
        ? html`
            <div class="empty">
              <div class="empty-icon">&#9634;</div>
              ${msg("No instances found", { id: "no-instances-found" })}
            </div>
          `
        : html`
            <div class="grid">
              ${this.instances.map(
                (inst) => html`
                  <cp-instance-card
                    .instance=${inst}
                    @navigate=${this._onNavigate}
                  ></cp-instance-card>
                `,
              )}
            </div>
          `}

      ${this._showCreateDialog
        ? html`
            <cp-create-dialog
              @close-dialog=${() => { this._showCreateDialog = false; }}
              @instance-created=${() => {
                this._showCreateDialog = false;
                this._load();
              }}
            ></cp-create-dialog>
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
