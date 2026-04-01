// ui/src/components/profile-settings.ts
//
// User profile management page — accessible via #/profile.
// Follows the same sidebar + content pattern as cp-instance-settings.

import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import { profileSettingsStyles } from "../styles/profile-settings.styles.js";
import { fetchProfile, patchProfile } from "../api.js";
import type { ProfileSection, UserProfile } from "../types.js";
import "./named-keys-panel.js";

@localized()
@customElement("cp-profile-settings")
export class ProfileSettings extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    profileSettingsStyles,
  ];

  // --- State ---
  @state() private _profile: UserProfile | null = null;
  @state() private _loading = true;
  @state() private _saving = false;
  @state() private _error = "";
  @state() private _activeSection: ProfileSection = "general";
  @state() private _toast: { message: string; type: "success" | "warning" | "error" } | null = null;
  @state() private _dirty: Record<string, unknown> = {};

  // --- Lifecycle ---

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadAll();
  }

  private async _loadAll(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      const profileRes = await fetchProfile();
      this._profile = profileRes.profile;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  // --- Dirty tracking ---

  private _setDirty(key: string, value: unknown): void {
    this._dirty = { ...this._dirty, [key]: value };
  }

  private _getDirty<T>(key: string, fallback: T): T {
    return key in this._dirty ? (this._dirty[key] as T) : fallback;
  }

  private get _hasChanges(): boolean {
    return Object.keys(this._dirty).length > 0;
  }

  // --- Toast ---

  private _showToast(message: string, type: "success" | "warning" | "error" = "success"): void {
    this._toast = { message, type };
    setTimeout(() => {
      this._toast = null;
    }, 4000);
  }

  // --- Save (General + Instructions) ---

  private async _save(): Promise<void> {
    if (!this._hasChanges) return;
    this._saving = true;
    try {
      await patchProfile(this._dirty as Record<string, string | null>);
      this._dirty = {};
      const res = await fetchProfile();
      this._profile = res.profile;
      this._showToast(msg("Profile saved", { id: "profile-saved" }));
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      this._saving = false;
    }
  }

  private _cancelChanges(): void {
    this._dirty = {};
  }

  // --- Navigation ---

  private _navigateBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", { detail: { view: "cluster" }, bubbles: true, composed: true }),
    );
  }

  // --- Render ---

  override render() {
    if (this._loading) {
      return html`<div class="loading-container">
        <div class="spinner"></div>
        ${msg("Loading profile...", { id: "profile-loading" })}
      </div>`;
    }

    if (this._error) {
      return html`<div class="error-banner">${this._error}</div>`;
    }

    return html`
      <div class="settings-header">
        <div class="header-left">
          <button class="back-btn" @click=${this._navigateBack}>
            ← ${msg("Back", { id: "profile-back" })}
          </button>
          <div class="header-title">👤 ${msg("Profile", { id: "profile-title" })}</div>
        </div>
        <div class="header-right">
          ${this._hasChanges
            ? html`
                <button class="btn btn-ghost" @click=${this._cancelChanges}>
                  ${msg("Cancel", { id: "profile-cancel" })}
                </button>
                <button class="btn btn-primary" ?disabled=${this._saving} @click=${this._save}>
                  ${this._saving
                    ? msg("Saving...", { id: "profile-saving" })
                    : msg("Save", { id: "profile-save" })}
                </button>
              `
            : nothing}
        </div>
      </div>

      <div class="settings-layout">
        <nav class="sidebar">
          <div class="sidebar-nav">
            ${this._renderSidebarItem("general", msg("General", { id: "profile-general" }))}
            ${this._renderSidebarItem("api-keys", msg("API Keys", { id: "profile-api-keys" }))}
            ${this._renderSidebarItem(
              "instructions",
              msg("Instructions", { id: "profile-instructions" }),
            )}
          </div>
        </nav>

        <div class="content">${this._renderActiveSection()}</div>
      </div>

      ${this._toast
        ? html`<div class="toast ${this._toast.type}">${this._toast.message}</div>`
        : nothing}
    `;
  }

  private _renderSidebarItem(section: ProfileSection, label: string, count?: number) {
    return html`
      <button
        class="sidebar-item ${this._activeSection === section ? "active" : ""}"
        @click=${() => {
          this._activeSection = section;
        }}
      >
        ${label}
        ${count !== undefined && count > 0
          ? html`<span class="sidebar-badge">${count}</span>`
          : nothing}
      </button>
    `;
  }

  private _renderActiveSection() {
    switch (this._activeSection) {
      case "general":
        return this._renderGeneralSection();
      case "api-keys":
        return html`<cp-named-keys-panel></cp-named-keys-panel>`;
      case "instructions":
        return this._renderInstructionsSection();
    }
  }

  // -----------------------------------------------------------------------
  // General section
  // -----------------------------------------------------------------------

  private _renderGeneralSection() {
    const p = this._profile;

    return html`
      <div class="section">
        <div class="section-header">${msg("General", { id: "profile-general" })}</div>
        <div class="field-grid">
          <div class="field">
            <label class="field-label"
              >${msg("Display name", { id: "profile-display-name" })}</label
            >
            <input
              class="field-input ${"displayName" in this._dirty ? "changed" : ""}"
              type="text"
              .value=${this._getDirty("displayName", p?.displayName ?? "")}
              @input=${(e: Event) =>
                this._setDirty("displayName", (e.target as HTMLInputElement).value || null)}
            />
          </div>

          <div class="field">
            <label class="field-label">${msg("Language", { id: "profile-language" })}</label>
            <select
              class="field-input ${"language" in this._dirty ? "changed" : ""}"
              .value=${this._getDirty("language", p?.language ?? "fr")}
              @change=${(e: Event) =>
                this._setDirty("language", (e.target as HTMLSelectElement).value)}
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="es">Español</option>
              <option value="it">Italiano</option>
              <option value="pt">Português</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label">${msg("Timezone", { id: "profile-timezone" })}</label>
            <input
              class="field-input ${"timezone" in this._dirty ? "changed" : ""}"
              type="text"
              placeholder="Europe/Paris"
              .value=${this._getDirty("timezone", p?.timezone ?? "")}
              @input=${(e: Event) =>
                this._setDirty("timezone", (e.target as HTMLInputElement).value || null)}
            />
          </div>

          <div class="field">
            <label class="field-label"
              >${msg("Communication style", { id: "profile-communication-style" })}</label
            >
            <select
              class="field-input ${"communicationStyle" in this._dirty ? "changed" : ""}"
              .value=${this._getDirty("communicationStyle", p?.communicationStyle ?? "concise")}
              @change=${(e: Event) =>
                this._setDirty("communicationStyle", (e.target as HTMLSelectElement).value)}
            >
              <option value="concise">${msg("Concise", { id: "profile-style-concise" })}</option>
              <option value="detailed">${msg("Detailed", { id: "profile-style-detailed" })}</option>
              <option value="technical">
                ${msg("Technical", { id: "profile-style-technical" })}
              </option>
            </select>
          </div>

          <div class="field full-width">
            <label class="field-label">${msg("Avatar URL", { id: "profile-avatar-url" })}</label>
            <div class="avatar-row">
              <div class="avatar-preview">
                ${p?.avatarUrl || ("avatarUrl" in this._dirty && this._dirty["avatarUrl"])
                  ? html`<img
                      src=${this._getDirty("avatarUrl", p?.avatarUrl ?? "") as string}
                      alt=""
                      @error=${(e: Event) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />`
                  : "👤"}
              </div>
              <input
                class="field-input ${"avatarUrl" in this._dirty ? "changed" : ""}"
                type="text"
                placeholder="https://..."
                .value=${this._getDirty("avatarUrl", p?.avatarUrl ?? "")}
                @input=${(e: Event) =>
                  this._setDirty("avatarUrl", (e.target as HTMLInputElement).value || null)}
                style="flex:1"
              />
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Instructions section
  // -----------------------------------------------------------------------

  private _renderInstructionsSection() {
    const current = this._getDirty(
      "customInstructions",
      this._profile?.customInstructions ?? "",
    ) as string;
    const charCount = current.length;
    return html`
      <div class="section">
        <div class="section-header">${msg("Instructions", { id: "profile-instructions" })}</div>
        <div class="field-hint">
          ${msg("Markdown supported. Max 10,000 characters.", { id: "profile-instructions-hint" })}
        </div>
        <textarea
          class="instructions-textarea"
          maxlength="10000"
          .value=${current}
          @input=${(e: Event) =>
            this._setDirty("customInstructions", (e.target as HTMLTextAreaElement).value || null)}
        ></textarea>
        <div class="char-counter ${charCount > 9000 ? "warning" : ""}">
          ${charCount} / 10 000 ${msg("characters", { id: "profile-char-count" })}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-profile-settings": ProfileSettings;
  }
}
