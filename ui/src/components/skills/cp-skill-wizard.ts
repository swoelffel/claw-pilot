// ui/src/components/skills/cp-skill-wizard.ts
//
// SKILLS-002 — modal wizard to create a structured (DB-backed) skill.
// Three tabs:
//   - Blank   : name + optional description → POST /instances/:slug/skills {mode:"blank"}
//   - ZIP     : upload archive             → POST /instances/:slug/skills (multipart)
//   - GitHub  : url + optional ref         → POST /instances/:slug/skills {mode:"github"}
//
// Emits:
//   - `skill-created` (bubbles, composed) detail: { id } on success
//   - `close` on cancel / ESC / overlay click

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles, errorBannerStyles } from "../../styles/shared.js";
import {
  createBlankSkill,
  uploadStructuredSkillZip,
  installStructuredSkillFromGithub,
} from "../../api.js";
import { userMessage } from "../../lib/error-messages.js";

type WizardTab = "blank" | "zip" | "github";

@localized()
@customElement("cp-skill-wizard")
export class CpSkillWizard extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    errorBannerStyles,
    css`
      :host {
        display: block;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 500;
        font-family: var(--font-ui);
      }
      .panel {
        background: var(--bg-surface);
        color: var(--text-primary);
        max-width: 560px;
        width: 90vw;
        margin: 5vh auto;
        border-radius: var(--radius-lg);
        border: 1px solid var(--bg-border);
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .panel-header {
        padding: 18px 22px;
        border-bottom: 1px solid var(--bg-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      h2 {
        margin: 0;
        font-size: 17px;
        font-weight: 700;
        color: var(--text-primary);
      }
      .close-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 4px 8px;
        border-radius: var(--radius-sm);
      }
      .close-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }
      .tabs {
        display: flex;
        gap: 4px;
        padding: 12px 22px 0 22px;
        border-bottom: 1px solid var(--bg-border);
      }
      .tab {
        background: none;
        border: none;
        color: var(--text-muted);
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: 600;
        padding: 8px 14px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
      }
      .tab:hover {
        color: var(--text-primary);
      }
      .tab.active {
        color: var(--accent);
        border-bottom-color: var(--accent);
      }
      .panel-body {
        padding: 20px 22px;
        overflow: auto;
        flex: 1;
      }
      label {
        display: block;
        margin-top: 12px;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 6px;
      }
      label:first-of-type {
        margin-top: 0;
      }
      input[type="text"],
      input[type="url"],
      textarea {
        width: 100%;
        padding: 8px 12px;
        background: var(--bg-base);
        color: var(--text-primary);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        font-family: var(--font-ui);
        font-size: 13px;
        box-sizing: border-box;
      }
      input[type="file"] {
        width: 100%;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--text-primary);
      }
      textarea {
        resize: vertical;
        min-height: 70px;
        font-family: var(--font-ui);
      }
      input:focus,
      textarea:focus {
        border-color: var(--accent);
        outline: none;
      }
      .hint {
        margin-top: 6px;
        font-size: 12px;
        color: var(--text-muted);
      }
      .panel-footer {
        padding: 14px 22px;
        border-top: 1px solid var(--bg-border);
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
    `,
  ];

  // ── Properties ──────────────────────────────────────────────────────────
  @property({ type: String }) slug = "";

  // ── State ───────────────────────────────────────────────────────────────
  @state() private _tab: WizardTab = "blank";
  @state() private _err: string | null = null;
  @state() private _submitting = false;

  @state() private _name = "";
  @state() private _description = "";
  @state() private _zipFile: File | null = null;
  @state() private _githubUrl = "";
  @state() private _githubRef = "";

  private readonly _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && !this._submitting) {
      this._emitClose();
    }
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this._onKeyDown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this._onKeyDown);
  }

  // ── Tab switching ───────────────────────────────────────────────────────
  private _switchTab(tab: WizardTab): void {
    if (tab === this._tab) return;
    this._tab = tab;
    this._err = null;
  }

  // ── Events ──────────────────────────────────────────────────────────────
  private _emitClose(): void {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  private _emitCreated(id: string): void {
    this.dispatchEvent(
      new CustomEvent("skill-created", {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onOverlayClick(e: MouseEvent): void {
    if (e.target === this && !this._submitting) {
      this._emitClose();
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  private async _submit(): Promise<void> {
    if (this._submitting) return;
    this._err = null;
    this._submitting = true;
    try {
      let result: { id: string };
      if (this._tab === "blank") {
        const name = this._name.trim();
        if (!name) {
          this._err = msg("Name is required.", { id: "skills-wizard-err-name-required" });
          return;
        }
        const desc = this._description.trim();
        result = await createBlankSkill(this.slug, {
          name,
          ...(desc ? { description: desc } : {}),
        });
      } else if (this._tab === "zip") {
        if (!this._zipFile) {
          this._err = msg("Please select a ZIP file.", { id: "skills-wizard-err-zip-required" });
          return;
        }
        result = await uploadStructuredSkillZip(this.slug, this._zipFile);
      } else {
        const url = this._githubUrl.trim();
        if (!url) {
          this._err = msg("GitHub URL is required.", { id: "skills-wizard-err-url-required" });
          return;
        }
        const ref = this._githubRef.trim();
        result = await installStructuredSkillFromGithub(this.slug, {
          url,
          ...(ref ? { ref } : {}),
        });
      }
      this._emitCreated(result.id);
    } catch (err) {
      this._err = userMessage(err);
    } finally {
      this._submitting = false;
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  override render() {
    return html`
      <div @click=${this._onOverlayClick}>
        <div class="panel" role="dialog" aria-modal="true">
          <div class="panel-header">
            <h2>${msg("Add Skill", { id: "skills-wizard-title" })}</h2>
            <button
              class="close-btn"
              type="button"
              aria-label=${msg("Close", { id: "skills-wizard-close" })}
              @click=${this._emitClose}
              ?disabled=${this._submitting}
            >
              ×
            </button>
          </div>
          <div class="tabs" role="tablist">
            <button
              class="tab ${this._tab === "blank" ? "active" : ""}"
              role="tab"
              aria-selected=${this._tab === "blank"}
              @click=${() => this._switchTab("blank")}
            >
              ${msg("Blank", { id: "skills-wizard-tab-blank" })}
            </button>
            <button
              class="tab ${this._tab === "zip" ? "active" : ""}"
              role="tab"
              aria-selected=${this._tab === "zip"}
              @click=${() => this._switchTab("zip")}
            >
              ${msg("ZIP", { id: "skills-wizard-tab-zip" })}
            </button>
            <button
              class="tab ${this._tab === "github" ? "active" : ""}"
              role="tab"
              aria-selected=${this._tab === "github"}
              @click=${() => this._switchTab("github")}
            >
              ${msg("GitHub", { id: "skills-wizard-tab-github" })}
            </button>
          </div>
          <div class="panel-body">
            ${this._err ? html`<div class="error-banner">${this._err}</div>` : nothing}
            ${this._tab === "blank"
              ? this._renderBlank()
              : this._tab === "zip"
                ? this._renderZip()
                : this._renderGithub()}
          </div>
          <div class="panel-footer">
            <button
              class="btn btn-ghost"
              type="button"
              @click=${this._emitClose}
              ?disabled=${this._submitting}
            >
              ${msg("Cancel", { id: "skills-wizard-cancel" })}
            </button>
            <button
              class="btn btn-primary"
              type="button"
              @click=${this._submit}
              ?disabled=${this._submitting}
            >
              ${this._submitting
                ? msg("Creating…", { id: "skills-wizard-submitting" })
                : msg("Create", { id: "skills-wizard-submit" })}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderBlank() {
    return html`
      <label for="sw-name">${msg("Name", { id: "skills-wizard-name-label" })}</label>
      <input
        id="sw-name"
        type="text"
        .value=${this._name}
        maxlength="64"
        @input=${(e: Event) => (this._name = (e.target as HTMLInputElement).value)}
        ?disabled=${this._submitting}
      />
      <label for="sw-desc"
        >${msg("Description (optional)", { id: "skills-wizard-desc-label" })}</label
      >
      <textarea
        id="sw-desc"
        rows="3"
        maxlength="500"
        .value=${this._description}
        @input=${(e: Event) => (this._description = (e.target as HTMLTextAreaElement).value)}
        ?disabled=${this._submitting}
      ></textarea>
    `;
  }

  private _renderZip() {
    return html`
      <label for="sw-zip">${msg("ZIP archive", { id: "skills-wizard-zip-label" })}</label>
      <input
        id="sw-zip"
        type="file"
        accept=".zip,application/zip"
        @change=${(e: Event) => {
          const f = (e.target as HTMLInputElement).files;
          this._zipFile = f && f.length > 0 ? f[0]! : null;
        }}
        ?disabled=${this._submitting}
      />
      <div class="hint">
        ${msg("Must contain a SKILL.md manifest at the root.", {
          id: "skills-wizard-zip-hint",
        })}
      </div>
    `;
  }

  private _renderGithub() {
    return html`
      <label for="sw-gh-url">${msg("GitHub URL", { id: "skills-wizard-url-label" })}</label>
      <input
        id="sw-gh-url"
        type="url"
        placeholder="https://github.com/owner/repo/tree/main/path"
        .value=${this._githubUrl}
        @input=${(e: Event) => (this._githubUrl = (e.target as HTMLInputElement).value)}
        ?disabled=${this._submitting}
      />
      <label for="sw-gh-ref">${msg("Ref (optional)", { id: "skills-wizard-ref-label" })}</label>
      <input
        id="sw-gh-ref"
        type="text"
        placeholder="main"
        maxlength="128"
        .value=${this._githubRef}
        @input=${(e: Event) => (this._githubRef = (e.target as HTMLInputElement).value)}
        ?disabled=${this._submitting}
      />
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-skill-wizard": CpSkillWizard;
  }
}
