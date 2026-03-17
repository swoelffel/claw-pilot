// ui/src/components/pilot/context/context-system.ts
// Shows workspace + memory files loaded into the system prompt, and compaction info.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { SessionContext } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";

type CompactionInfo = SessionContext["compaction"];

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

@localized()
@customElement("cp-pilot-context-system")
export class PilotContextSystem extends LitElement {
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

      /* File list */
      .file-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .file-group-label {
        font-size: 10px;
        color: var(--text-muted);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 4px;
      }

      .file-chip {
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--text-secondary);
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: 3px;
        padding: 2px 7px;
        display: inline-block;
        margin: 1px 2px;
      }

      .file-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
      }

      /* Compaction */
      .compact-grid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 10px;
        font-size: 11px;
      }

      .compact-label {
        color: var(--text-muted);
        white-space: nowrap;
      }

      .compact-value {
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 11px;
      }

      .compact-value.warning {
        color: var(--state-warning);
      }

      .empty-state {
        font-size: 11px;
        color: var(--text-muted);
        font-style: italic;
      }
    `,
  ];

  @property({ type: Array }) systemPromptFiles: string[] = [];
  @property({ type: Object }) compaction?: CompactionInfo;

  override render() {
    const workspaceFiles = this.systemPromptFiles.filter((f) => !f.startsWith("memory/"));
    const memoryFiles = this.systemPromptFiles.filter((f) => f.startsWith("memory/"));

    return html`
      <!-- Workspace files -->
      <div class="section">
        <div class="section-title">${msg("System context", { id: "context-system-title" })}</div>
        ${this.systemPromptFiles.length === 0
          ? html`<span class="empty-state"
              >${msg("No workspace files detected", { id: "context-system-empty" })}</span
            >`
          : html`
              ${workspaceFiles.length > 0
                ? html`
                    <div>
                      <div class="file-group-label">
                        ${msg("Workspace", { id: "context-system-workspace" })}
                      </div>
                      <div class="file-chips">
                        ${workspaceFiles.map((f) => html`<span class="file-chip">${f}</span>`)}
                      </div>
                    </div>
                  `
                : nothing}
              ${memoryFiles.length > 0
                ? html`
                    <div>
                      <div class="file-group-label">
                        ${msg("Memory", { id: "context-system-memory" })}
                      </div>
                      <div class="file-chips">
                        ${memoryFiles.map(
                          (f) => html`<span class="file-chip">${f.replace("memory/", "")}</span>`,
                        )}
                      </div>
                    </div>
                  `
                : nothing}
            `}
      </div>

      <!-- Compaction info -->
      ${this.compaction
        ? html`
            <div class="section">
              <div class="section-title">
                ${msg("Compaction", { id: "context-system-compaction" })}
              </div>
              <div class="compact-grid">
                <span class="compact-label"
                  >${msg("since last", { id: "context-system-since" })}</span
                >
                <span
                  class="compact-value ${this.compaction.messagesSinceCompaction > 50
                    ? "warning"
                    : ""}"
                >
                  ${this.compaction.messagesSinceCompaction} msgs
                </span>

                ${this.compaction.lastCompactedAt
                  ? html`
                      <span class="compact-label"
                        >${msg("last at", { id: "context-system-last-at" })}</span
                      >
                      <span class="compact-value"
                        >${formatDate(this.compaction.lastCompactedAt)}</span
                      >
                    `
                  : nothing}
                ${this.compaction.periodicMessageCount !== null
                  ? html`
                      <span class="compact-label"
                        >${msg("periodic", { id: "context-system-periodic" })}</span
                      >
                      <span class="compact-value"
                        >every ${this.compaction.periodicMessageCount} msgs</span
                      >
                    `
                  : nothing}
              </div>
            </div>
          `
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-context-system": PilotContextSystem;
  }
}
