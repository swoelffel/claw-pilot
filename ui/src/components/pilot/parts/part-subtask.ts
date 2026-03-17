// ui/src/components/pilot/parts/part-subtask.ts
// Part type "subtask" — shows sub-agent delegation with result summary when completed.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotPart } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";

interface SubtaskMeta {
  agentId?: string;
  subSessionId?: string;
  description?: string;
}

interface SubagentResult {
  text?: string;
  steps?: number;
  tokens?: { input: number; output: number };
  model?: string;
}

@localized()
@customElement("cp-pilot-part-subtask")
export class PilotPartSubtask extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .subtask-block {
        border: 1px solid var(--bg-border);
        border-left: 3px solid var(--accent);
        border-radius: 0 var(--radius-md) var(--radius-md) 0;
        padding: 8px 12px;
        background: var(--bg-hover);
        font-size: 12px;
      }

      .subtask-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }

      .subtask-icon {
        color: var(--accent);
        font-size: 12px;
        flex-shrink: 0;
      }

      .subtask-agent {
        font-weight: 600;
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 12px;
      }

      .subtask-state {
        font-size: 11px;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
      }

      .subtask-state.completed {
        background: rgba(16, 185, 129, 0.1);
        color: var(--state-running);
        border: 1px solid rgba(16, 185, 129, 0.25);
      }

      .subtask-state.running {
        background: rgba(245, 158, 11, 0.1);
        color: var(--state-warning);
        border: 1px solid rgba(245, 158, 11, 0.25);
      }

      .subtask-state.error {
        background: rgba(239, 68, 68, 0.1);
        color: var(--state-error);
        border: 1px solid rgba(239, 68, 68, 0.25);
      }

      .subtask-state.pending {
        background: rgba(100, 116, 139, 0.1);
        color: var(--text-muted);
        border: 1px solid rgba(100, 116, 139, 0.2);
      }

      .subtask-description {
        color: var(--text-muted);
        font-size: 11px;
        margin-bottom: 6px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .subtask-result {
        color: var(--text-secondary);
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        border-top: 1px solid var(--bg-border);
        padding-top: 6px;
        margin-top: 4px;
        line-height: 1.5;
      }

      .subtask-stats {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
        font-size: 11px;
        color: var(--text-muted);
        font-family: var(--font-mono);
      }
    `,
  ];

  @property({ type: Object }) pilotPart!: PilotPart;
  @property({ type: Object }) subagentResult?: SubagentResult;

  private _meta(): SubtaskMeta {
    try {
      return (this.pilotPart?.metadata ? JSON.parse(this.pilotPart.metadata) : {}) as SubtaskMeta;
    } catch {
      return {};
    }
  }

  override render() {
    if (!this.pilotPart) return nothing;

    const meta = this._meta();
    const agentId = meta.agentId ?? "agent";
    const state = this.pilotPart.state ?? "pending";
    const result = this.subagentResult;

    const stateLabels: Record<string, string> = {
      pending: msg("pending", { id: "state-pending" }),
      running: msg("running", { id: "state-running" }),
      completed: msg("completed", { id: "state-completed" }),
      error: msg("error", { id: "state-error" }),
    };

    const totalTokens = result?.tokens
      ? (result.tokens.input + result.tokens.output).toLocaleString()
      : null;

    return html`
      <div class="subtask-block">
        <div class="subtask-header">
          <span class="subtask-icon">⬡⬡</span>
          <span class="subtask-agent">${agentId}</span>
          <span class="subtask-state ${state}"> ${stateLabels[state] ?? state} </span>
        </div>

        ${meta.description
          ? html`<div class="subtask-description">${meta.description}</div>`
          : nothing}
        ${result?.text
          ? html`
              <div class="subtask-result">${result.text}</div>
              <div class="subtask-stats">
                ${result.steps !== undefined ? html`${result.steps} steps` : nothing}
                ${totalTokens ? html`· ${totalTokens} tokens` : nothing}
                ${result.model ? html`· ${result.model.split("/").pop()}` : nothing}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-subtask": PilotPartSubtask;
  }
}
