import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { InstanceInfo } from "../types.js";
import { fetchInstances } from "../api.js";
import "./instance-card.js";
import "./create-dialog.js";

@customElement("cp-cluster-view")
export class ClusterView extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 24px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.08em;
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
      color: #4a5568;
      font-size: 15px;
    }

    .empty-icon {
      font-size: 40px;
      margin-bottom: 12px;
    }

    .loading {
      text-align: center;
      padding: 60px 20px;
      color: #4a5568;
      font-size: 14px;
    }

    .error-banner {
      background: #ef444420;
      border: 1px solid #ef444440;
      border-radius: 8px;
      padding: 12px 16px;
      color: #ef4444;
      font-size: 13px;
      margin-bottom: 20px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }

    .btn-new {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #6c63ff;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-new:hover { background: #7c73ff; }
  `;

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
      this._error = err instanceof Error ? err.message : "Failed to load instances";
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
      return html`<div class="loading">Loading instances...</div>`;
    }

    return html`
      ${this._error
        ? html`<div class="error-banner">${this._error}</div>`
        : ""}

      <div class="section-header">
        <div class="section-title">
          ${this.instances.length} instance${this.instances.length !== 1 ? "s" : ""}
        </div>
        <button class="btn-new" @click=${() => { this._showCreateDialog = true; }}>
          + New Instance
        </button>
      </div>

      ${this.instances.length === 0
        ? html`
            <div class="empty">
              <div class="empty-icon">&#9634;</div>
              No instances found
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
