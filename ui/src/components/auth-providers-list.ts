import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";

/**
 * Login button for an SSO provider. Mirrors the server-side `LoginDescriptor`
 * type from `src/core/auth/provider.ts`.
 */
interface LoginDescriptor {
  id: string;
  kind: string;
  display_name: string;
  login_url: string;
}

/**
 * Renders the list of SSO login buttons advertised by the server through
 * `GET /api/auth/providers`. Hosted by `<cp-login-view>` above the password
 * form and renders nothing (no separator, no buttons) when the server returns
 * an empty list — which is always the case in Community.
 *
 * Enterprise editions register one or more SSO providers; each becomes one
 * button that navigates to the provider's `login_url` (typically the OIDC
 * authorization start endpoint).
 */
@localized()
@customElement("cp-auth-providers-list")
export class CpAuthProvidersList extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .providers {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .btn-provider {
        width: 100%;
        padding: 10px;
        min-height: 44px;
        background: var(--bg-base);
        color: var(--text-primary);
        border: 1px solid var(--bg-border);
        border-radius: 4px;
        font-size: var(--text-base);
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        transition:
          border-color 0.15s,
          background 0.15s;
      }

      .btn-provider:hover {
        border-color: var(--accent);
        background: var(--bg-hover);
      }

      .separator {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
        font-size: var(--text-sm);
        margin: 16px 0;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .separator::before,
      .separator::after {
        content: "";
        flex: 1;
        height: 1px;
        background: var(--bg-border);
      }
    `,
  ];

  @state() private _providers: LoginDescriptor[] = [];

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  private async _load(): Promise<void> {
    try {
      const res = await fetch("/api/auth/providers");
      if (!res.ok) return;
      const data = (await res.json()) as { providers?: LoginDescriptor[] };
      if (Array.isArray(data.providers)) {
        this._providers = data.providers;
      }
    } catch {
      // Endpoint failures must not block the password form. Community always
      // returns [] anyway, so a transient failure leaves the user with the
      // existing inline password login — that is the desired fallback.
    }
  }

  private _onClick(provider: LoginDescriptor): void {
    window.location.href = provider.login_url;
  }

  override render() {
    if (this._providers.length === 0) return nothing;
    return html`
      <div class="providers">
        ${this._providers.map(
          (p) => html`
            <button
              class="btn-provider"
              type="button"
              data-provider-id=${p.id}
              @click=${() => this._onClick(p)}
            >
              ${p.display_name}
            </button>
          `,
        )}
      </div>
      <div class="separator">${msg("or", { id: "login-providers-separator" })}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-auth-providers-list": CpAuthProvidersList;
  }
}
