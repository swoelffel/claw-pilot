// ui/src/components/instance-skills.ts
// Skills management panel — list, upload (ZIP), install (GitHub), delete
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import {
  fetchInstanceSkills,
  uploadSkillZip,
  installSkillFromGitHub,
  deleteSkill,
} from "../api.js";
import type { SkillInfo } from "../types.js";

type InstallMode = null | "zip" | "github";

@localized()
@customElement("cp-instance-skills")
export class InstanceSkills extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    css`
      :host {
        display: block;
      }

      .skills-panel {
        padding: 0;
      }

      .section-header {
        font-size: 14px;
        font-weight: 700;
        color: var(--text-primary);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--bg-border);
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .header-count {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: 20px;
        font-size: 10px;
        font-weight: 700;
        font-family: var(--font-mono);
        background: rgba(79, 110, 247, 0.1);
        color: var(--accent);
        border: 1px solid rgba(79, 110, 247, 0.25);
      }

      /* ── Action bar ──────────────────────────────────────── */

      .action-bar {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }

      .action-btn {
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 600;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-border);
        background: var(--bg-surface);
        color: var(--text-primary);
        cursor: pointer;
        transition: background 0.15s;
      }

      .action-btn:hover {
        background: var(--bg-hover);
      }

      .action-btn.active {
        border-color: var(--accent);
        color: var(--accent);
      }

      /* ── Install form ────────────────────────────────────── */

      .install-form {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 12px;
        margin-bottom: 16px;
      }

      .install-form label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        display: block;
        margin-bottom: 6px;
      }

      .install-form input[type="text"],
      .install-form input[type="file"] {
        width: 100%;
        padding: 8px;
        font-size: 13px;
        font-family: var(--font-mono);
        background: var(--bg-base);
        color: var(--text-primary);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        box-sizing: border-box;
      }

      .install-form input[type="text"]::placeholder {
        color: var(--text-muted);
      }

      .install-form-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        justify-content: flex-end;
      }

      /* ── Groups ──────────────────────────────────────────── */

      .group {
        margin-bottom: 20px;
      }

      .group-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--text-muted);
      }

      .group-title.workspace {
        color: var(--accent);
      }

      .group-count {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: 20px;
        font-size: 10px;
        font-weight: 700;
        font-family: var(--font-mono);
        background: rgba(100, 116, 139, 0.1);
        color: var(--text-muted);
        border: 1px solid rgba(100, 116, 139, 0.2);
      }

      .group-count.workspace {
        background: rgba(79, 110, 247, 0.1);
        color: var(--accent);
        border: 1px solid rgba(79, 110, 247, 0.25);
      }

      /* ── Skill rows ──────────────────────────────────────── */

      .skill-row {
        display: flex;
        align-items: center;
        padding: 8px 10px;
        border-radius: var(--radius-sm);
        margin-bottom: 4px;
        gap: 8px;
      }

      .skill-row:hover {
        background: var(--bg-hover);
      }

      .skill-info {
        flex: 1;
        min-width: 0;
      }

      .skill-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .skill-desc {
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .skill-delete {
        opacity: 0;
        padding: 4px 6px;
        font-size: 12px;
        border-radius: var(--radius-sm);
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        transition:
          opacity 0.15s,
          color 0.15s;
      }

      .skill-row:hover .skill-delete {
        opacity: 1;
      }

      .skill-delete:hover {
        color: var(--state-error);
      }

      /* ── Empty / error ───────────────────────────────────── */

      .empty-state {
        color: var(--text-muted);
        font-size: 13px;
        padding: 24px 0;
        text-align: center;
      }

      .install-error {
        color: var(--state-error);
        font-size: 12px;
        margin-top: 6px;
      }
    `,
  ];

  // ── Properties ──────────────────────────────────────────────────────────

  @property({ type: String }) slug = "";
  @property({ type: Boolean }) active = false;

  // ── State ───────────────────────────────────────────────────────────────

  @state() private _skills: SkillInfo[] = [];
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _installMode: InstallMode = null;
  @state() private _githubUrl = "";
  @state() private _installing = false;
  @state() private _installError = "";

  // ── Lifecycle ───────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.active) void this._load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("active") && this.active && this._skills.length === 0) {
      void this._load();
    }
  }

  // ── Data loading ────────────────────────────────────────────────────────

  private async _load(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      const res = await fetchInstanceSkills(this.slug);
      this._skills = res.skills;
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to load skills";
    } finally {
      this._loading = false;
    }
    this.dispatchEvent(
      new CustomEvent("skills-count-changed", { detail: this._skills.length, bubbles: true }),
    );
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  private async _handleZipUpload(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this._installing = true;
    this._installError = "";
    try {
      await uploadSkillZip(this.slug, file);
      this._installMode = null;
      await this._load();
    } catch (err) {
      this._installError = err instanceof Error ? err.message : "Upload failed";
    } finally {
      this._installing = false;
    }
  }

  private async _handleGitHubInstall(): Promise<void> {
    if (!this._githubUrl.trim()) return;

    this._installing = true;
    this._installError = "";
    try {
      await installSkillFromGitHub(this.slug, this._githubUrl.trim());
      this._installMode = null;
      this._githubUrl = "";
      await this._load();
    } catch (err) {
      this._installError = err instanceof Error ? err.message : "Install failed";
    } finally {
      this._installing = false;
    }
  }

  private async _handleDelete(name: string): Promise<void> {
    try {
      await deleteSkill(this.slug, name);
      await this._load();
    } catch {
      // Silently ignore — row will remain visible
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  override render() {
    return html`
      <div class="skills-panel">
        <div class="section-header">
          ${msg("Skills", { id: "skills-section-title" })}
          ${this._skills.length > 0
            ? html`<span class="header-count">${this._skills.length}</span>`
            : nothing}
        </div>

        ${this._renderActionBar()} ${this._renderInstallForm()}
        ${this._loading
          ? html`<div class="spinner"></div>`
          : this._error
            ? html`<div class="error-banner">${this._error}</div>`
            : this._skills.length === 0
              ? html`<div class="empty-state">
                  ${msg("No skills available. Upload a ZIP or install from GitHub.", {
                    id: "skills-empty",
                  })}
                </div>`
              : this._renderSkillsList()}
      </div>
    `;
  }

  private _renderActionBar() {
    return html`
      <div class="action-bar">
        <button
          class="action-btn ${this._installMode === "zip" ? "active" : ""}"
          @click=${() => {
            this._installMode = this._installMode === "zip" ? null : "zip";
            this._installError = "";
          }}
        >
          ${msg("Upload ZIP", { id: "skills-upload-zip" })}
        </button>
        <button
          class="action-btn ${this._installMode === "github" ? "active" : ""}"
          @click=${() => {
            this._installMode = this._installMode === "github" ? null : "github";
            this._installError = "";
          }}
        >
          ${msg("From GitHub", { id: "skills-from-github" })}
        </button>
      </div>
    `;
  }

  private _renderInstallForm() {
    if (this._installMode === "zip") {
      return html`
        <div class="install-form">
          <label>${msg("ZIP file", { id: "skills-zip-label" })}</label>
          <input
            type="file"
            accept=".zip"
            ?disabled=${this._installing}
            @change=${this._handleZipUpload}
          />
          ${this._installing ? html`<div class="spinner" style="margin-top:8px"></div>` : nothing}
          ${this._installError
            ? html`<div class="install-error">${this._installError}</div>`
            : nothing}
        </div>
      `;
    }

    if (this._installMode === "github") {
      return html`
        <div class="install-form">
          <label>${msg("GitHub URL", { id: "skills-github-label" })}</label>
          <input
            type="text"
            placeholder=${msg("https://github.com/org/repo/tree/main/skills/name", {
              id: "skills-github-placeholder",
            })}
            .value=${this._githubUrl}
            ?disabled=${this._installing}
            @input=${(e: Event) => {
              this._githubUrl = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void this._handleGitHubInstall();
            }}
          />
          <div class="install-form-actions">
            <button
              class="btn btn-sm btn-primary"
              ?disabled=${this._installing || !this._githubUrl.trim()}
              @click=${this._handleGitHubInstall}
            >
              ${this._installing
                ? msg("Installing...", { id: "skills-installing" })
                : msg("Install", { id: "skills-install-btn" })}
            </button>
          </div>
          ${this._installError
            ? html`<div class="install-error">${this._installError}</div>`
            : nothing}
        </div>
      `;
    }

    return nothing;
  }

  private _renderSkillsList() {
    const workspace = this._skills.filter((s) => s.source === "workspace");
    const global = this._skills.filter((s) => s.source === "global");
    const remote = this._skills.filter((s) => s.source === "remote");

    return html`
      ${workspace.length > 0 ? this._renderGroup("workspace", workspace) : nothing}
      ${global.length > 0 ? this._renderGroup("global", global) : nothing}
      ${remote.length > 0 ? this._renderGroup("remote", remote) : nothing}
    `;
  }

  private _renderGroup(source: "workspace" | "global" | "remote", skills: SkillInfo[]) {
    const labels: Record<string, string> = {
      workspace: msg("Workspace", { id: "skills-group-workspace" }),
      global: msg("Global", { id: "skills-group-global" }),
      remote: msg("Remote", { id: "skills-group-remote" }),
    };

    return html`
      <div class="group">
        <div class="group-title ${source}">
          ${labels[source]}
          <span class="group-count ${source}">${skills.length}</span>
        </div>
        ${skills.map(
          (s) => html`
            <div class="skill-row">
              <div class="skill-info">
                <div class="skill-name">${s.name}</div>
                ${s.description ? html`<div class="skill-desc">${s.description}</div>` : nothing}
              </div>
              ${s.deletable
                ? html`
                    <button
                      class="skill-delete"
                      title=${msg("Delete", { id: "skills-delete-btn" })}
                      @click=${() => void this._handleDelete(s.name)}
                    >
                      ✕
                    </button>
                  `
                : nothing}
            </div>
          `,
        )}
      </div>
    `;
  }
}
