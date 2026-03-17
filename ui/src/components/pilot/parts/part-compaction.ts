// ui/src/components/pilot/parts/part-compaction.ts
// Part type "compaction" — visual separator indicating context was compacted.
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../../styles/tokens.js";

interface CompactionMeta {
  compactedMessageCount?: number;
  compactedAt?: string;
}

@localized()
@customElement("cp-pilot-part-compaction")
export class PilotPartCompaction extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        margin: 4px 0;
      }

      .compaction-row {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--text-muted);
        font-size: 11px;
      }

      .compaction-line {
        flex: 1;
        height: 1px;
        background: var(--bg-border);
      }

      .compaction-label {
        white-space: nowrap;
        font-style: italic;
        letter-spacing: 0.02em;
        flex-shrink: 0;
      }
    `,
  ];

  @property() metadata = "";

  private _meta(): CompactionMeta {
    try {
      return (this.metadata ? JSON.parse(this.metadata) : {}) as CompactionMeta;
    } catch {
      return {};
    }
  }

  override render() {
    const meta = this._meta();
    const count = meta.compactedMessageCount;

    const label =
      count !== undefined
        ? msg(html`Context compacted — ${count} messages summarized`, {
            id: "part-compaction-label-count",
          })
        : msg("Context compacted", { id: "part-compaction-label" });

    return html`
      <div class="compaction-row">
        <div class="compaction-line"></div>
        <span class="compaction-label">⊡ ${label}</span>
        <div class="compaction-line"></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-compaction": PilotPartCompaction;
  }
}
