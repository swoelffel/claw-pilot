// ui/src/components/agent-detail-panel.ts
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import {
  type AgentBuilderInfo,
  type AgentLink,
  type PanelContext,
  type AgentMetaPatch,
  type SkillInfo,
  AGENT_ARCHETYPES,
  isArchetypeLink,
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
  fetchInstanceConfig,
  fetchToolProfiles,
  fetchProviders,
  fetchProfileProviders,
  updateBlueprintAgentMeta,
  fetchInstanceSkills,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles, spinnerStyles } from "../styles/shared.js";
import { agentDetailPanelStyles } from "../styles/agent-detail-panel.styles.js";
import { getToken } from "../services/auth-state.js";
import "./agent-file-editor.js";

const EDITABLE_FILES = new Set(["AGENTS.md", "SOUL.md", "BOOTSTRAP.md", "USER.md", "HEARTBEAT.md"]);

@localized()
@customElement("cp-agent-detail-panel")
export class AgentDetailPanel extends LitElement {
  static override styles = [tokenStyles, sectionLabelStyles, spinnerStyles, agentDetailPanelStyles];

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

  // ── Spawn links state ────────────────────────────────────────────────────

  @state() private _pendingRemovals = new Set<string>();
  @state() private _pendingAdditions = new Set<string>();
  @state() private _dropdownOpen = false;
  @state() private _saving = false;
  @state() private _error = "";

  // ── Info tab state (always-editable, save bar pattern) ──────────────────

  @state() private _editName = "";
  @state() private _editRole = "";
  @state() private _editTags = "";
  @state() private _editNotes = "";
  @state() private _editProvider = "";
  @state() private _editModel = "";
  // null = All skills, [] = None, [...] = custom list
  @state() private _editSkills: string[] | null = null;
  // Available skills for the picker (lazy-loaded from API)
  @state() private _availableSkills: SkillInfo[] = [];
  @state() private _loadingSkills = false;
  @state() private _skillsDirty = false;
  @state() private _skillsSaving = false;
  @state() private _skillsError = "";
  @state() private _autoSelectSkills = false;
  @state() private _autoSelectSkillsOriginal = false;
  // Providers list for the provider/model selects (lazy-loaded)
  @state() private _providers: { id: string; label: string; models: string[] }[] | null = null;
  @state() private _loadingProviders = false;
  @state() private _infoDirty = false;
  @state() private _infoSaving = false;
  @state() private _infoError = "";

  // ── Config tab state ─────────────────────────────────────────────────────

  @state() private _cfgToolProfile = "executor";
  @state() private _cfgTemperature: number | null = null;
  @state() private _cfgMaxSteps = 20;
  @state() private _cfgPromptMode: "full" | "minimal" = "full";
  @state() private _cfgThinkingEnabled = false;
  @state() private _cfgBudgetTokens = 15000;
  @state() private _cfgAllowSubAgents = true;
  @state() private _cfgAllowedAgents: string[] = [];
  @state() private _cfgSessionTimeout = 300000;
  @state() private _cfgChunkTimeout = 120000;
  @state() private _cfgInstructionUrls: string[] = [];
  @state() private _cfgBootstrapFiles: string[] = [];
  @state() private _cfgArchetype: string | null = null;
  @state() private _cfgDirty = false;
  @state() private _cfgSaving = false;
  @state() private _cfgLoading = false;

  // ── Tools tab state ─────────────────────────────────────────────────────

  @state() private _toolsProfile = "executor";
  @state() private _toolsSelected: string[] = [];
  @state() private _toolsDirty = false;
  @state() private _toolsSaving = false;
  @state() private _toolsLoading = false;
  @state() private _toolsAllIds: string[] = [];
  @state() private _toolsProfiles: Record<string, string[]> = {};

  // ── Heartbeat tab state ──────────────────────────────────────────────────

  @state() private _hbEnabled = false;
  @state() private _hbInterval = "30m";
  @state() private _hbHoursStart = "";
  @state() private _hbHoursEnd = "";
  @state() private _hbTimezone = "";
  @state() private _hbModel = "";
  @state() private _hbMaxChars = 500;
  @state() private _hbPromptMode: "file" | "custom" = "file";
  @state() private _hbCustomPrompt = "";
  @state() private _hbDirty = false;
  @state() private _hbSaving = false;
  @state() private _hbError = "";
  @state() private _hbLoading = false;
  @state() private _hbTicks: Array<{
    messageId: string;
    createdAt: string;
    status: "ok" | "alert";
    responseText: string;
  }> = [];
  @state() private _hbLoadingHistory = false;

  // ── File editor stable callbacks ─────────────────────────────────────────
  // Must not be recreated inside render() — Lit uses === equality for prop diffing,
  // so new function references on every render would trigger spurious updated() cycles
  // in cp-agent-file-editor and could cause unwanted navigate events after save.

  private _loadFileFn: ((filename: string) => Promise<string>) | null = null;
  private _saveFileFn: ((filename: string, content: string) => Promise<void>) | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  private _selectTab(tab: string): void {
    this._activeTab = tab;
    if (tab === "heartbeat") {
      void this._loadHeartbeatHistory();
    }
  }

  // ── Config tab methods ───────────────────────────────────────────────────

  private async _initConfigTab(): Promise<void> {
    this._cfgLoading = true;
    this._cfgDirty = false;
    try {
      let cfg: Record<string, unknown> | undefined;
      if (this.context.kind === "instance") {
        const instanceConfig = await fetchInstanceConfig(this.context.slug);
        const agentEntry = instanceConfig.agents.find((a) => a.id === this.agent.agent_id);
        cfg = agentEntry as Record<string, unknown> | undefined;
      }
      this._cfgToolProfile =
        (cfg?.toolProfile as typeof this._cfgToolProfile | undefined) ?? "executor";
      this._cfgTemperature = (cfg?.temperature as number | undefined) ?? null;
      this._cfgMaxSteps = (cfg?.maxSteps as number | undefined) ?? 20;
      this._cfgPromptMode = (cfg?.promptMode as typeof this._cfgPromptMode | undefined) ?? "full";
      const thinking = cfg?.thinking as Record<string, unknown> | undefined;
      this._cfgThinkingEnabled = !!thinking?.enabled;
      this._cfgBudgetTokens = (thinking?.budgetTokens as number | undefined) ?? 15000;
      this._cfgAllowSubAgents = (cfg?.allowSubAgents as boolean | undefined) ?? true;
      this._cfgAllowedAgents = (cfg?.allowedAgents as string[] | undefined) ?? [];
      this._cfgSessionTimeout = (cfg?.timeoutMs as number | undefined) ?? 300000;
      this._cfgChunkTimeout = (cfg?.chunkTimeoutMs as number | undefined) ?? 120000;
      this._cfgInstructionUrls = (cfg?.instructionUrls as string[] | undefined) ?? [];
      this._cfgBootstrapFiles = (cfg?.bootstrapFiles as string[] | undefined) ?? [];
      this._cfgArchetype = (cfg?.archetype as string | null | undefined) ?? null;
      this._cfgDirty = false;
    } catch {
      // Silently fallback to defaults on error
    } finally {
      this._cfgLoading = false;
    }
  }

