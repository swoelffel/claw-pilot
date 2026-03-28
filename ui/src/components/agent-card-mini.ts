// ui/src/components/agent-card-mini.ts
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBuilderInfo } from "../types.js";
import { tokenStyles } from "../styles/tokens.js";

// Archetype color mapping (must match tokens.ts)
const ARCHETYPE_COLORS: Record<string, string> = {
  planner: "#8b5cf6",
  generator: "#10b981",
  evaluator: "#f59e0b",
  orchestrator: "#4f6ef7",
  analyst: "#0ea5e9",
  communicator: "#ec4899",
};

@localized()
@customElement("cp-agent-card-mini")
export class AgentCardMini extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        position: absolute;
        transform: translate(-50%, -50%);
        cursor: grab;
      }

      .card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 8px 10px;
        cursor: inherit;
        transition:
          box-shadow 0.15s,
          border-color 0.15s;
        user-select: none;
        min-width: 130px;
        max-width: 160px;
        position: relative;
        border-left: 3px solid transparent;
      }

      /* --- Archetype stripe (left border) --- */
      .card.archetype-planner {
        border-left-color: var(--archetype-planner);
      }
      .card.archetype-generator {
        border-left-color: var(--archetype-generator);
      }
      .card.archetype-evaluator {
        border-left-color: var(--archetype-evaluator);
      }
      .card.archetype-orchestrator {
        border-left-color: var(--archetype-orchestrator);
      }
      .card.archetype-analyst {
        border-left-color: var(--archetype-analyst);
      }
      .card.archetype-communicator {
        border-left-color: var(--archetype-communicator);
      }

      /* --- Default agent: accent background --- */
      .card.is-default {
        background: var(--accent-subtle);
        border-color: var(--accent-border);
        min-width: 150px;
        max-width: 180px;
      }

      /* --- Ephemeral agents: transparent bg + dashed border --- */
      .card.ephemeral {
        background: color-mix(in srgb, var(--bg-surface) 55%, transparent);
        border-style: dashed;
      }

      .card:hover {
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      }

      .card.selected {
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent-border);
      }

      :host([is-new]) .card {
        border: 2px solid var(--state-success, #22c55e);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--state-success, #22c55e) 20%, transparent);
        animation: new-agent-pulse 2s ease-out forwards;
      }

      @keyframes new-agent-pulse {
        0% {
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--state-success, #22c55e) 30%, transparent);
        }
        100% {
          box-shadow: 0 0 0 0px color-mix(in srgb, var(--state-success, #22c55e) 0%, transparent);
        }
      }

      /* row 1 : name + delete button */
      .card-top {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-bottom: 3px;
      }

      .agent-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
        min-width: 0;
      }

      /* row 2 : slug (left) + file count (right) */
      .card-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 4px;
      }

      .agent-id {
        font-size: 10px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      .file-count {
        font-size: 10px;
        color: var(--text-muted);
        white-space: nowrap;
        flex-shrink: 0;
      }

      .badge-sa {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
        background: transparent;
        border: 1px solid var(--bg-border);
        border-radius: 3px;
        padding: 1px 5px;
        flex-shrink: 0;
        cursor: help;
      }

      .badge-system {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: color-mix(in srgb, var(--text-muted) 70%, transparent);
        background: transparent;
        border: 1px dashed var(--bg-border);
        border-radius: 3px;
        padding: 1px 5px;
        flex-shrink: 0;
        cursor: help;
      }

      .card-bottom {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: wrap;
      }

      .badge-archetype {
        font-size: 9px;
        font-weight: 700;
        text-transform: lowercase;
        letter-spacing: 0.04em;
        background: transparent;
        border: 1px solid;
        border-radius: 3px;
        padding: 1px 5px;
        flex-shrink: 0;
      }

      .model-label {
        font-size: 9px;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 90px;
      }

      /* row 4 : @archetype spawn targets (inline) */
      .card-spawns {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px solid var(--bg-border);
      }

      .spawn-archetype {
        font-size: 8px;
        font-weight: 600;
        font-family: var(--font-mono);
        border-radius: 3px;
        padding: 1px 4px;
        background: transparent;
        border: 1px solid;
        opacity: 0.85;
      }

      .btn-delete {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 2px 3px;
        border-radius: var(--radius-sm);
        opacity: 0.45;
        transition:
          opacity 0.15s,
          color 0.15s,
          background 0.15s;
        flex-shrink: 0;
      }

      .btn-delete:hover {
        opacity: 1;
        color: var(--state-error, #ef4444);
        background: color-mix(in srgb, var(--state-error, #ef4444) 10%, transparent);
      }
    `,
  ];

  @property({ type: Object }) agent!: AgentBuilderInfo;
  @property({ type: Boolean }) selected = false;
  @property({ type: Boolean, reflect: true }) isNew = false;
  @property({ type: Boolean }) deletable = false;
  /** @archetype spawn targets for this agent (e.g. ["generator", "evaluator"]) */
  @property({ type: Array }) archetypeSpawns: string[] = [];

  private _truncate(str: string, max: number): string {
    return str.length > max ? str.slice(0, max) + "…" : str;
  }

  /** Resolve model string — handles JSON-stringified objects like {"primary":"provider/model"} */
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

  override render() {
    const a = this.agent;
    const model = this._resolveModel(a.model);
    const modelShort = model ? this._truncate(model.split("/").pop() ?? model, 18) : null;
    const archetype = a.archetype;
    const archetypeClass = archetype ? `archetype-${archetype}` : "";
    const isEphemeral = a.persistence === "ephemeral";

    return html`
      <div
        class="card ${a.is_default ? "is-default" : ""} ${this.selected
          ? "selected"
          : ""} ${archetypeClass} ${isEphemeral ? "ephemeral" : ""}"
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent("agent-select", {
              detail: { agentId: a.agent_id },
              bubbles: true,
              composed: true,
            }),
          )}
      >
        <!-- row 1 : name + delete -->
        <div class="card-top">
          <span class="agent-name" title=${a.name}>${this._truncate(a.name, 22)}</span>
          ${this.deletable
            ? html`
                <button
                  class="btn-delete"
                  title=${msg("Delete agent", { id: "acm-btn-delete" })}
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this.dispatchEvent(
                      new CustomEvent("agent-delete-requested", {
                        detail: { agentId: this.agent.agent_id },
                        bubbles: true,
                        composed: true,
                      }),
                    );
                  }}
                >
                  ✕
                </button>
              `
            : nothing}
        </div>
        <!-- row 2 : slug (left) + file count (right) -->
        <div class="card-meta">
          <span class="agent-id">${a.agent_id}</span>
          <span class="file-count">${a.files.length} ${msg("files", { id: "acm-files" })}</span>
        </div>
        <!-- row 3 : badge + model -->
        <div class="card-bottom">
          ${archetype
            ? html`<span
                class="badge-archetype"
                style="color: var(--archetype-${archetype}); border-color: var(--archetype-${archetype})"
                title=${archetype}
                >${archetype}</span
              >`
            : a.category === "system"
              ? html`<span
                  class="badge-system"
                  title=${msg("Internal infrastructure agent (compaction, title, summary).", {
                    id: "acm-tooltip-system",
                  })}
                  >${msg("System", { id: "acm-badge-system" })}</span
                >`
              : a.category === "tool"
                ? html`<span
                    class="badge-sa"
                    title=${msg("Built-in utility agent available as a tool for other agents.", {
                      id: "acm-tooltip-tool",
                    })}
                    >${msg("Tool", { id: "acm-badge-tool" })}</span
                  >`
                : html`<span
                    class="badge-sa"
                    title=${msg("User-created agent.", {
                      id: "acm-tooltip-user",
                    })}
                    >${msg("Agent", { id: "acm-badge-user" })}</span
                  >`}
          ${modelShort
            ? html`<span class="model-label" title=${model ?? ""}>${modelShort}</span>`
            : ""}
        </div>
        <!-- row 4 : @archetype spawn targets (inline, only if any) -->
        ${this.archetypeSpawns.length > 0
          ? html`
              <div class="card-spawns">
                ${this.archetypeSpawns.map((arch) => {
                  const color = ARCHETYPE_COLORS[arch] ?? "#64748b";
                  return html`<span
                    class="spawn-archetype"
                    style="color: ${color}; border-color: ${color}"
                    title=${msg("Spawns any agent with this archetype", {
                      id: "acm-tooltip-spawn-archetype",
                    })}
                    >→ @${arch}</span
                  >`;
                })}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-card-mini": AgentCardMini;
  }
}
