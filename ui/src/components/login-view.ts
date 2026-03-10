import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";

@localized()
@customElement("cp-login-view")
export class CpLoginView extends LitElement {
  static styles = [
    tokenStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        background: var(--bg-base);
      }

      .card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: 8px;
        padding: 32px;
        width: 100%;
        max-width: 360px;
      }

      .title {
        font-size: var(--text-xl);
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 24px;
        text-align: center;
        letter-spacing: -0.02em;
      }

      .title span {
        color: var(--accent);
      }

      .field {
        margin-bottom: 16px;
      }

      label {
        display: block;
        font-size: var(--text-sm);
        color: var(--text-secondary);
        margin-bottom: 4px;
      }

      input {
        width: 100%;
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: 4px;
        color: var(--text-primary);
        padding: 8px 12px;
        font-size: var(--text-base);
        box-sizing: border-box;
        font-family: inherit;
        transition: border-color 0.15s;
      }

      input:focus {
        outline: none;
        border-color: var(--accent);
      }

      .btn-submit {
        width: 100%;
        padding: 10px;
        min-height: 44px;
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: 4px;
        font-size: var(--text-base);
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        margin-top: 8px;
        transition: opacity 0.15s;
      }

      .btn-submit:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-submit:not(:disabled):hover {
        opacity: 0.9;
      }

      .error {
        color: var(--state-error);
        font-size: var(--text-sm);
        margin-top: 12px;
        text-align: center;
      }

      .session-expired {
        color: var(--state-warning, #f59e0b);
        font-size: var(--text-sm);
        margin-bottom: 16px;
        text-align: center;
        padding: 8px 12px;
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.3);
        border-radius: 4px;
      }
    `,
  ];

  @property({ type: Boolean }) sessionExpired = false;

  @state() private _loading = false;
  @state() private _error = "";

  private _username = "admin";
  private _password = "";

  private _onUsernameInput(e: Event) {
    this._username = (e.target as HTMLInputElement).value;
  }

  private _onPasswordInput(e: Event) {
    this._password = (e.target as HTMLInputElement).value;
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      void this._submit();
    }
  }

  private async _submit() {
    if (this._loading) return;
    this._loading = true;
    this._error = "";

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: this._username, password: this._password }),
      });

      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; token: string };
        this.dispatchEvent(
          new CustomEvent("authenticated", {
            detail: { token: data.token },
            bubbles: true,
            composed: true,
          }),
        );
      } else if (res.status === 401) {
        this._error = msg("Invalid credentials", { id: "login-error-invalid-creds" });
      } else if (res.status === 429) {
        this._error = msg("Too many attempts. Please wait a moment.", { id: "login-error-rate-limit" });
      } else {
        this._error = msg("An error occurred. Please try again.", { id: "login-error-generic" });
      }
    } catch {
      this._error = msg("An error occurred. Please try again.", { id: "login-error-generic" });
    }

    this._loading = false;
  }

  override firstUpdated() {
    // Autofocus password field (username is pre-filled with "admin")
    const passwordInput = this.shadowRoot?.querySelector<HTMLInputElement>('input[type="password"]');
    passwordInput?.focus();
  }

  override render() {
    return html`
      <div class="card">
        <h1 class="title">Claw<span>Pilot</span></h1>

        ${this.sessionExpired
          ? html`<p class="session-expired">${msg("Your session has expired. Please sign in again.", { id: "login-session-expired" })}</p>`
          : ""}

        <div class="field">
          <label for="username">${msg("Username", { id: "login-label-username" })}</label>
          <input
            id="username"
            type="text"
            autocomplete="username"
            .value=${this._username}
            @input=${this._onUsernameInput}
            @keydown=${this._onKeyDown}
          />
        </div>

        <div class="field">
          <label for="password">${msg("Password", { id: "login-label-password" })}</label>
          <input
            id="password"
            type="password"
            autocomplete="current-password"
            .value=${this._password}
            @input=${this._onPasswordInput}
            @keydown=${this._onKeyDown}
          />
        </div>

        <button
          class="btn-submit"
          type="submit"
          ?disabled=${this._loading}
          @click=${this._submit}
        >
          ${this._loading ? "…" : msg("Sign in", { id: "login-btn-submit" })}
        </button>

        ${this._error
          ? html`<p class="error">${this._error}</p>`
          : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-login-view": CpLoginView;
  }
}
