// ui/src/components/skills/cp-skills-tab.ts
//
// SKILLS-002 — instance-scoped structured skills tab.
// Cards grid view that lists every DB-backed skill for an instance.
//
// Sibling: `cp-instance-skills` is the legacy filesystem-based skills panel
// rendered as a sidebar section in `cp-instance-settings`. This component is
// the new top-level route at `/instances/:slug/skills` that drives the
// structured (DB-backed) workflow shipped in SKILLS-002.
//
// The skill creation wizard (`cp-skill-wizard`) ships in Task 9 and the
// detail panel (`cp-skill-detail`) ships in Task 10 — until then the
// `+ Add Skill` button and card clicks navigate / log a TODO.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../../styles/shared.js";
import { listStructuredSkills } from "../../api.js";
import type { StructuredSkillSummary } from "../../types.js";

// TODO(Task 9): import "./cp-skill-wizard.js";
// TODO(Task 10): import "./cp-skill-detail.js";

@localized()
@customElement("cp-skills-tab")
export class SkillsTab extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    css`
      :host {
        display: block;
        padding: 16px 20px;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .header-count {
        display: inline-flex;
        align-items: center;
        padding: 1px 8px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 700;
        font-family: var(--font-mono);
        background: rgba(79, 110, 247, 0.1);
        color: var(--accent);
        border: 1px solid rgba(79, 110, 247, 0.25);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 12px;
      }

      .card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 14px;
        cursor: pointer;
        transition:
          border-color 0.15s,
          background 0.15s;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .card:hover {
        border-color: var(--accent);
        background: var(--bg-hover);
      }

      .card-head {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }

      .card-emoji {
        font-size: 18px;
        line-height: 1;
      }

      .card-name {
        font-size: 14px;
        font-weight: 700;
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .card-version {
        font-size: 11px;
        font-family: var(--font-mono);
        color: var(--text-muted);
      }

      .card-desc {
        font-size: 12px;
        color: var(--text-muted);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .card-meta {
        font-size: 11px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .card-meta .sep {
        opacity: 0.4;
      }

      .empty-state {
        color: var(--text-muted);
        font-size: 13px;
        padding: 48px 0;
        text-align: center;
      }
    `,
  ];

  // ── Properties ──────────────────────────────────────────────────────────

  @property({ type: String }) slug = "";

  // ── State ───────────────────────────────────────────────────────────────

  @state() private _skills: StructuredSkillSummary[] = [];
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _wizardOpen = false;

  // ── Lifecycle ───────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug")) {
      void this._load();
    }
  }

  // ── Data loading ────────────────────────────────────────────────────────

  private async _load(): Promise<void> {
    if (!this.slug) return;
    this._loading = true;
    this._error = "";
    try {
      this._skills = await listStructuredSkills(this.slug);
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to load skills";
    } finally {
      this._loading = false;
    }
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  private _openWizard(): void {
    // TODO(Task 9): swap for the real `cp-skill-wizard` component once it lands.
    this._wizardOpen = true;
    // eslint-disable-next-line no-console
    console.warn("[cp-skills-tab] wizard coming in Task 9");
  }

  private _openSkill(id: string): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "skill-detail", slug: this.slug, skillId: id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  override render() {
    return html`
      <div class="header">
        <h2>
          ${msg("Skills", { id: "skills-tab-title" })}
          ${this._skills.length > 0
            ? html`<span class="header-count">${this._skills.length}</span>`
            : nothing}
        </h2>
        <button class="btn btn-primary" ?disabled=${this._wizardOpen} @click=${this._openWizard}>
          + ${msg("Add Skill", { id: "skills-tab-add" })}
        </button>
      </div>

      ${this._loading
        ? html`<div class="spinner"></div>`
        : this._error
          ? html`<div class="error-banner">${this._error}</div>`
          : this._skills.length === 0
            ? html`<div class="empty-state">
                ${msg("No skills yet.", { id: "skills-tab-empty" })}
              </div>`
            : this._renderGrid()}
    `;
  }

  private _renderGrid() {
    return html` <div class="grid">${this._skills.map((s) => this._renderCard(s))}</div> `;
  }

  private _renderCard(s: StructuredSkillSummary) {
    const sourceLabel = s.source ?? "blank";
    return html`
      <div
        class="card"
        role="button"
        tabindex="0"
        @click=${() => this._openSkill(s.id)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this._openSkill(s.id);
          }
        }}
      >
        <div class="card-head">
          <span class="card-emoji" aria-hidden="true">📦</span>
          <span class="card-name" title=${s.name}>${s.name}</span>
          ${s.version ? html`<span class="card-version">v${s.version}</span>` : nothing}
        </div>
        ${s.description ? html`<div class="card-desc">${s.description}</div>` : nothing}
        <div class="card-meta">
          <span>${this._fileCountLabel(s.fileCount)}</span>
          <span class="sep">·</span>
          <span>${this._agentCountLabel(s.agentCount)}</span>
          <span class="sep">·</span>
          <span>${sourceLabel}</span>
        </div>
      </div>
    `;
  }

  private _fileCountLabel(n: number): string {
    if (n === 0) return msg("no files", { id: "skills-card-files-zero" });
    if (n === 1) return msg("1 file", { id: "skills-card-files-one" });
    return `${n} ${msg("files", { id: "skills-card-files-many" })}`;
  }

  private _agentCountLabel(n: number): string {
    if (n === 0) return msg("no agents", { id: "skills-card-agents-zero" });
    if (n === 1) return msg("1 agent", { id: "skills-card-agents-one" });
    return `${n} ${msg("agents", { id: "skills-card-agents-many" })}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-skills-tab": SkillsTab;
  }
}
