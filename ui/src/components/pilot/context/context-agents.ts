// ui/src/components/pilot/context/context-agents.ts
// Shows agent config, teammates list, and session tree (sub-agents).
import { LitElement, html, nothing, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { SessionContext } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";

type AgentInfo = SessionContext["agent"];
type Teammate = SessionContext["teammates"][number];
type SessionNode = SessionContext["sessionTree"][number];

@localized()
@customElement("cp-pilot-context-agents")
export class PilotContextAgents extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .section {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 12px;
      }

      .section:last-child {
        margin-bottom: 0;
      }

      .section-title {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
      }

      /* Agent info grid */
      .agent-grid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 10px;
        font-size: 11px;
      }

      .agent-label {
        color: var(--text-muted);
        white-space: nowrap;
      }

      .agent-value {
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .agent-value.model {
        font-size: 10px;
      }

      /* Teammates */
      .teammate-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .teammate-chip {
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--text-secondary);
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: 3px;
        padding: 2px 7px;
      }

      /* Session tree */
      .session-tree {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .session-node {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        padding: 3px 0;
      }

      .session-indent {
        flex-shrink: 0;
        color: var(--bg-border);
        font-family: var(--font-mono);
        font-size: 10px;
      }

      .session-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .session-dot.active {
        background: var(--state-running);
        box-shadow: 0 0 4px rgba(16, 185, 129, 0.4);
      }

      .session-dot.archived {
        background: var(--text-muted);
      }

      .session-agent {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-secondary);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .session-depth {
        font-size: 10px;
        color: var(--text-muted);
        flex-shrink: 0;
      }
    `,
  ];

  @property({ type: Object }) agent?: AgentInfo;
  @property({ type: Array }) teammates: Teammate[] = [];
  @property({ type: Array }) sessionTree: SessionNode[] = [];

  private _renderAgentInfo() {
    const a = this.agent;
    if (!a) return nothing;

    const shortModel = a.model.split("/").pop() ?? a.model;

    return html`
      <div class="section">
        <div class="section-title">${msg("Agent", { id: "context-agents-agent" })}</div>
        <div class="agent-grid">
          <span class="agent-label">${msg("ID", { id: "context-agents-id" })}</span>
          <span class="agent-value">${a.id}</span>

          <span class="agent-label">${msg("Model", { id: "context-agents-model" })}</span>
          <span class="agent-value model" title="${a.model}">${shortModel}</span>

          <span class="agent-label">${msg("Profile", { id: "context-agents-profile" })}</span>
          <span class="agent-value">${a.toolProfile}</span>

          ${a.temperature !== undefined
            ? html`
                <span class="agent-label">temp</span>
                <span class="agent-value">${a.temperature}</span>
              `
            : nothing}
          ${a.maxSteps !== undefined
            ? html`
                <span class="agent-label">max steps</span>
                <span class="agent-value">${a.maxSteps}</span>
              `
            : nothing}
          ${a.thinking?.enabled
            ? html`
                <span class="agent-label">thinking</span>
                <span class="agent-value">
                  ${a.thinking.budgetTokens
                    ? `${(a.thinking.budgetTokens / 1000).toFixed(0)}k budget`
                    : "enabled"}
                </span>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  private _renderTeammates() {
    if (this.teammates.length === 0) return nothing;

    return html`
      <div class="section">
        <div class="section-title">
          ${msg("Teammates", { id: "context-agents-teammates" })} (${this.teammates.length})
        </div>
        <div class="teammate-list">
          ${this.teammates.map((t) => html`<span class="teammate-chip">${t.name}</span>`)}
        </div>
      </div>
    `;
  }

  private _renderSessionTree() {
    if (this.sessionTree.length === 0) return nothing;

    return html`
      <div class="section">
        <div class="section-title">${msg("Session tree", { id: "context-agents-tree" })}</div>
        <div class="session-tree">
          ${this.sessionTree.map((node) => {
            const indent = "  ".repeat(node.spawnDepth);
            const prefix = node.spawnDepth > 0 ? "└─ " : "";
            return html`
              <div class="session-node">
                <span class="session-indent">${indent}${prefix}</span>
                <span class="session-dot ${node.state}"></span>
                <span class="session-agent">${node.agentId}</span>
                ${node.spawnDepth > 0
                  ? html`<span class="session-depth">d${node.spawnDepth}</span>`
                  : nothing}
                ${node.state === "archived"
                  ? html`<span style="font-size:10px;color:var(--text-muted)"
                      >${msg("archived", { id: "session-archived" })}</span
                    >`
                  : nothing}
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  override render() {
    return html`
      ${this._renderAgentInfo()} ${this._renderTeammates()} ${this._renderSessionTree()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-context-agents": PilotContextAgents;
  }
}
