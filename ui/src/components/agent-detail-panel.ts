// ui/src/components/agent-detail-panel.ts
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type {
  AgentBuilderInfo,
  AgentLink,
  AgentFileContent,
  PanelContext,
  AgentMetaPatch,
  ProvidersResponse,
  SkillInfo,
  SkillsListResponse,
} from "../types.js";
import {
  fetchAgentFile,
  updateSpawnLinks,
  updateAgentFile,
  fetchBlueprintAgentFile,
  updateBlueprintAgentFile,
  updateBlueprintSpawnLinks,
  updateAgentMeta,
  patchInstanceConfig,
  fetchProviders,
  fetchInstanceSkills,
  updateBlueprintAgentMeta,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles } from "../styles/shared.js";
import { agentDetailPanelStyles } from "../styles/agent-detail-panel.styles.js";
import { marked } from "marked";
import DOMPurify from "dompurify";

const EDITABLE_FILES = new Set([
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
]);

@localized()
@customElement("cp-agent-detail-panel")
export class AgentDetailPanel extends LitElement {
  static override styles = [tokenStyles, sectionLabelStyles, agentDetailPanelStyles];

  // ── Public properties ───────────────────────────────────────────────────

  @property({ type: Object }) agent!: AgentBuilderInfo;
  @property({ type: Array }) links: AgentLink[] = [];
  @property({ type: Array }) allAgents: AgentBuilderInfo[] = [];
  // Kept for backward compatibility during transition — prefer using `context`
  @property({ type: String }) slug = "";
  // Primary routing context: determines whether this panel operates on an instance or a blueprint
  @property({ type: Object }) context!: PanelContext;

  // ── Panel navigation state ───────────────────────────────────────────────

  @state() private _activeTab = "info";
  @state() private _expanded = false;

  // ── File tab state ───────────────────────────────────────────────────────

  @state() private _fileCache = new Map<string, AgentFileContent>();
  @state() private _loadingFile = false;
  @state() private _editMode = false;
  @state() private _editContent = "";
  @state() private _editOriginal = "";
  @state() private _editTab: "edit" | "preview" = "edit";
  @state() private _fileSaving = false;
  @state() private _discardDialogOpen = false;
  @state() private _pendingTabSwitch: string | null = null;

  // ── Spawn links state ────────────────────────────────────────────────────

  @state() private _pendingRemovals = new Set<string>();
  @state() private _pendingAdditions = new Set<string>();
  @state() private _dropdownOpen = false;
  @state() private _saving = false;
  @state() private _error = "";

  // ── Agent field edit state ───────────────────────────────────────────────

  @state() private _fieldEditMode = false;
  @state() private _fieldSaving = false;
  @state() private _fieldError = "";
  @state() private _editName = "";
  @state() private _editRole = "";
  @state() private _editTags = "";
  @state() private _editNotes = "";
  @state() private _editProvider = "";
  @state() private _editModel = "";
  @state() private _providers: ProvidersResponse | null = null;
  @state() private _loadingProviders = false;

  // Skills state
  @state() private _editSkills: string[] | null = null;
  @state() private _availableSkills: SkillInfo[] = [];
  @state() private _skillsAvailable = false;
  @state() private _loadingSkills = false;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  private async _loadFile(filename: string): Promise<void> {
    if (this._fileCache.has(filename)) return;
    this._loadingFile = true;
    try {
      let content: AgentFileContent;
      if (this.context.kind === "blueprint") {
        // Blueprint context: use blueprint-specific API
        content = await fetchBlueprintAgentFile(
          this.context.blueprintId,
          this.agent.agent_id,
          filename,
        );
      } else {
        // Instance context: use instance-specific API
        content = await fetchAgentFile(this.context.slug, this.agent.agent_id, filename);
      }
      this._fileCache = new Map(this._fileCache).set(filename, content);
    } catch {
      // Ignore — file may not be synced yet
    } finally {
      this._loadingFile = false;
    }
  }

  private _selectTab(tab: string): void {
    if (this._editMode && this._editContent !== this._editOriginal) {
      this._pendingTabSwitch = tab;
      this._discardDialogOpen = true;
      return;
    }
    this._editMode = false;
    this._activeTab = tab;
    if (tab !== "info") {
      void this._loadFile(tab);
    }
  }

