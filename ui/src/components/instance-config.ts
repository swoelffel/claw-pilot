// ui/src/components/instance-config.ts
// Panneau Config avancée — alias modèles, compaction, sub-agents
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles } from "../styles/shared.js";
import { getToken } from "../services/auth-state.js";

type ConfigTab = "models" | "compaction" | "subagents";

interface ModelAlias {
  id: string;
  providerId: string;
  modelId: string;
}

@localized()
@customElement("cp-instance-config")
export class InstanceConfig extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    css`
      :host {
        display: block;
      }

      .config-panel {
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
      }

      /* ── Sub-navigation ─────────────────────────────────── */

      .sub-nav {
        display: flex;
        gap: 4px;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--bg-border);
        padding-bottom: 0;
      }

      .sub-tab {
        padding: 6px 12px;
        border: none;
        background: transparent;
        color: var(--text-muted);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        transition:
          color 0.15s,
          border-color 0.15s;
        font-family: var(--font-ui);
      }

      .sub-tab:hover {
        color: var(--text-secondary);
      }

      .sub-tab.active {
        color: var(--accent);
        border-bottom-color: var(--accent);
      }

      /* ── Fields ─────────────────────────────────────────── */

      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 12px;
      }

      .field-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
      }

      .field-input,
      .field-select {
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 12px;
        padding: 6px 8px;
        outline: none;
        font-family: var(--font-ui);
        width: 100%;
        box-sizing: border-box;
      }

      .field-input:focus,
      .field-select:focus {
        border-color: var(--accent);
        box-shadow: var(--focus-ring);
      }

      .field-range {
        width: 100%;
        accent-color: var(--accent);
      }

      .field-range-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .field-range-value {
        font-size: 12px;
        font-family: var(--font-mono);
        color: var(--text-secondary);
        min-width: 40px;
        text-align: right;
        flex-shrink: 0;
      }

      /* ── Alias list ─────────────────────────────────────── */

      .alias-list {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        margin-bottom: 8px;
      }

      .alias-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--bg-border);
      }

      .alias-row:last-child {
        border-bottom: none;
      }

      .alias-id {
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        color: var(--accent);
        min-width: 60px;
        flex-shrink: 0;
      }

      .alias-input {
        background: transparent;
        border: none;
        border-bottom: 1px solid var(--bg-border);
        color: var(--text-primary);
        font-size: 11px;
        font-family: var(--font-mono);
        padding: 2px 4px;
        outline: none;
        flex: 1;
        min-width: 0;
      }

      .alias-input:focus {
        border-bottom-color: var(--accent);
      }

      .btn-remove-alias {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 2px 4px;
        border-radius: var(--radius-sm);
        font-size: 13px;
        line-height: 1;
        transition: color 0.15s;
        flex-shrink: 0;
      }

      .btn-remove-alias:hover {
        color: var(--state-error);
      }

      .btn-add-alias {
        padding: 4px 10px;
        border-radius: var(--radius-sm);
        border: 1px dashed var(--bg-border);
        background: transparent;
        color: var(--text-muted);
        font-size: 11px;
        cursor: pointer;
        transition:
          color 0.15s,
          border-color 0.15s;
      }

      .btn-add-alias:hover {
        color: var(--accent);
        border-color: var(--accent-border);
      }

      /* ── Save bar ───────────────────────────────────────── */

      .save-bar {
        display: flex;
        gap: 8px;
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid var(--bg-border);
      }
    `,
  ];

  @property({ type: String }) slug = "";
  @property({ type: Boolean }) active = false;

  @state() private _tab: ConfigTab = "models";
  @state() private _internalModel = "";
  @state() private _aliases: ModelAlias[] = [];
  @state() private _compactionThreshold = 85;
  @state() private _compactionReserve = 8000;
  @state() private _subagentsMaxDepth = 3;
  @state() private _subagentsMaxChildren = 5;
  @state() private _dirty = false;
  @state() private _saving = false;
  @state() private _loading = false;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("active") && this.active) {
      void this._load();
    }
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  private async _load(): Promise<void> {
    if (!this.slug) return;
    this._loading = true;
    try {
      const token = getToken();
      const res = await fetch(`/api/instances/${this.slug}/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        runtime?: {
          defaultInternalModel?: string;
          models?: ModelAlias[];
          compaction?: { threshold?: number; reservedTokens?: number };
          subagents?: { maxSpawnDepth?: number; maxChildrenPerSession?: number };
        };
      };
      const rt = data.runtime ?? {};
      this._internalModel = rt.defaultInternalModel ?? "";
      this._aliases = rt.models ?? [];
      this._compactionThreshold = Math.round((rt.compaction?.threshold ?? 0.85) * 100);
      this._compactionReserve = rt.compaction?.reservedTokens ?? 8000;
      this._subagentsMaxDepth = rt.subagents?.maxSpawnDepth ?? 3;
      this._subagentsMaxChildren = rt.subagents?.maxChildrenPerSession ?? 5;
      this._dirty = false;
    } catch {
      // Silently ignore
    } finally {
      this._loading = false;
    }
  }

  private async _save(): Promise<void> {
    this._saving = true;
    try {
      const token = getToken();
      await fetch(`/api/instances/${this.slug}/config`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runtime: {
            ...(this._internalModel ? { defaultInternalModel: this._internalModel } : {}),
            models: this._aliases.filter((a) => a.id && a.providerId && a.modelId),
            compaction: {
              threshold: this._compactionThreshold / 100,
              reservedTokens: this._compactionReserve,
            },
            subagents: {
              maxSpawnDepth: this._subagentsMaxDepth,
              maxChildrenPerSession: this._subagentsMaxChildren,
            },
          },
        }),
      });
      this._dirty = false;
    } catch {
      // Silently ignore
    } finally {
      this._saving = false;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  private _renderModels() {
    return html`
      <div class="field">
        <label class="field-label"
          >${msg("Internal model (compaction, summary)", { id: "cfg-internal-model" })}</label
        >
        <input
          type="text"
          class="field-input"
          placeholder="anthropic/claude-haiku-3-5"
          .value=${this._internalModel}
          @input=${(e: Event) => {
            this._internalModel = (e.target as HTMLInputElement).value;
            this._dirty = true;
          }}
        />
      </div>

      <div class="field-label" style="margin-bottom:6px">
        ${msg("Model aliases", { id: "cfg-model-aliases" })}
      </div>
      ${this._aliases.length > 0
        ? html`
            <div class="alias-list">
              ${this._aliases.map(
                (alias, i) => html`
                  <div class="alias-row">
                    <input
                      class="alias-input"
                      placeholder="alias"
                      .value=${alias.id}
                      @input=${(e: Event) => {
                        const next = [...this._aliases];
                        const cur = next[i]!;
                        next[i] = {
                          id: (e.target as HTMLInputElement).value,
                          providerId: cur.providerId,
                          modelId: cur.modelId,
                        };
                        this._aliases = next;
                        this._dirty = true;
                      }}
                    />
                    <input
                      class="alias-input"
                      placeholder="provider"
                      .value=${alias.providerId}
                      @input=${(e: Event) => {
                        const next = [...this._aliases];
                        const cur = next[i]!;
                        next[i] = {
                          id: cur.id,
                          providerId: (e.target as HTMLInputElement).value,
                          modelId: cur.modelId,
                        };
                        this._aliases = next;
                        this._dirty = true;
                      }}
                    />
                    <input
                      class="alias-input"
                      placeholder="model"
                      .value=${alias.modelId}
                      @input=${(e: Event) => {
                        const next = [...this._aliases];
                        const cur = next[i]!;
                        next[i] = {
                          id: cur.id,
                          providerId: cur.providerId,
                          modelId: (e.target as HTMLInputElement).value,
                        };
                        this._aliases = next;
                        this._dirty = true;
                      }}
                    />
                    <button
                      class="btn-remove-alias"
                      @click=${() => {
                        this._aliases = this._aliases.filter((_, j) => j !== i);
                        this._dirty = true;
                      }}
                    >
                      ✕
                    </button>
                  </div>
                `,
              )}
            </div>
          `
        : nothing}
      <button
        class="btn-add-alias"
        @click=${() => {
          this._aliases = [...this._aliases, { id: "", providerId: "", modelId: "" }];
          this._dirty = true;
        }}
      >
        + ${msg("Add alias", { id: "cfg-add-alias" })}
      </button>
    `;
  }

  private _renderCompaction() {
    return html`
      <div class="field">
        <label class="field-label"
          >${msg("Threshold (% context window)", { id: "cfg-compaction-threshold" })}</label
        >
        <div class="field-range-row">
          <input
            type="range"
            class="field-range"
            min="50"
            max="99"
            .value=${String(this._compactionThreshold)}
            @input=${(e: Event) => {
              this._compactionThreshold = parseInt((e.target as HTMLInputElement).value, 10);
              this._dirty = true;
            }}
          />
          <span class="field-range-value">${this._compactionThreshold}%</span>
        </div>
      </div>

      <div class="field">
        <label class="field-label"
          >${msg("Reserved tokens for summary", { id: "cfg-compaction-reserve" })}</label
        >
        <input
          type="number"
          class="field-input"
          min="1000"
          max="32000"
          .value=${String(this._compactionReserve)}
          @change=${(e: Event) => {
            this._compactionReserve = parseInt((e.target as HTMLInputElement).value, 10) || 8000;
            this._dirty = true;
          }}
        />
      </div>
    `;
  }

  private _renderSubagents() {
    return html`
      <div class="field">
        <label class="field-label"
          >${msg("Max spawn depth", { id: "cfg-subagents-depth" })} (0–10)</label
        >
        <div class="field-range-row">
          <input
            type="range"
            class="field-range"
            min="0"
            max="10"
            .value=${String(this._subagentsMaxDepth)}
            @input=${(e: Event) => {
              this._subagentsMaxDepth = parseInt((e.target as HTMLInputElement).value, 10);
              this._dirty = true;
            }}
          />
          <span class="field-range-value">${this._subagentsMaxDepth}</span>
        </div>
      </div>

      <div class="field">
        <label class="field-label"
          >${msg("Max active children per session", { id: "cfg-subagents-children" })} (1–20)</label
        >
        <div class="field-range-row">
          <input
            type="range"
            class="field-range"
            min="1"
            max="20"
            .value=${String(this._subagentsMaxChildren)}
            @input=${(e: Event) => {
              this._subagentsMaxChildren = parseInt((e.target as HTMLInputElement).value, 10);
              this._dirty = true;
            }}
          />
          <span class="field-range-value">${this._subagentsMaxChildren}</span>
        </div>
      </div>
    `;
  }

  override render() {
    return html`
      <div class="config-panel">
        <div class="section-header">${msg("Config", { id: "cfg-panel-title" })}</div>

        ${this._loading ? html`<div class="spinner"></div>` : nothing}

        <!-- Sub-navigation -->
        <div class="sub-nav">
          <button
            class="sub-tab ${this._tab === "models" ? "active" : ""}"
            @click=${() => {
              this._tab = "models";
            }}
          >
            ${msg("Models", { id: "cfg-tab-models" })}
          </button>
          <button
            class="sub-tab ${this._tab === "compaction" ? "active" : ""}"
            @click=${() => {
              this._tab = "compaction";
            }}
          >
            ${msg("Compaction", { id: "cfg-tab-compaction" })}
          </button>
          <button
            class="sub-tab ${this._tab === "subagents" ? "active" : ""}"
            @click=${() => {
              this._tab = "subagents";
            }}
          >
            ${msg("Sub-agents", { id: "cfg-tab-subagents" })}
          </button>
        </div>

        <!-- Tab content -->
        ${this._tab === "models" ? this._renderModels() : nothing}
        ${this._tab === "compaction" ? this._renderCompaction() : nothing}
        ${this._tab === "subagents" ? this._renderSubagents() : nothing}

        <!-- Save bar -->
        ${this._dirty
          ? html`
              <div class="save-bar">
                <button
                  class="btn btn-primary"
                  ?disabled=${this._saving}
                  @click=${() => void this._save()}
                >
                  ${this._saving ? "…" : msg("Save", { id: "cfg-save" })}
                </button>
                <button
                  class="btn btn-secondary"
                  ?disabled=${this._saving}
                  @click=${() => void this._load()}
                >
                  ${msg("Cancel", { id: "cfg-cancel" })}
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-config": InstanceConfig;
  }
}