  private async _saveConfig(): Promise<void> {
    if (this.context.kind !== "instance") return;
    this._cfgSaving = true;
    try {
      const agentPatch: Record<string, unknown> = {
        id: this.agent.agent_id,
        maxSteps: this._cfgMaxSteps,
        promptMode: this._cfgPromptMode,
        thinking: this._cfgThinkingEnabled
          ? { enabled: true, budgetTokens: this._cfgBudgetTokens }
          : null,
        allowSubAgents: this._cfgAllowSubAgents,
        timeoutMs: this._cfgSessionTimeout,
        chunkTimeoutMs: this._cfgChunkTimeout,
        instructionUrls: this._cfgInstructionUrls.filter(Boolean),
        bootstrapFiles: this._cfgBootstrapFiles.filter(Boolean),
        archetype: this._cfgArchetype,
        ...(this._cfgTemperature !== null ? { temperature: this._cfgTemperature } : {}),
      };
      await patchInstanceConfig(this.context.slug, { agents: [agentPatch] });
      this._cfgDirty = false;
    } catch {
      // Silently ignore
    } finally {
      this._cfgSaving = false;
    }
  }

  private _renderConfigTab() {
    const PROMPT_MODES = ["full", "minimal"] as const;

    if (this._cfgLoading) {
      return html`<div class="tab-loading"><span class="spinner"></span></div>`;
    }

    return html`
      <div class="hb-tab">
        <!-- LLM section -->
        <div class="hb-section-title">${msg("LLM", { id: "cfg-llm" })}</div>
        <div class="hb-grid-2">
          <div class="hb-field">
            <label class="hb-label">${msg("Prompt mode", { id: "cfg-prompt-mode" })}</label>
            <select
              class="hb-select"
              .value=${this._cfgPromptMode}
              @change=${(e: Event) => {
                this._cfgPromptMode = (e.target as HTMLSelectElement)
                  .value as typeof this._cfgPromptMode;
                this._cfgDirty = true;
              }}
            >
              ${PROMPT_MODES.map(
                (m) =>
                  html`<option value=${m} ?selected=${this._cfgPromptMode === m}>${m}</option>`,
              )}
            </select>
          </div>
          <div class="hb-field">
            <label class="hb-label">${msg("Max steps", { id: "cfg-max-steps" })}</label>
            <input
              type="number"
              class="hb-input"
              min="1"
              max="100"
              .value=${String(this._cfgMaxSteps)}
              @change=${(e: Event) => {
                this._cfgMaxSteps = parseInt((e.target as HTMLInputElement).value, 10) || 20;
                this._cfgDirty = true;
              }}
            />
          </div>
          <div class="hb-field">
            <label class="hb-label">${msg("Temperature", { id: "cfg-temperature" })}</label>
            <input
              type="number"
              class="hb-input"
              min="0"
              max="2"
              step="0.1"
              placeholder=${msg("Default", { id: "cfg-temperature-default" })}
              .value=${this._cfgTemperature !== null ? String(this._cfgTemperature) : ""}
              @change=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                this._cfgTemperature = v ? parseFloat(v) : null;
                this._cfgDirty = true;
              }}
            />
          </div>
        </div>

        <!-- Extended thinking -->
        <div class="hb-section-title">
          ${msg("Extended thinking (Anthropic)", { id: "cfg-thinking" })}
        </div>
        <div class="hb-field-row">
          <label class="hb-label">${msg("Enable", { id: "cfg-thinking-enable" })}</label>
          <div
            class="toggle-track ${this._cfgThinkingEnabled ? "on" : ""}"
            @click=${() => {
              this._cfgThinkingEnabled = !this._cfgThinkingEnabled;
              this._cfgDirty = true;
            }}
          >
            <div class="toggle-thumb"></div>
          </div>
        </div>
        ${this._cfgThinkingEnabled
          ? html`
              <div class="hb-field" style="max-width:200px">
                <label class="hb-label">${msg("Budget tokens", { id: "cfg-budget-tokens" })}</label>
                <input
                  type="number"
                  class="hb-input"
                  min="1000"
                  max="100000"
                  .value=${String(this._cfgBudgetTokens)}
                  @change=${(e: Event) => {
                    this._cfgBudgetTokens =
                      parseInt((e.target as HTMLInputElement).value, 10) || 15000;
                    this._cfgDirty = true;
                  }}
                />
              </div>
            `
          : nothing}

        <!-- Spawn -->
        <div class="hb-section-title">${msg("Spawn", { id: "cfg-spawn" })}</div>
        <div class="hb-field-row">
          <label class="hb-label">${msg("Allow sub-agents", { id: "cfg-allow-subagents" })}</label>
          <div
            class="toggle-track ${this._cfgAllowSubAgents ? "on" : ""}"
            @click=${() => {
              this._cfgAllowSubAgents = !this._cfgAllowSubAgents;
              this._cfgDirty = true;
            }}
          >
            <div class="toggle-thumb"></div>
          </div>
        </div>

        <!-- Timeouts -->
        <div class="hb-section-title">${msg("Timeouts", { id: "cfg-timeouts" })}</div>
        <div class="hb-grid-2">
          <div class="hb-field">
            <label class="hb-label"
              >${msg("Session timeout (ms)", { id: "cfg-session-timeout" })}</label
            >
            <input
              type="number"
              class="hb-input"
              .value=${String(this._cfgSessionTimeout)}
              @change=${(e: Event) => {
                this._cfgSessionTimeout =
                  parseInt((e.target as HTMLInputElement).value, 10) || 300000;
                this._cfgDirty = true;
              }}
            />
          </div>
          <div class="hb-field">
            <label class="hb-label"
              >${msg("LLM inter-chunk timeout (ms)", { id: "cfg-chunk-timeout" })}</label
            >
            <input
              type="number"
              class="hb-input"
              .value=${String(this._cfgChunkTimeout)}
              @change=${(e: Event) => {
                this._cfgChunkTimeout =
                  parseInt((e.target as HTMLInputElement).value, 10) || 120000;
                this._cfgDirty = true;
              }}
            />
          </div>
        </div>

        <!-- Instruction URLs -->
        <div class="hb-section-title">${msg("Instructions", { id: "cfg-instructions" })}</div>
        <div class="hb-label" style="margin-bottom:6px">
          ${msg("Remote instruction URLs", { id: "cfg-instruction-urls" })}
        </div>
        ${this._cfgInstructionUrls.map(
          (url, i) => html`
            <div class="hb-field-row" style="margin-bottom:4px">
              <input
                type="url"
                class="hb-input"
                .value=${url}
                placeholder="https://..."
                @change=${(e: Event) => {
                  const next = [...this._cfgInstructionUrls];
                  next[i] = (e.target as HTMLInputElement).value;
                  this._cfgInstructionUrls = next;
                  this._cfgDirty = true;
                }}
              />
              <button
                class="btn-revoke"
                @click=${() => {
                  this._cfgInstructionUrls = this._cfgInstructionUrls.filter((_, j) => j !== i);
                  this._cfgDirty = true;
                }}
              >
                ✕
              </button>
            </div>
          `,
        )}
        <button
          class="btn-add-item"
          @click=${() => {
            this._cfgInstructionUrls = [...this._cfgInstructionUrls, ""];
            this._cfgDirty = true;
          }}
        >
          + URL
        </button>

        <!-- Bootstrap files -->
        <div class="hb-label" style="margin-top:10px;margin-bottom:6px">
          ${msg("Additional workspace files (globs)", { id: "cfg-bootstrap-files" })}
        </div>
        ${this._cfgBootstrapFiles.map(
          (glob, i) => html`
            <div class="hb-field-row" style="margin-bottom:4px">
              <input
                type="text"
                class="hb-input"
                .value=${glob}
                placeholder="docs/**/*.md"
                @change=${(e: Event) => {
                  const next = [...this._cfgBootstrapFiles];
                  next[i] = (e.target as HTMLInputElement).value;
                  this._cfgBootstrapFiles = next;
                  this._cfgDirty = true;
                }}
              />
              <button
                class="btn-revoke"
                @click=${() => {
                  this._cfgBootstrapFiles = this._cfgBootstrapFiles.filter((_, j) => j !== i);
                  this._cfgDirty = true;
                }}
              >
                ✕
              </button>
            </div>
          `,
        )}
        <button
          class="btn-add-item"
          @click=${() => {
            this._cfgBootstrapFiles = [...this._cfgBootstrapFiles, ""];
            this._cfgDirty = true;
          }}
        >
          + Glob
        </button>

        <!-- Archetype (behavioral pattern + routing) -->
        <div class="hb-section-title">${msg("Archetype", { id: "cfg-archetype" })}</div>
        <div class="hb-label" style="margin-bottom:6px">
          ${msg("Behavioral pattern for routing and system prompt", {
            id: "cfg-archetype-label",
          })}
        </div>
        <div class="hb-field-row">
          <select
            class="hb-input"
            .value=${this._cfgArchetype ?? ""}
            @change=${(e: Event) => {
              const val = (e.target as HTMLSelectElement).value;
              this._cfgArchetype = val || null;
              this._cfgDirty = true;
            }}
          >
            <option value="">${msg("None", { id: "cfg-archetype-none" })}</option>
            <option value="planner">planner</option>
            <option value="generator">generator</option>
            <option value="evaluator">evaluator</option>
            <option value="orchestrator">orchestrator</option>
            <option value="analyst">analyst</option>
            <option value="communicator">communicator</option>
          </select>
        </div>

        <!-- Save bar -->
        ${this._cfgDirty
          ? html`
              <div class="hb-save-bar">
                <button
                  class="btn-save-spawn"
                  ?disabled=${this._cfgSaving}
                  @click=${() => void this._saveConfig()}
                >
                  ${this._cfgSaving ? "…" : msg("Save", { id: "cfg-save" })}
                </button>
                <button
                  class="btn-cancel-spawn"
                  ?disabled=${this._cfgSaving}
                  @click=${() => void this._initConfigTab()}
                >
                  ${msg("Cancel", { id: "cfg-cancel" })}
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  // ── Heartbeat methods ────────────────────────────────────────────────────

  private async _initHeartbeatTab(): Promise<void> {
    this._hbLoading = true;
    this._hbDirty = false;
    this._hbError = "";
    try {
      let hb: Record<string, unknown> | undefined;
      if (this.context.kind === "instance") {
        const instanceConfig = await fetchInstanceConfig(this.context.slug);
        const agentEntry = instanceConfig.agents.find((a) => a.id === this.agent.agent_id);
        hb = agentEntry?.heartbeat as Record<string, unknown> | undefined;
      }
      this._hbEnabled = !!hb?.every; // heartbeat is enabled when `every` is set
      this._hbInterval = (hb?.every as string | undefined) ?? "30m";
      const ah = hb?.activeHours as Record<string, string> | undefined;
      this._hbHoursStart = ah?.start ?? "";
      this._hbHoursEnd = ah?.end ?? "";
      this._hbTimezone = ah?.tz ?? "";
      this._hbModel = (hb?.model as string | undefined) ?? "";
      this._hbMaxChars = (hb?.ackMaxChars as number | undefined) ?? 500;
      this._hbPromptMode = (hb?.prompt as string | undefined) ? "custom" : "file";
      this._hbCustomPrompt = (hb?.prompt as string | undefined) ?? "";
      this._hbDirty = false;
    } catch {
      // Silently fallback to defaults on error
    } finally {
      this._hbLoading = false;
    }
  }

  private async _loadHeartbeatHistory(): Promise<void> {
    if (this.context.kind !== "instance") return;
    this._hbLoadingHistory = true;
    try {
      const token = getToken();
      const res = await fetch(
        `/api/instances/${this.context.slug}/runtime/heartbeat/history?agentId=${this.agent.agent_id}&limit=20`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        ticks: Array<{
          messageId: string;
          createdAt: string;
          status: "ok" | "alert";
          responseText: string;
        }>;
      };
      this._hbTicks = data.ticks ?? [];
    } catch {
      // Silently ignore
    } finally {
      this._hbLoadingHistory = false;
    }
  }

  private async _saveHeartbeat(): Promise<void> {
    if (this.context.kind !== "instance") return;
    this._hbSaving = true;
    this._hbError = "";
    try {
      const heartbeat = this._hbEnabled
        ? {
            every: this._hbInterval,
            ...(this._hbHoursStart && this._hbHoursEnd
              ? {
                  activeHours: {
                    start: this._hbHoursStart,
                    end: this._hbHoursEnd,
                    ...(this._hbTimezone ? { tz: this._hbTimezone } : {}),
                  },
                }
              : {}),
            ...(this._hbModel ? { model: this._hbModel } : {}),
            ackMaxChars: this._hbMaxChars,
            ...(this._hbPromptMode === "custom" && this._hbCustomPrompt
              ? { prompt: this._hbCustomPrompt }
              : {}),
          }
        : null;
      await patchInstanceConfig(this.context.slug, {
        agents: [{ id: this.agent.agent_id, heartbeat }],
      });
      this._hbDirty = false;
    } catch (err) {
      this._hbError = userMessage(err);
    } finally {
      this._hbSaving = false;
    }
  }

  // ── Tools tab ──────────────────────────────────────────────────────────

  private async _initToolsTab(): Promise<void> {
    if (this.context.kind !== "instance") return;
    this._toolsLoading = true;
    this._toolsDirty = false;
    try {
      const [toolData, instanceConfig] = await Promise.all([
        fetchToolProfiles(this.context.slug),
        fetchInstanceConfig(this.context.slug),
      ]);
      this._toolsAllIds = [...toolData.tools];
      this._toolsProfiles = toolData.profiles;
      const agentEntry = instanceConfig.agents.find((a) => a.id === this.agent.agent_id);
      this._toolsProfile = (agentEntry?.toolProfile as string) ?? "executor";
      if (this._toolsProfile === "custom" && agentEntry) {
        this._toolsSelected =
          ((agentEntry as Record<string, unknown>).customTools as string[]) ?? [];
      } else {
        this._toolsSelected = [...(this._toolsProfiles[this._toolsProfile] ?? [])];
      }
    } catch {
      // Fallback
    } finally {
      this._toolsLoading = false;
    }
  }

  private async _saveTools(): Promise<void> {
    if (this.context.kind !== "instance") return;
    this._toolsSaving = true;
    try {
      const agentPatch: Record<string, unknown> = {
        id: this.agent.agent_id,
        toolProfile: this._toolsProfile,
        ...(this._toolsProfile === "custom" ? { customTools: this._toolsSelected } : {}),
      };
      await patchInstanceConfig(this.context.slug, { agents: [agentPatch] });
      this._toolsDirty = false;
    } catch {
      // Silently ignore
    } finally {
      this._toolsSaving = false;
    }
  }

  private _renderToolsTab() {
    if (this._toolsLoading) {
      return html`<div class="tab-loading"><span class="spinner"></span></div>`;
    }

    const PROFILE_DESCRIPTIONS: Record<string, string> = {
      sentinel: msg("Monitoring only — can ask questions", { id: "tools-desc-sentinel" }),
      pilot: msg("Orchestrator — sends messages, delegates tasks, no coding", {
        id: "tools-desc-pilot",
      }),
      executor: msg("Coding agent — full coding tools + messaging, no task delegation", {
        id: "tools-desc-executor",
      }),
      manager: msg("Manager — full coding tools + messaging + task delegation", {
        id: "tools-desc-manager",
      }),
      custom: msg("Custom selection of tools", { id: "tools-desc-custom" }),
    };

    const profiles = Object.keys(this._toolsProfiles).filter((p) => p !== "custom");
    const selectedSet = new Set(this._toolsSelected);

    return html`
      <div class="hb-tab">
        <div class="hb-section-title">${msg("Profile", { id: "tools-profile" })}</div>
        <div class="tools-profiles">
          ${[...profiles, "custom"].map(
            (p) => html`
              <label class="tools-profile-option ${this._toolsProfile === p ? "selected" : ""}">
                <input
                  type="radio"
                  name="tool-profile"
                  value=${p}
                  ?checked=${this._toolsProfile === p}
                  @change=${() => {
                    this._toolsProfile = p;
                    if (p !== "custom") {
                      this._toolsSelected = [...(this._toolsProfiles[p] ?? [])];
                    }
                    this._toolsDirty = true;
                  }}
                />
                <span class="tools-profile-name">${p}</span>
                <span class="tools-profile-desc">${PROFILE_DESCRIPTIONS[p] ?? ""}</span>
              </label>
            `,
          )}
        </div>

        <div class="hb-section-title" style="margin-top: 16px">
          ${msg("Available tools", { id: "tools-available" })}
        </div>
        <div class="tools-grid">
          ${this._toolsAllIds.map(
            (toolId) => html`
              <label class="tools-checkbox ${selectedSet.has(toolId) ? "checked" : ""}">
                <input
                  type="checkbox"
                  .checked=${selectedSet.has(toolId)}
                  @change=${(e: Event) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    if (checked) {
                      this._toolsSelected = [...this._toolsSelected, toolId];
                    } else {
                      this._toolsSelected = this._toolsSelected.filter((t) => t !== toolId);
                    }
                    // Auto-switch to custom if checkboxes diverge from profile
                    if (this._toolsProfile !== "custom") {
                      const profileTools = this._toolsProfiles[this._toolsProfile] ?? [];
                      const same =
                        this._toolsSelected.length === profileTools.length &&
                        this._toolsSelected.every((t) => profileTools.includes(t));
                      if (!same) this._toolsProfile = "custom";
                    }
                    this._toolsDirty = true;
                  }}
                />
                <span>${toolId}</span>
              </label>
            `,
          )}
        </div>

        ${this._toolsDirty
          ? html`
              <div class="hb-save-bar">
                <button
                  class="btn-save-spawn"
                  ?disabled=${this._toolsSaving}
                  @click=${() => void this._saveTools()}
                >
                  ${this._toolsSaving ? "…" : msg("Save", { id: "tools-save" })}
                </button>
                <button
                  class="btn-cancel-spawn"
                  ?disabled=${this._toolsSaving}
                  @click=${() => void this._initToolsTab()}
                >
                  ${msg("Cancel", { id: "tools-cancel" })}
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  // ── Skills tab ──────────────────────────────────────────────────────────

  private _renderSkillsTab() {
    if (this._loadingSkills) {
      return html`<div class="tab-loading"><span class="spinner"></span></div>`;
    }

    if (this._availableSkills.length === 0) {
      return html`
        <div class="hb-tab">
          <p style="color: var(--text-muted); font-size: 13px; padding: 16px 0;">
            ${msg("No skills available for this instance.", { id: "adp-skills-empty" })}
          </p>
        </div>
      `;
    }

    // null (All) means all skills are enabled — show all checked
    const isAll = this._editSkills === null;
    const selectedSet = isAll
      ? new Set(this._availableSkills.map((s) => s.name))
      : new Set(this._editSkills);

    return html`
      <div class="hb-tab">
        <!-- Auto-select toggle -->
        <div class="hb-field-row" style="margin-bottom: 4px;">
          <label class="hb-label">${msg("Auto-select", { id: "adp-skills-auto-select" })}</label>
          <div
            class="toggle-track ${this._autoSelectSkills ? "on" : ""}"
            @click=${() => {
              this._autoSelectSkills = !this._autoSelectSkills;
              this._skillsDirty = true;
            }}
          >
            <div class="toggle-thumb"></div>
          </div>
        </div>
        <p style="color: var(--text-muted); font-size: 12px; margin: 0 0 12px;">
          ${this._autoSelectSkills
            ? msg("Skills are auto-selected based on the conversation.", {
                id: "adp-skills-auto-hint",
              })
            : msg("Manually choose which skills are available.", {
                id: "adp-skills-manual-hint",
              })}
        </p>

        <div class="hb-section-title">
          ${msg("Available skills", { id: "adp-skills-available" })}
        </div>
        <div class="skills-list">
          ${this._availableSkills.map((skill) => {
            const checked = selectedSet.has(skill.name);
            return html`
              <label
                class="skill-row ${this._autoSelectSkills ? "disabled" : ""}"
                title=${skill.description || skill.name}
              >
                <input
                  type="checkbox"
                  .checked=${checked}
                  ?disabled=${this._autoSelectSkills}
                  @change=${() => {
                    const current = isAll
                      ? this._availableSkills.map((s) => s.name)
                      : [...(this._editSkills ?? [])];
                    if (checked) {
                      this._editSkills = current.filter((s) => s !== skill.name);
                    } else {
                      this._editSkills = [...current, skill.name];
                    }
                    this._skillsDirty = true;
                  }}
                />
                <span class="skill-row-name">${skill.name}</span>
                ${skill.description
                  ? html`<span class="skill-row-desc">${skill.description}</span>`
                  : nothing}
              </label>
            `;
          })}
        </div>

        ${this._skillsError
          ? html`<div class="error-banner" style="margin-top: 8px">${this._skillsError}</div>`
          : nothing}
        ${this._skillsDirty
          ? html`
              <div class="hb-save-bar">
                <button
                  class="btn-save-spawn"
                  ?disabled=${this._skillsSaving}
                  @click=${() => void this._saveSkills()}
                >
                  ${this._skillsSaving ? "…" : msg("Save", { id: "adp-skills-save" })}
                </button>
                <button
                  class="btn-cancel-spawn"
                  ?disabled=${this._skillsSaving}
                  @click=${() => {
                    this._editSkills = this.agent.skills;
                    this._autoSelectSkills = this._autoSelectSkillsOriginal;
                    this._skillsDirty = false;
                    this._skillsError = "";
                  }}
                >
                  ${msg("Cancel", { id: "adp-skills-cancel" })}
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private async _saveSkills(): Promise<void> {
    if (!this.agent || !this.context) return;
    this._skillsSaving = true;
    this._skillsError = "";
    try {
      const promises: Promise<unknown>[] = [];

      if (this.context.kind === "instance") {
        // Save skill whitelist + autoSelectSkills to runtime config (source of truth)
        promises.push(
          patchInstanceConfig(this.context.slug, {
            agents: [
              {
                id: this.agent.agent_id,
                skills: this._editSkills,
                ...(this._autoSelectSkills !== this._autoSelectSkillsOriginal
                  ? { autoSelectSkills: this._autoSelectSkills }
                  : {}),
              },
            ],
          }),
        );
        // Keep agents.skills in sync for UI display (backward compat, display cache)
        promises.push(
          updateAgentMeta(this.context.slug, this.agent.agent_id, {
            skills: this._editSkills,
          }),
        );
      } else {
        promises.push(
          updateBlueprintAgentMeta(this.context.blueprintId, this.agent.agent_id, {
            skills: this._editSkills,
          }),
        );
      }

      await Promise.all(promises);
      this._autoSelectSkillsOriginal = this._autoSelectSkills;
      this._skillsDirty = false;
      this.dispatchEvent(new CustomEvent("agent-meta-updated", { bubbles: true, composed: true }));
    } catch (err) {
      this._skillsError = userMessage(err);
    } finally {
      this._skillsSaving = false;
    }
  }

  private _renderHeartbeatTab() {
    const INTERVALS = ["5m", "10m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "24h"];

    if (this._hbLoading) {
      return html`<div class="tab-loading"><span class="spinner"></span></div>`;
    }

    return html`
      <div class="hb-tab">
        <!-- Toggle enable -->
        <div class="hb-field-row">
          <label class="hb-label">${msg("Enable heartbeat", { id: "hb-enable" })}</label>
          <div
            class="toggle-track ${this._hbEnabled ? "on" : ""}"
            @click=${() => {
              this._hbEnabled = !this._hbEnabled;
              this._hbDirty = true;
            }}
          >
            <div class="toggle-thumb"></div>
          </div>
        </div>

        ${this._hbEnabled
          ? html`
              <!-- Scheduling -->
              <div class="hb-section-title">${msg("Scheduling", { id: "hb-scheduling" })}</div>
              <div class="hb-grid-2">
                <div class="hb-field">
                  <label class="hb-label">${msg("Interval", { id: "hb-interval" })}</label>
                  <select
                    class="hb-select"
                    .value=${this._hbInterval}
                    @change=${(e: Event) => {
                      this._hbInterval = (e.target as HTMLSelectElement).value;
                      this._hbDirty = true;
                    }}
                  >
                    ${INTERVALS.map(
                      (v) =>
                        html`<option value=${v} ?selected=${this._hbInterval === v}>${v}</option>`,
                    )}
                  </select>
                </div>
              </div>

              <!-- Active hours — section autonome hors grille -->
              <div class="hb-field" style="margin-top:8px">
                <label class="hb-label">
                  ${msg("Active hours", { id: "hb-active-hours" })}
                  <span class="info-hint"
                    >${msg("optional — leave empty for 24/7", { id: "hb-active-hours-hint" })}</span
                  >
                </label>
                <div class="hb-time-block">
                  <div class="hb-time-field">
                    <span class="hb-time-label">${msg("From", { id: "hb-hours-from" })}</span>
                    <input
                      type="time"
                      class="hb-input"
                      .value=${this._hbHoursStart}
                      @change=${(e: Event) => {
                        this._hbHoursStart = (e.target as HTMLInputElement).value;
                        this._hbDirty = true;
                      }}
                    />
                  </div>
                  <span class="hb-time-sep">–</span>
                  <div class="hb-time-field">
                    <span class="hb-time-label">${msg("To", { id: "hb-hours-to" })}</span>
                    <input
                      type="time"
                      class="hb-input"
                      .value=${this._hbHoursEnd}
                      @change=${(e: Event) => {
                        this._hbHoursEnd = (e.target as HTMLInputElement).value;
                        this._hbDirty = true;
                      }}
                    />
                  </div>
                </div>
                ${this._hbHoursStart || this._hbHoursEnd
                  ? html`
                      <div class="hb-field" style="margin-top:6px">
                        <label class="hb-label">${msg("Timezone", { id: "hb-timezone" })}</label>
                        <input
                          type="text"
                          class="hb-input"
                          placeholder="Europe/Paris"
                          .value=${this._hbTimezone}
                          @change=${(e: Event) => {
                            this._hbTimezone = (e.target as HTMLInputElement).value;
                            this._hbDirty = true;
                          }}
                        />
                      </div>
                    `
                  : nothing}
              </div>

              <!-- LLM -->
              <div class="hb-section-title">${msg("LLM", { id: "hb-llm" })}</div>
              <div class="hb-grid-2">
                <div class="hb-field">
                  <label class="hb-label"
                    >${msg("Max response chars", { id: "hb-max-chars" })}</label
                  >
                  <input
                    type="number"
                    class="hb-input"
                    min="100"
                    max="5000"
                    .value=${String(this._hbMaxChars)}
                    @change=${(e: Event) => {
                      this._hbMaxChars = parseInt((e.target as HTMLInputElement).value, 10) || 500;
                      this._hbDirty = true;
                    }}
                  />
                </div>
                <div class="hb-field">
                  <label class="hb-label">${msg("Model override", { id: "hb-model" })}</label>
                  <input
                    type="text"
                    class="hb-input"
                    placeholder="provider/model-id"
                    .value=${this._hbModel}
                    @change=${(e: Event) => {
                      this._hbModel = (e.target as HTMLInputElement).value;
                      this._hbDirty = true;
                    }}
                  />
                </div>
              </div>

              <!-- Prompt -->
              <div class="hb-section-title">${msg("Prompt", { id: "hb-prompt" })}</div>
              <div class="hb-radio-row">
                <label class="hb-radio-label">
                  <input
                    type="radio"
                    name="hb-prompt-mode"
                    value="file"
                    ?checked=${this._hbPromptMode === "file"}
                    @change=${() => {
                      this._hbPromptMode = "file";
                      this._hbDirty = true;
                    }}
                  />
                  ${msg("Use HEARTBEAT.md", { id: "hb-use-file" })}
                </label>
                <label class="hb-radio-label">
                  <input
                    type="radio"
                    name="hb-prompt-mode"
                    value="custom"
                    ?checked=${this._hbPromptMode === "custom"}
                    @change=${() => {
                      this._hbPromptMode = "custom";
                      this._hbDirty = true;
                    }}
                  />
                  ${msg("Custom prompt", { id: "hb-custom-prompt" })}
                </label>
              </div>
              ${this._hbPromptMode === "custom"
                ? html`
                    <textarea
                      class="hb-textarea"
                      rows="4"
                      .value=${this._hbCustomPrompt}
                      @input=${(e: Event) => {
                        this._hbCustomPrompt = (e.target as HTMLTextAreaElement).value;
                        this._hbDirty = true;
                      }}
                    ></textarea>
                  `
                : nothing}
            `
          : nothing}

        <!-- Tick history -->
        ${this.context.kind === "instance"
          ? html`
              <div class="hb-section-title">${msg("Tick history", { id: "hb-history" })}</div>
              ${this._hbLoadingHistory
                ? html`<div class="spinner" style="width:16px;height:16px;margin:8px 0"></div>`
                : nothing}
              ${this._hbTicks.length === 0 && !this._hbLoadingHistory
                ? html`<p class="hb-empty">
                    ${msg("No heartbeat ticks yet.", { id: "hb-no-ticks" })}
                  </p>`
                : nothing}
              ${this._hbTicks.map(
                (tick) => html`
                  <div class="hb-tick-row">
                    <span class="hb-tick-status ${tick.status}">
                      ${tick.status === "ok" ? "✓" : "⚠"}
                    </span>
                    <span class="hb-tick-time">${new Date(tick.createdAt).toLocaleString()}</span>
                    <span class="hb-tick-text">${tick.responseText.slice(0, 80)}</span>
                  </div>
                `,
              )}
            `
          : nothing}

        <!-- Save bar -->
        ${this._hbError ? html`<div class="file-save-error">${this._hbError}</div>` : nothing}
        ${this._hbDirty
          ? html`
              <div class="hb-save-bar">
                <button
                  class="btn-save-spawn"
                  ?disabled=${this._hbSaving}
                  @click=${() => void this._saveHeartbeat()}
                >
                  ${this._hbSaving ? "…" : msg("Save", { id: "hb-save" })}
                </button>
                <button
                  class="btn-cancel-spawn"
                  ?disabled=${this._hbSaving}
                  @click=${() => void this._initHeartbeatTab()}
                >
                  ${msg("Cancel", { id: "hb-cancel" })}
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
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

  // Reset navigation + initialise Info form fields when agent changes
  override updated(changed: Map<string, unknown>): void {
    if (changed.has("agent")) {
      this._activeTab = "info";
      this._pendingRemovals = new Set();
      this._pendingAdditions = new Set();
      this._dropdownOpen = false;
      this._error = "";
      // Initialise Info tab fields from the new agent
      this._initInfoFields();
    }
    // Rebuild stable function refs when agent or context changes so the closures
    // always capture the current values without being recreated on every render().
    if (changed.has("agent") || changed.has("context")) {
      this._loadFileFn = this._buildLoadFile();
      this._saveFileFn = this._buildSaveFile();
    }
  }

  /** Populate Info tab fields from the current agent prop (resets dirty state). */
  private _initInfoFields(): void {
    const a = this.agent;
    this._editName = a.name ?? "";
    this._editRole = a.role ?? "";
    this._editTags = a.tags ?? "";
    this._editNotes = a.notes ?? "";
    const rawModel = this._resolveModel(a.model ?? "") ?? "";
    const slashIdx = rawModel.indexOf("/");
    // _editProvider is used only to drive the provider <select>; _editModel holds the full
    // "provider/model" string (as stored in the catalog) so the model <select> can match it.
    this._editProvider = slashIdx >= 0 ? rawModel.slice(0, slashIdx) : "";
    this._editModel = rawModel; // keep full format — catalog options are also "provider/model"
    this._editSkills = a.skills;
    this._infoDirty = false;
    this._infoError = "";
    // Eager-load providers so the selects are populated immediately on instance panels
    if (this.context?.kind === "instance") {
      void this._loadProviders();
      void this._loadAvailableSkills();
    }
  }

  // ── Info tab ─────────────────────────────────────────────────────────────

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

  /** Lazy-load providers for the provider/model selects, filtered by user profile. */
  private async _loadProviders(): Promise<void> {
    if (this._providers !== null || this._loadingProviders) return;
    this._loadingProviders = true;
    try {
      const [catalog, profile] = await Promise.all([
        fetchProviders(),
        fetchProfileProviders().catch(() => ({ providers: [] })),
      ]);
      let providers = catalog.providers;
      const configuredIds = new Set(
        profile.providers.filter((p) => p.hasApiKey).map((p) => p.providerId),
      );
      if (configuredIds.size > 0) {
        const filtered = providers.filter((p) => configuredIds.has(p.id));
        if (filtered.length > 0) providers = filtered;
      }
      this._providers = providers;
    } catch {
      this._providers = [];
    } finally {
      this._loadingProviders = false;
    }
  }

  /** Load available skills from the instance API (for the checkbox picker). */
  private async _loadAvailableSkills(): Promise<void> {
    if (this._loadingSkills || this.context?.kind !== "instance") return;
    this._loadingSkills = true;
    try {
      const [res, instanceConfig] = await Promise.all([
        fetchInstanceSkills(this.context.slug),
        fetchInstanceConfig(this.context.slug),
      ]);
      this._availableSkills = res.skills;
      const agentEntry = instanceConfig.agents.find((a) => a.id === this.agent.agent_id) as
        | Record<string, unknown>
        | undefined;
      const autoSelect = (agentEntry?.autoSelectSkills as boolean | undefined) ?? false;
      this._autoSelectSkills = autoSelect;
      this._autoSelectSkillsOriginal = autoSelect;
    } catch {
      this._availableSkills = [];
    } finally {
      this._loadingSkills = false;
    }
  }

  private async _saveInfo(): Promise<void> {
    if (!this.agent || !this.context) return;
    const a = this.agent;

    // Validation: if a provider is selected, a model must also be selected
    if (this._editProvider && !this._editModel) {
      this._infoError = msg("Please select a model for the chosen provider.", {
        id: "adp-model-required",
      });
      return;
    }

    this._infoSaving = true;
    this._infoError = "";
    try {
      if (this.context.kind === "instance") {
        const slug = this.context.slug;
        const promises: Promise<unknown>[] = [];

        // Config patch: name / model
        const resolvedCurrentModel = this._resolveModel(a.model ?? "") ?? "";
        // _editModel already holds the full "provider/model" string — use it directly.
        // Only count as a change when a valid model is selected (non-empty).
        const newModel = this._editModel || "";
        const modelChanged = newModel !== resolvedCurrentModel && newModel !== "";
        const configChanged = this._editName !== (a.name ?? "") || modelChanged;
        if (configChanged) {
          const agentPatch: {
            id: string;
            name?: string;
            model?: string;
          } = { id: a.agent_id };
          if (this._editName !== (a.name ?? "")) agentPatch.name = this._editName;
          // Only include model in patch when a complete provider/model pair is selected
          if (modelChanged) agentPatch.model = newModel;
          promises.push(patchInstanceConfig(slug, { agents: [agentPatch] }));
        }

        // Meta patch: role / tags / notes
        const metaPatch: AgentMetaPatch = {};
        if (this._editRole !== (a.role ?? "")) metaPatch.role = this._editRole || null;
        if (this._editTags !== (a.tags ?? "")) metaPatch.tags = this._editTags || null;
        if (this._editNotes !== (a.notes ?? "")) metaPatch.notes = this._editNotes || null;
        if (Object.keys(metaPatch).length > 0) {
          promises.push(updateAgentMeta(slug, a.agent_id, metaPatch));
        }

        await Promise.all(promises);
      } else {
        // Blueprint context
        const metaPatch: AgentMetaPatch = {};
        if (this._editRole !== (a.role ?? "")) metaPatch.role = this._editRole || null;
        if (this._editTags !== (a.tags ?? "")) metaPatch.tags = this._editTags || null;
        if (this._editNotes !== (a.notes ?? "")) metaPatch.notes = this._editNotes || null;
        if (Object.keys(metaPatch).length > 0) {
          await updateBlueprintAgentMeta(this.context.blueprintId, a.agent_id, metaPatch);
        }
      }

      this._infoDirty = false;
      this.dispatchEvent(new CustomEvent("agent-meta-updated", { bubbles: true, composed: true }));
    } catch (err) {
      this._infoError = userMessage(err);
    } finally {
      this._infoSaving = false;
    }
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

  /**
   * Render the archetype section at the top of the spawn dropdown.
   * Shows archetypes not already linked (as @archetype targets).
   */
  private _renderArchetypeSection(spawnLinks: AgentLink[]) {
    const linkedArchetypes = new Set(
      spawnLinks.filter(isArchetypeLink).map((l) => l.target_agent_id),
    );
    const pendingArchetypes = new Set(
      Array.from(this._pendingAdditions).filter((id) => id.startsWith("@")),
    );
    const available = AGENT_ARCHETYPES.filter(
      (a) => !linkedArchetypes.has(`@${a}`) && !pendingArchetypes.has(`@${a}`),
    );
    if (available.length === 0) return nothing;
    return html`
      <div class="spawn-dropdown-section">
        <span class="spawn-dropdown-header">${msg("Archetypes", { id: "adp-archetypes" })}</span>
        ${available.map(
          (a) =>
            html`<button class="spawn-dropdown-item" @click=${() => this._addSpawnLink(`@${a}`)}>
              @${a}
            </button>`,
        )}
      </div>
    `;
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

  // ── File load helpers (callbacks for cp-agent-file-editor) ──────────────

  private _buildLoadFile(): (filename: string) => Promise<string> {
    return async (filename: string) => {
      if (this.context.kind === "blueprint") {
        const result = await fetchBlueprintAgentFile(
          this.context.blueprintId,
          this.agent.agent_id,
          filename,
        );
        return result.content ?? "";
      } else {
        const result = await fetchAgentFile(this.context.slug, this.agent.agent_id, filename);
        return result.content ?? "";
      }
    };
  }

  private _buildSaveFile(): (filename: string, content: string) => Promise<void> {
    return async (filename: string, content: string) => {
      if (this.context.kind === "blueprint") {
        await updateBlueprintAgentFile(
          this.context.blueprintId,
          this.agent.agent_id,
          filename,
          content,
        );
      } else {
        await updateAgentFile(this.context.slug, this.agent.agent_id, filename, content);
      }
    };
  }

  // ── Render helpers ───────────────────────────────────────────────────────

  private _renderInfo() {
    const a = this.agent;
    const providers = this._providers ?? [];
    const selectedProvider = providers.find((p) => p.id === this._editProvider);
    const availableModels = selectedProvider?.models ?? [];

    const spawnLinks = this.links.filter(
      (l) => l.link_type === "spawn" && l.source_agent_id === a.agent_id,
    );
    const receivedSpawn = this.links.filter(
      (l) => l.link_type === "spawn" && l.target_agent_id === a.agent_id,
    );

    // Mark dirty helper
    const dirty = () => {
      this._infoDirty = true;
    };

    return html`
      <div class="info-row">
        ${this._infoError ? html`<div class="file-save-error">${this._infoError}</div>` : nothing}

        <!-- Name -->
        <div class="info-item">
          <label class="info-label">${msg("Name", { id: "adp-label-name" })}</label>
          <input
            class="field-edit-input"
            type="text"
            .value=${this._editName}
            @input=${(e: Event) => {
              this._editName = (e.target as HTMLInputElement).value;
              dirty();
            }}
          />
        </div>

        <!-- Provider + Model (instance only) -->
        ${this.context?.kind === "instance"
          ? html`
              <div class="info-item">
                <label class="info-label">${msg("Provider", { id: "adp-label-provider" })}</label>
                ${this._loadingProviders
                  ? html`<span class="loading-text"
                      >${msg("Loading...", { id: "adp-loading-providers" })}</span
                    >`
                  : html`
                      <select
                        class="field-edit-input"
                        @focus=${() => void this._loadProviders()}
                        @change=${(e: Event) => {
                          this._editProvider = (e.target as HTMLSelectElement).value;
                          this._editModel = "";
                          dirty();
                        }}
                      >
                        <option value="">
                          — ${msg("select provider", { id: "adp-provider-placeholder" })} —
                        </option>
                        ${providers.map(
                          (p) =>
                            html`<option value=${p.id} ?selected=${p.id === this._editProvider}>
                              ${p.label}
                            </option>`,
                        )}
                      </select>
                    `}
              </div>
              <div class="info-item">
                <label class="info-label">${msg("Model", { id: "adp-label-model" })}</label>
                <select
                  class="field-edit-input"
                  @change=${(e: Event) => {
                    this._editModel = (e.target as HTMLSelectElement).value;
                    dirty();
                  }}
                >
                  <option value="">
                    — ${msg("select model", { id: "adp-model-placeholder" })} —
                  </option>
                  ${availableModels.map(
                    (m) =>
                      html`<option value=${m} ?selected=${m === this._editModel}>${m}</option>`,
                  )}
                </select>
              </div>
            `
          : nothing}

        <!-- Role -->
        <div class="info-item">
          <label class="info-label">${msg("Role", { id: "adp-label-role" })}</label>
          <input
            class="field-edit-input"
            type="text"
            .value=${this._editRole}
            @input=${(e: Event) => {
              this._editRole = (e.target as HTMLInputElement).value;
              dirty();
            }}
          />
        </div>

        <!-- Tags -->
        <div class="info-item">
          <label class="info-label">
            ${msg("Tags", { id: "adp-label-tags" })}
            <span class="info-hint">${msg("CSV, ex: rh, legal", { id: "adp-tags-hint" })}</span>
          </label>
          <input
            class="field-edit-input"
            type="text"
            .value=${this._editTags}
            @input=${(e: Event) => {
              this._editTags = (e.target as HTMLInputElement).value;
              dirty();
            }}
          />
        </div>

        <!-- Notes -->
        <div class="info-item">
          <label class="info-label">${msg("Notes", { id: "adp-label-notes" })}</label>
          <textarea
            class="field-edit-textarea"
            rows="3"
            .value=${this._editNotes}
            @input=${(e: Event) => {
              this._editNotes = (e.target as HTMLTextAreaElement).value;
              dirty();
            }}
          ></textarea>
        </div>

        <!-- Workspace (read-only) -->
        <div class="info-item">
          <span class="info-label">${msg("Workspace", { id: "adp-label-workspace" })}</span>
          <span class="info-value">${a.workspace_path}</span>
        </div>

        <!-- Last sync (instance only, read-only) -->
        ${a.synced_at && this.context?.kind !== "blueprint"
          ? html`
              <div class="info-item">
                <span class="info-label">${msg("Last sync", { id: "adp-label-last-sync" })}</span>
                <span class="info-value">${a.synced_at}</span>
              </div>
            `
          : nothing}

        <!-- Allowed delegates -->
        ${(() => {
          const linkedIds = new Set(spawnLinks.map((l) => l.target_agent_id));
          const availableAgents = this.allAgents.filter(
            (ag) =>
              ag.agent_id !== a.agent_id &&
              !linkedIds.has(ag.agent_id) &&
              !this._pendingAdditions.has(ag.agent_id),
          );
          const hasExplicitLinks = spawnLinks.length > 0 || this._pendingAdditions.size > 0;
          return html`
            <div class="info-item">
              <span class="info-label"
                >${msg("Allowed delegates", { id: "adp-label-can-spawn" })}</span
              >
              ${!hasExplicitLinks
                ? html`<span class="info-value" style="opacity:0.6;font-style:italic"
                    >${msg("All agents (no restriction)", { id: "adp-delegates-all" })}</span
                  >`
                : nothing}
              <div class="links-list">
                ${spawnLinks.map((l) => {
                  const isPending = this._pendingRemovals.has(l.target_agent_id);
                  const isArch = l.target_agent_id.startsWith("@");
                  const archName = isArch ? l.target_agent_id.slice(1) : "";
                  const archStyle = isArch
                    ? `color: var(--archetype-${archName}); border-color: var(--archetype-${archName})`
                    : "";
                  return html`
                    <span
                      class="link-badge spawn spawn-editable ${isPending ? "pending-removal" : ""}"
                      style=${archStyle}
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
                                ${this._renderArchetypeSection(spawnLinks)}
                                ${availableAgents.map(
                                  (ag) =>
                                    html`<button
                                      class="spawn-dropdown-item"
                                      @click=${() => this._addSpawnLink(ag.agent_id)}
                                    >
                                      ${ag.agent_id}
                                    </button>`,
                                )}
                              </div>
                            `
                          : nothing}
                      </div>
                    `
                  : nothing}
              </div>
            </div>
          `;
        })()}

        <!-- Delegated by -->
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
          : nothing}

        <!-- A2A messaging peers -->
        ${(() => {
          const a2aPeers = new Set<string>();
          for (const l of this.links) {
            if (l.link_type !== "a2a") continue;
            if (l.source_agent_id === a.agent_id) a2aPeers.add(l.target_agent_id);
            if (l.target_agent_id === a.agent_id) a2aPeers.add(l.source_agent_id);
          }
          if (a2aPeers.size === 0) return nothing;
          return html`
            <div class="info-item">
              <span class="info-label"
                >${msg("Messaging peers", { id: "adp-label-a2a-peers" })}</span
              >
              <div class="links-list">
                ${Array.from(a2aPeers).map(
                  (id) => html`<span class="link-badge" style="opacity:0.7">↔ ${id}</span>`,
                )}
              </div>
            </div>
          `;
        })()}

        <!-- Info save bar -->
        ${this._infoDirty
          ? html`
              <div class="hb-save-bar">
                <button
                  class="btn-save-spawn"
                  ?disabled=${this._infoSaving}
                  @click=${() => void this._saveInfo()}
                >
                  ${this._infoSaving ? "…" : msg("Save", { id: "adp-info-save" })}
                </button>
                <button
                  class="btn-cancel-spawn"
                  ?disabled=${this._infoSaving}
                  @click=${() => this._initInfoFields()}
                >
                  ${msg("Cancel", { id: "adp-info-cancel" })}
                </button>
              </div>
            `
          : nothing}
      </div>
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
            <span class="agent-category-badge category-${a.category}">${a.category}</span>
            ${a.archetype
              ? html`<span
                  class="agent-category-badge"
                  style="color: var(--archetype-${a.archetype}); border-color: var(--archetype-${a.archetype})"
                  >${a.archetype}</span
                >`
              : nothing}
          </div>
          ${a.role ? html`<div class="agent-role-label">${a.role}</div>` : ""}
        </div>
        <div class="panel-controls">
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
        ${this.context.kind === "instance"
          ? html`
              <button
                class="tab ${this._activeTab === "heartbeat" ? "active" : ""}"
                @click=${() => {
                  this._selectTab("heartbeat");
                  void this._initHeartbeatTab();
                }}
              >
                ${msg("Heartbeat", { id: "adp-tab-heartbeat" })}
              </button>
              <button
                class="tab ${this._activeTab === "config" ? "active" : ""}"
                @click=${() => {
                  this._selectTab("config");
                  void this._initConfigTab();
                }}
              >
                ${msg("Config", { id: "adp-tab-config" })}
              </button>
            `
          : nothing}
        ${fileTabs.length > 0
          ? html`
              <button
                class="tab ${this._activeTab === "files" ? "active" : ""}"
                @click=${() => this._selectTab("files")}
              >
                ${msg("Files", { id: "adp-tab-files" })}
              </button>
            `
          : nothing}
        ${this.context.kind === "instance"
          ? html`
              <button
                class="tab ${this._activeTab === "tools" ? "active" : ""}"
                @click=${() => {
                  this._selectTab("tools");
                  void this._initToolsTab();
                }}
              >
                ${msg("Tools", { id: "adp-tab-tools" })}
              </button>
              <button
                class="tab ${this._activeTab === "skills" ? "active" : ""}"
                @click=${() => {
                  this._selectTab("skills");
                  void this._loadAvailableSkills();
                }}
              >
                ${msg("Skills", { id: "adp-tab-skills" })}
              </button>
            `
          : nothing}
      </div>

      <div
        class="panel-body ${this._pendingRemovals.size > 0 || this._pendingAdditions.size > 0
          ? "has-save-bar"
          : ""}"
      >
        ${this._activeTab === "info"
          ? this._renderInfo()
          : this._activeTab === "heartbeat"
            ? this._renderHeartbeatTab()
            : this._activeTab === "config"
              ? this._renderConfigTab()
              : this._activeTab === "tools"
                ? this._renderToolsTab()
                : this._activeTab === "skills"
                  ? this._renderSkillsTab()
                  : html`
                      <cp-agent-file-editor
                        .files=${fileTabs}
                        .loadFile=${this._loadFileFn}
                        .saveFile=${this._saveFileFn}
                        .editableFiles=${EDITABLE_FILES}
                      ></cp-agent-file-editor>
                    `}
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