  private _toggleExpand(): void {
    this._expanded = !this._expanded;
    if (this._expanded) {
      this.classList.add("expanded");
    } else {
      this.classList.remove("expanded");
    }
    // Notify parent (e.g. Settings drawer) so it can resize accordingly
    this.dispatchEvent(
      new CustomEvent("panel-expand-changed", {
        detail: { expanded: this._expanded },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // Reset tab and pending state when agent changes
  override updated(changed: Map<string, unknown>): void {
    if (changed.has("agent")) {
      this._activeTab = "info";
      this._fileCache = new Map();
      this._pendingRemovals = new Set();
      this._pendingAdditions = new Set();
      this._dropdownOpen = false;
      this._editMode = false;
      this._editContent = "";
      this._editOriginal = "";
      this._error = "";
      this._discardDialogOpen = false;
      this._pendingTabSwitch = null;
      this._fieldEditMode = false;
      this._fieldError = "";
    }
  }

  // ── Agent field edit ─────────────────────────────────────────────────────

  private _resolveModel(raw: string | null): string | null {
    if (!raw) return null;
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return (parsed["primary"] as string | undefined) ?? raw;
      } catch {
        return raw;
      }
    }
    return raw;
  }

  private async _enterFieldEditMode(): Promise<void> {
    const a = this.agent;
    this._editName = a.name ?? "";
    this._editRole = a.role ?? "";
    this._editTags = a.tags ?? "";
    this._editNotes = a.notes ?? "";

    // Résoudre provider/model depuis le champ model brut
    const rawModel = this._resolveModel(a.model ?? "") ?? "";
    const parts = rawModel.split("/");
    this._editProvider = parts[0] ?? "";
    this._editModel = parts.slice(1).join("/");

    this._fieldEditMode = true;
    this._fieldError = "";

    // Initialiser l'état skills depuis l'agent courant
    this._editSkills = this.agent.skills;

    // Charger les skills disponibles si contexte instance
    if (this.context.kind === "instance") {
      this._loadingSkills = true;
      try {
        const res: SkillsListResponse = await fetchInstanceSkills(this.context.slug);
        this._availableSkills = res.skills;
        this._skillsAvailable = res.available;
      } catch {
        this._skillsAvailable = false;
        this._availableSkills = [];
      } finally {
        this._loadingSkills = false;
      }
    }

    // Charger les providers pour le select
    if (!this._providers) {
      this._loadingProviders = true;
      try {
        this._providers = await fetchProviders();
      } catch {
        // Non bloquant — le select sera vide
      } finally {
        this._loadingProviders = false;
      }
    }
  }

  private _cancelFieldEdit(): void {
    this._fieldEditMode = false;
    this._fieldError = "";
  }

  private async _saveFields(): Promise<void> {
    if (!this.agent || !this.context) return;
    const a = this.agent;

    this._fieldSaving = true;
    this._fieldError = "";

    try {
      if (this.context.kind === "instance") {
        const slug = this.context.slug;
        const promises: Promise<unknown>[] = [];

        // --- Config patch (name / model / skills) ---
        const resolvedCurrentModel = this._resolveModel(a.model ?? "") ?? "";
        const newModel =
          this._editProvider && this._editModel ? `${this._editProvider}/${this._editModel}` : "";
        const skillsChanged = JSON.stringify(this._editSkills) !== JSON.stringify(a.skills);
        const configChanged =
          this._editName !== (a.name ?? "") || newModel !== resolvedCurrentModel || skillsChanged;

        if (configChanged) {
          const agentPatch: {
            id: string;
            name?: string;
            model?: string | null;
            skills?: string[] | null;
          } = { id: a.agent_id };
          if (this._editName !== (a.name ?? "")) agentPatch.name = this._editName;
          if (newModel !== resolvedCurrentModel) agentPatch.model = newModel || null;
          if (skillsChanged) agentPatch.skills = this._editSkills;
          promises.push(patchInstanceConfig(slug, { agents: [agentPatch] }));
        }

        // --- Meta patch (role / tags / notes) ---
        const metaPatch: AgentMetaPatch = {};
        if (this._editRole !== (a.role ?? "")) metaPatch.role = this._editRole || null;
        if (this._editTags !== (a.tags ?? "")) metaPatch.tags = this._editTags || null;
        if (this._editNotes !== (a.notes ?? "")) metaPatch.notes = this._editNotes || null;

        if (Object.keys(metaPatch).length > 0) {
          promises.push(updateAgentMeta(slug, a.agent_id, metaPatch));
        }

        if (promises.length === 0) {
          this._fieldEditMode = false;
          return;
        }

        await Promise.all(promises);
      } else {
        // Blueprint context — tout passe par updateBlueprintAgentMeta
        const skillsChanged = JSON.stringify(this._editSkills) !== JSON.stringify(a.skills);
        const metaPatch: AgentMetaPatch = {};
        if (this._editRole !== (a.role ?? "")) metaPatch.role = this._editRole || null;
        if (this._editTags !== (a.tags ?? "")) metaPatch.tags = this._editTags || null;
        if (this._editNotes !== (a.notes ?? "")) metaPatch.notes = this._editNotes || null;
        if (skillsChanged) metaPatch.skills = this._editSkills;

        if (Object.keys(metaPatch).length === 0) {
          this._fieldEditMode = false;
          return;
        }

        await updateBlueprintAgentMeta(this.context.blueprintId, a.agent_id, metaPatch);
      }

      this._fieldEditMode = false;
      this.dispatchEvent(
        new CustomEvent("agent-meta-updated", {
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._fieldError = userMessage(err);
    } finally {
      this._fieldSaving = false;
    }
  }

  private _renderFieldEditForm() {
    const providers = this._providers?.providers ?? [];

    return html`
      <div class="info-row">
        ${this._fieldError ? html`<div class="file-save-error">${this._fieldError}</div>` : nothing}

        <div class="info-item">
          <label class="info-label">${msg("Name", { id: "adp-edit-name" })}</label>
          <input
            class="field-edit-input"
            type="text"
            .value=${this._editName}
            @input=${(e: Event) => {
              this._editName = (e.target as HTMLInputElement).value;
            }}
          />
        </div>

        <div class="info-item">
          <label class="info-label">${msg("Provider", { id: "adp-edit-provider" })}</label>
          ${this._loadingProviders
            ? html`<span class="loading-text"
                >${msg("Loading...", { id: "adp-loading-providers" })}</span
              >`
            : html`
                <select
                  class="field-edit-input"
                  @change=${(e: Event) => {
                    this._editProvider = (e.target as HTMLSelectElement).value;
                    this._editModel = "";
                  }}
                >
                  <option value="">
                    ${msg("— select provider —", { id: "adp-edit-provider-placeholder" })}
                  </option>
                  ${providers.map(
                    (p) => html`
                      <option value=${p.id} ?selected=${p.id === this._editProvider}>
                        ${p.label}
                      </option>
                    `,
                  )}
                </select>
              `}
        </div>

        <div class="info-item">
          <label class="info-label">${msg("Model", { id: "adp-edit-model" })}</label>
          ${(() => {
            const provider = providers.find((p) => p.id === this._editProvider);
            const models = provider?.models ?? [];
            return html`
              <select
                class="field-edit-input"
                @change=${(e: Event) => {
                  this._editModel = (e.target as HTMLSelectElement).value;
                }}
              >
                <option value="">
                  ${msg("— select model —", { id: "adp-edit-model-placeholder" })}
                </option>
                ${models.map(
                  (m) => html`
                    <option value=${m} ?selected=${m === this._editModel}>${m}</option>
                  `,
                )}
              </select>
            `;
          })()}
        </div>

        <div class="info-item">
          <label class="info-label">${msg("Role", { id: "adp-edit-role" })}</label>
          <input
            class="field-edit-input"
            type="text"
            .value=${this._editRole}
            @input=${(e: Event) => {
              this._editRole = (e.target as HTMLInputElement).value;
            }}
          />
        </div>

        <div class="info-item">
          <label class="info-label">
            ${msg("Tags", { id: "adp-edit-tags" })}
            <span class="info-hint"
              >${msg("CSV, ex: rh, legal", { id: "adp-edit-tags-hint" })}</span
            >
          </label>
          <input
            class="field-edit-input"
            type="text"
            .value=${this._editTags}
            @input=${(e: Event) => {
              this._editTags = (e.target as HTMLInputElement).value;
            }}
          />
        </div>

        <div class="info-item">
          <label class="info-label">${msg("Notes", { id: "adp-edit-notes" })}</label>
          <textarea
            class="field-edit-textarea"
            rows="3"
            .value=${this._editNotes}
            @input=${(e: Event) => {
              this._editNotes = (e.target as HTMLTextAreaElement).value;
            }}
          ></textarea>
        </div>

        <div class="info-item">
          <label class="info-label">${msg("Skills", { id: "adp-label-skills" })}</label>
          <div class="skills-toggle">
            <button
              class="skills-toggle-btn ${this._editSkills === null ? "active" : ""}"
              @click=${() => {
                this._editSkills = null;
              }}
            >
              ${msg("All", { id: "adp-skills-all" })}
            </button>
            <button
              class="skills-toggle-btn ${Array.isArray(this._editSkills) &&
              this._editSkills.length === 0
                ? "active"
                : ""}"
              @click=${() => {
                this._editSkills = [];
              }}
            >
              ${msg("None", { id: "adp-skills-none" })}
            </button>
            <button
              class="skills-toggle-btn ${Array.isArray(this._editSkills) &&
              this._editSkills.length > 0
                ? "active"
                : ""}"
              @click=${() => {
                if (!Array.isArray(this._editSkills) || this._editSkills.length === 0)
                  this._editSkills = [];
              }}
            >
              ${msg("Custom", { id: "adp-skills-custom" })}
            </button>
          </div>
          ${Array.isArray(this._editSkills)
            ? this._skillsAvailable && this._availableSkills.length > 0
              ? html`
                  ${this._loadingSkills
                    ? html`<span class="loading-text"
                        >${msg("Loading skills…", { id: "adp-skills-loading" })}</span
                      >`
                    : html`
                        <div class="skills-grid">
                          ${this._availableSkills.map((skill) => {
                            const checked = (this._editSkills ?? []).includes(skill.name);
                            return html`
                              <label
                                class="skills-grid-label ${skill.eligible ? "" : "ineligible"}"
                              >
                                <input
                                  type="checkbox"
                                  .checked=${checked}
                                  ?disabled=${!skill.eligible}
                                  @change=${(e: Event) => {
                                    const cb = e.target as HTMLInputElement;
                                    const current = [...(this._editSkills ?? [])];
                                    if (cb.checked) {
                                      if (!current.includes(skill.name)) current.push(skill.name);
                                    } else {
                                      const idx = current.indexOf(skill.name);
                                      if (idx !== -1) current.splice(idx, 1);
                                    }
                                    this._editSkills = current;
                                  }}
                                />
                                ${skill.emoji ? html`<span>${skill.emoji}</span>` : nothing}
                                <span>${skill.name}</span>
                              </label>
                            `;
                          })}
                        </div>
                      `}
                `
              : html`
                  <input
                    class="field-edit-input"
                    type="text"
                    placeholder=${msg("Comma-separated skill names", {
                      id: "adp-edit-skills-hint",
                    })}
                    .value=${(this._editSkills ?? []).join(", ")}
                    @input=${(e: Event) => {
                      const val = (e.target as HTMLInputElement).value;
                      this._editSkills = val
                        .split(",")
                        .map((s) => s.trim())
                        .filter((s) => s.length > 0);
                    }}
                  />
                  ${this.context.kind === "instance"
                    ? html`<span class="info-hint"
                        >${msg("Instance offline — enter skill names manually", {
                          id: "adp-skills-unavailable",
                        })}</span
                      >`
                    : nothing}
                `
            : nothing}
        </div>

        <div class="field-edit-actions">
          <button
            class="btn-file-save"
            ?disabled=${this._fieldSaving}
            @click=${() => void this._saveFields()}
          >
            ${this._fieldSaving
              ? msg("Saving...", { id: "adp-edit-saving" })
              : msg("Save", { id: "adp-edit-save" })}
          </button>
          <button
            class="btn-file-cancel"
            ?disabled=${this._fieldSaving}
            @click=${() => this._cancelFieldEdit()}
          >
            ${msg("Cancel", { id: "adp-edit-cancel" })}
          </button>
        </div>
      </div>
    `;
  }

  // ── Spawn links management ───────────────────────────────────────────────

  private _emitPendingAdditions(additions: Set<string>): void {
    this.dispatchEvent(
      new CustomEvent("pending-additions-changed", {
        detail: { agentId: this.agent.agent_id, pendingAdditions: new Set(additions) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _cancelPendingChanges(): void {
    this._pendingRemovals = new Set();
    this._pendingAdditions = new Set();
    this._dropdownOpen = false;
    this._error = "";
    this.dispatchEvent(
      new CustomEvent("pending-removals-changed", {
        detail: { pendingRemovals: new Set() },
        bubbles: true,
        composed: true,
      }),
    );
    this._emitPendingAdditions(new Set());
  }

  private _addSpawnLink(targetId: string): void {
    const next = new Set(this._pendingAdditions).add(targetId);
    this._pendingAdditions = next;
    this._dropdownOpen = false;
    this._error = "";
    this._emitPendingAdditions(next);
  }

  private _cancelAddition(targetId: string): void {
    const next = new Set(this._pendingAdditions);
    next.delete(targetId);
    this._pendingAdditions = next;
    this._emitPendingAdditions(next);
  }

  private _toggleSpawnRemoval(targetId: string): void {
    const next = new Set(this._pendingRemovals);
    if (next.has(targetId)) {
      next.delete(targetId);
    } else {
      next.add(targetId);
    }
    this._pendingRemovals = next;
    this._error = "";
    this.dispatchEvent(
      new CustomEvent("pending-removals-changed", {
        detail: { pendingRemovals: new Set(next) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async _saveSpawnLinks(spawnLinks: { target_agent_id: string }[]): Promise<void> {
    this._saving = true;
    try {
      const remaining = spawnLinks
        .map((l) => l.target_agent_id)
        .filter((id) => !this._pendingRemovals.has(id));
      const added = Array.from(this._pendingAdditions);
      const targets = [...new Set([...remaining, ...added])];

      let result: { ok: boolean; links: AgentLink[] };
      if (this.context.kind === "blueprint") {
        // Blueprint context: use blueprint-specific spawn links API
        result = await updateBlueprintSpawnLinks(
          this.context.blueprintId,
          this.agent.agent_id,
          targets,
        );
      } else {
        // Instance context: use instance-specific spawn links API
        result = await updateSpawnLinks(this.context.slug, this.agent.agent_id, targets);
      }

      this._pendingRemovals = new Set();
      this._pendingAdditions = new Set();
      this._dropdownOpen = false;
      // Notify canvas: no more pending removals/additions
      this.dispatchEvent(
        new CustomEvent("pending-removals-changed", {
          detail: { pendingRemovals: new Set() },
          bubbles: true,
          composed: true,
        }),
      );
      this._emitPendingAdditions(new Set());
      // Propagate updated links to parent (agents-builder will re-fetch)
      this.dispatchEvent(
        new CustomEvent("spawn-links-updated", {
          detail: { links: result.links },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._saving = false;
    }
  }

  // ── File tab edit mode ───────────────────────────────────────────────────

  private _enterEditMode(filename: string): void {
    const cached = this._fileCache.get(filename);
    if (!cached) return;
    this._editOriginal = cached.content ?? "";
    this._editContent = this._editOriginal;
    this._editTab = "edit";
    this._error = "";
    this._editMode = true;
  }

  private _cancelEdit(): void {
    if (this._editContent !== this._editOriginal) {
      this._discardDialogOpen = true;
    } else {
      this._exitEditMode();
    }
  }

  private _exitEditMode(): void {
    this._editMode = false;
    this._editContent = "";
    this._editOriginal = "";
    this._error = "";
    this._discardDialogOpen = false;
    this._pendingTabSwitch = null;
  }

  private _confirmDiscard(): void {
    if (this._pendingTabSwitch) {
      const target = this._pendingTabSwitch;
      this._exitEditMode();
      this._activeTab = target;
      if (target !== "info") void this._loadFile(target);
    } else {
      this._exitEditMode();
    }
  }

  private async _saveFile(filename: string): Promise<void> {
    if (!this.agent || !this.context) return;
    this._fileSaving = true;
    this._error = "";
    try {
      let updated: AgentFileContent;
      if (this.context.kind === "blueprint") {
        // Blueprint context: use blueprint-specific file update API
        updated = await updateBlueprintAgentFile(
          this.context.blueprintId,
          this.agent.agent_id,
          filename,
          this._editContent,
        );
      } else {
        // Instance context: use instance-specific file update API
        updated = await updateAgentFile(
          this.context.slug,
          this.agent.agent_id,
          filename,
          this._editContent,
        );
      }
      this._fileCache = new Map(this._fileCache).set(filename, updated);
      this._exitEditMode();
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._fileSaving = false;
    }
  }

  // ── Render helpers ───────────────────────────────────────────────────────

  private _renderMarkdown(content: string) {
    const rawHtml = marked.parse(content) as string;
    const clean = DOMPurify.sanitize(rawHtml);
    return html`<div class="md-render" .innerHTML=${clean}></div>`;
  }

  private _renderInfo() {
    if (this._fieldEditMode) return this._renderFieldEditForm();
    const a = this.agent;
    const spawnLinks = this.links.filter(
      (l) => l.link_type === "spawn" && l.source_agent_id === a.agent_id,
    );
    const receivedSpawn = this.links.filter(
      (l) => l.link_type === "spawn" && l.target_agent_id === a.agent_id,
    );

    return html`
      <div class="info-row">
        ${a.model
          ? html`
              <div class="info-item">
                <span class="info-label">${msg("Model", { id: "adp-label-model" })}</span>
                <span class="info-value">${this._resolveModel(a.model)}</span>
              </div>
            `
          : ""}
        <div class="info-item">
          <span class="info-label">${msg("Workspace", { id: "adp-label-workspace" })}</span>
          <span class="info-value">${a.workspace_path}</span>
        </div>
        ${a.synced_at && this.context?.kind !== "blueprint"
          ? html`
              <div class="info-item">
                <span class="info-label">${msg("Last sync", { id: "adp-label-last-sync" })}</span>
                <span class="info-value">${a.synced_at}</span>
              </div>
            `
          : ""}
        ${(() => {
          // Agents already linked as spawn targets (from saved state)
          const linkedIds = new Set(spawnLinks.map((l) => l.target_agent_id));
          // Available agents: all agents except self, already linked, and pending additions
          const availableAgents = this.allAgents.filter(
            (ag) =>
              ag.agent_id !== a.agent_id &&
              !linkedIds.has(ag.agent_id) &&
              !this._pendingAdditions.has(ag.agent_id),
          );
          const hasSpawnSection =
            spawnLinks.length > 0 || this._pendingAdditions.size > 0 || availableAgents.length > 0;
          if (!hasSpawnSection) return "";
          return html`
            <div class="info-item">
              <span class="info-label">${msg("Delegates to", { id: "adp-label-can-spawn" })}</span>
              <div class="links-list">
                ${spawnLinks.map((l) => {
                  const isPending = this._pendingRemovals.has(l.target_agent_id);
                  return html`
                    <span
                      class="link-badge spawn spawn-editable ${isPending ? "pending-removal" : ""}"
                    >
                      → ${l.target_agent_id}
                      <button
                        class="spawn-remove-btn"
                        title=${isPending ? "Restore" : "Remove"}
                        @click=${() => this._toggleSpawnRemoval(l.target_agent_id)}
                      >
                        ${isPending ? "↩" : "✕"}
                      </button>
                    </span>
                  `;
                })}
                ${Array.from(this._pendingAdditions).map(
                  (id) => html`
                    <span class="link-badge spawn spawn-editable spawn-pending-add">
                      → ${id}
                      <button
                        class="spawn-remove-btn"
                        title="Cancel"
                        @click=${() => this._cancelAddition(id)}
                      >
                        ✕
                      </button>
                    </span>
                  `,
                )}
                ${availableAgents.length > 0
                  ? html`
                      <div class="spawn-add-wrap">
                        <button
                          class="spawn-add-btn"
                          title=${msg("Add agent", { id: "adp-btn-add-spawn" })}
                          @click=${() => {
                            this._dropdownOpen = !this._dropdownOpen;
                          }}
                        >
                          ＋
                        </button>
                        ${this._dropdownOpen
                          ? html`
                              <div class="spawn-dropdown">
                                ${availableAgents.map(
                                  (ag) => html`
                                    <button
                                      class="spawn-dropdown-item"
                                      @click=${() => this._addSpawnLink(ag.agent_id)}
                                    >
                                      ${ag.agent_id}
                                    </button>
                                  `,
                                )}
                              </div>
                            `
                          : ""}
                      </div>
                    `
                  : ""}
              </div>
            </div>
          `;
        })()}
        ${receivedSpawn.length > 0
          ? html`
              <div class="info-item">
                <span class="info-label"
                  >${msg("Delegated by", { id: "adp-label-spawned-by" })}</span
                >
                <div class="links-list">
                  ${receivedSpawn.map(
                    (l) => html`<span class="link-badge spawn">← ${l.source_agent_id}</span>`,
                  )}
                </div>
              </div>
            `
          : ""}
        ${a.notes
          ? html`
              <div class="info-item">
                <span class="info-label">${msg("Notes", { id: "adp-label-notes" })}</span>
                <p class="notes-text">${a.notes}</p>
              </div>
            `
          : ""}
        ${(() => {
          const skills = a.skills;
          if (skills === null) {
            return html`
              <div class="info-item">
                <span class="info-label">${msg("Skills", { id: "adp-label-skills" })}</span>
                <div class="skills-badges">
                  <span class="skill-badge muted"
                    >${msg("All skills", { id: "adp-skills-all" })}</span
                  >
                </div>
              </div>
            `;
          }
          if (skills.length === 0) {
            return html`
              <div class="info-item">
                <span class="info-label">${msg("Skills", { id: "adp-label-skills" })}</span>
                <div class="skills-badges">
                  <span class="skill-badge muted"
                    >${msg("No skills", { id: "adp-skills-none" })}</span
                  >
                </div>
              </div>
            `;
          }
          return html`
            <div class="info-item">
              <span class="info-label">${msg("Skills", { id: "adp-label-skills" })}</span>
              <div class="skills-badges">
                ${skills.map((s) => html`<span class="skill-badge">${s}</span>`)}
              </div>
            </div>
          `;
        })()}
      </div>
    `;
  }

  private _renderFileTab(filename: string) {
    const cached = this._fileCache.get(filename);
    const isEditable = EDITABLE_FILES.has(filename);

    if (this._loadingFile && !cached) {
      return html`<p class="loading-text">
        ${msg("Loading", { id: "adp-loading-file" })} ${filename}…
      </p>`;
    }

    if (!cached) {
      return html`<p class="loading-text">
        ${msg("File not available.", { id: "adp-file-not-available" })}
      </p>`;
    }

    if (this._editMode && isEditable) {
      return html`
        <div class="file-edit-header">
          <span class="badge-editing">${msg("Editing", { id: "adf-badge-editing" })}</span>
          <div class="editor-tabs">
            <button
              class="editor-tab ${this._editTab === "edit" ? "active" : ""}"
              @click=${() => {
                this._editTab = "edit";
              }}
            >
              ${msg("Edit", { id: "adf-tab-edit" })}
            </button>
            <button
              class="editor-tab ${this._editTab === "preview" ? "active" : ""}"
              @click=${() => {
                this._editTab = "preview";
              }}
            >
              ${msg("Preview", { id: "adf-tab-preview" })}
            </button>
          </div>
          <div class="editor-actions">
            <button
              class="btn-file-save"
              ?disabled=${this._fileSaving}
              @click=${() => void this._saveFile(filename)}
            >
              ${this._fileSaving
                ? msg("Saving...", { id: "adf-btn-saving" })
                : msg("Save", { id: "adf-btn-save" })}
            </button>
            <button
              class="btn-file-cancel"
              ?disabled=${this._fileSaving}
              @click=${() => this._cancelEdit()}
            >
              ${msg("Cancel", { id: "adf-btn-cancel" })}
            </button>
          </div>
        </div>
        ${this._error ? html`<div class="file-save-error">${this._error}</div>` : nothing}
        ${this._editTab === "edit"
          ? html`<textarea
              class="file-editor"
              .value=${this._editContent}
              @input=${(e: InputEvent) => {
                this._editContent = (e.target as HTMLTextAreaElement).value;
              }}
            ></textarea>`
          : this._renderMarkdown(this._editContent)}
        ${this._discardDialogOpen
          ? html`
              <div class="discard-overlay">
                <div class="discard-dialog">
                  <h3 class="discard-title">
                    ${msg("Discard changes?", { id: "adf-confirm-discard-title" })}
                  </h3>
                  <p class="discard-body">
                    ${msg("Your changes will be lost.", { id: "adf-confirm-discard-body" })}
                  </p>
                  <div class="discard-actions">
                    <button
                      class="btn-keep-editing"
                      @click=${() => {
                        this._discardDialogOpen = false;
                        this._pendingTabSwitch = null;
                      }}
                    >
                      ${msg("Keep editing", { id: "adf-confirm-keep" })}
                    </button>
                    <button class="btn-discard" @click=${() => this._confirmDiscard()}>
                      ${msg("Discard", { id: "adf-confirm-discard-ok" })}
                    </button>
                  </div>
                </div>
              </div>
            `
          : nothing}
      `;
    }

    // Consultation mode
    return html`
      <div class="file-badge">
        <span class="${isEditable ? "badge-editable" : "badge-readonly"}">
          ${isEditable
            ? msg("editable", { id: "adp-badge-editable" })
            : msg("read-only", { id: "adp-badge-readonly" })}
        </span>
        ${isEditable
          ? html`
              <button
                class="btn-edit-file"
                title=${msg("Edit", { id: "adf-btn-edit" })}
                @click=${() => this._enterEditMode(filename)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
            `
          : nothing}
      </div>
      ${this._renderMarkdown(cached.content ?? "")}
    `;
  }

  override render() {
    const a = this.agent;
    const fileTabs = a.files.map((f) => f.filename);
    const spawnLinks = this.links.filter(
      (l) => l.link_type === "spawn" && l.source_agent_id === a.agent_id,
    );

    return html`
      <div class="panel-header">
        <div class="panel-header-info">
          <div class="agent-name-row">
            <span class="agent-name">${a.name}</span>
            <span class="agent-id-label">${a.agent_id}</span>
          </div>
          ${a.role ? html`<div class="agent-role-label">${a.role}</div>` : ""}
        </div>
        <div class="panel-controls">
          ${this.context?.kind === "instance"
            ? html`
                <button
                  class="panel-btn"
                  aria-label=${msg("Edit agent", { id: "adp-btn-edit-agent" })}
                  title=${msg("Edit agent", { id: "adp-btn-edit-agent" })}
                  @click=${() => void this._enterFieldEditMode()}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
              `
            : nothing}
          ${!a.is_default
            ? html`
                <button
                  class="panel-btn danger"
                  aria-label=${msg("Delete agent", { id: "adp-btn-delete-agent" })}
                  title=${msg("Delete agent", { id: "adp-btn-delete-agent" })}
                  @click=${() =>
                    this.dispatchEvent(
                      new CustomEvent("agent-delete-requested", {
                        detail: { agentId: a.agent_id },
                        bubbles: true,
                        composed: true,
                      }),
                    )}
                >
                  🗑
                </button>
              `
            : ""}
          <button
            class="panel-btn"
            aria-label=${this._expanded
              ? msg("Collapse", { id: "adp-btn-collapse" })
              : msg("Expand", { id: "adp-btn-expand" })}
            title=${this._expanded
              ? msg("Collapse", { id: "adp-btn-collapse" })
              : msg("Expand", { id: "adp-btn-expand" })}
            @click=${this._toggleExpand}
          >
            ${this._expanded
              ? html`<svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>`
              : html`<svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>`}
          </button>
          <button
            class="panel-btn"
            aria-label="Fermer"
            title=${msg("Close", { id: "adp-btn-close" })}
            @click=${() =>
              this.dispatchEvent(new CustomEvent("panel-close", { bubbles: true, composed: true }))}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div class="tabs">
        <button
          class="tab ${this._activeTab === "info" ? "active" : ""}"
          @click=${() => this._selectTab("info")}
        >
          ${msg("Info", { id: "adp-tab-info" })}
        </button>
        ${fileTabs.map(
          (f) => html`
            <button
              class="tab ${this._activeTab === f ? "active" : ""}"
              @click=${() => this._selectTab(f)}
            >
              ${f}
            </button>
          `,
        )}
      </div>

      <div
        class="panel-body ${this._pendingRemovals.size > 0 || this._pendingAdditions.size > 0
          ? "has-save-bar"
          : ""}"
      >
        ${this._activeTab === "info" ? this._renderInfo() : this._renderFileTab(this._activeTab)}
      </div>

      ${this._pendingRemovals.size > 0 || this._pendingAdditions.size > 0
        ? html`
            <div class="spawn-save-bar">
              <button
                class="btn-save-spawn"
                ?disabled=${this._saving}
                @click=${() => void this._saveSpawnLinks(spawnLinks)}
              >
                ${this._saving
                  ? msg("Saving...", { id: "adp-saving" })
                  : msg("Save", { id: "adp-btn-save" })}
              </button>
              ${this._error
                ? html`<span class="save-hint save-error">${this._error}</span>`
                : html`<span class="save-hint"
                    >${this._pendingRemovals.size + this._pendingAdditions.size}
                    change${this._pendingRemovals.size + this._pendingAdditions.size > 1 ? "s" : ""}
                    pending</span
                  >`}
              <button
                class="btn-cancel-spawn"
                ?disabled=${this._saving}
                @click=${this._cancelPendingChanges}
              >
                ${msg("Cancel", { id: "adp-btn-cancel-spawn" })}
              </button>
            </div>
          `
        : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-detail-panel": AgentDetailPanel;
  }
}
