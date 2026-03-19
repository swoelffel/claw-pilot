// ui/src/components/pilot/context/context-prompt.ts
// System prompt viewer: collapsible sections parsed from XML-tagged blocks.
// Displayed below the token gauge in the CONTEXT tab.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../../styles/tokens.js";

// ---------------------------------------------------------------------------
// Prompt section parser
// ---------------------------------------------------------------------------

interface PromptSection {
  tag: string;
  content: string;
}

/** Known XML tags emitted by buildSystemPrompt(), in display order. */
const KNOWN_TAGS = [
  "agent_identity",
  "instructions",
  "teammates",
  "env",
  "behavior",
  "session_context",
  "available_skills",
] as const;

/** Human-readable label for each section tag. */
const TAG_LABELS: Record<string, string> = {
  agent_identity: "Identity",
  instructions: "Instructions",
  teammates: "Teammates",
  env: "Environment",
  behavior: "Behavior",
  session_context: "Session context",
  available_skills: "Skills",
};

/** Icon for each section (single char for compact display). */
const TAG_ICONS: Record<string, string> = {
  agent_identity: "◈",
  instructions: "☰",
  teammates: "⬡",
  env: "⊟",
  behavior: "⚑",
  session_context: "⊙",
  available_skills: "⬖",
};

/**
 * Parse the system prompt string into labeled sections.
 * Sections are defined by XML-like tags: <tag_name>...</tag_name>.
 * Any text outside known tags goes into an "other" bucket.
 */
function parsePromptSections(prompt: string): PromptSection[] {
  const sections: PromptSection[] = [];

  // Build regex that matches any of the known tags
  const tagPattern = KNOWN_TAGS.join("|");
  const sectionRegex = new RegExp(`<(${tagPattern})>([\\s\\S]*?)<\\/\\1>`, "g");

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(prompt)) !== null) {
    // Capture any text before this block as "extra"
    if (match.index > lastIndex) {
      const pre = prompt.slice(lastIndex, match.index).trim();
      if (pre.length > 0) {
        sections.push({ tag: "extra", content: pre });
      }
    }
    sections.push({ tag: match[1]!, content: match[2]!.trim() });
    lastIndex = sectionRegex.lastIndex;
  }

  // Text after the last block
  if (lastIndex < prompt.length) {
    const post = prompt.slice(lastIndex).trim();
    if (post.length > 0) {
      sections.push({ tag: "extra", content: post });
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-pilot-context-prompt")
export class PilotContextPrompt extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        margin-top: 14px;
      }

      /* Section header */
      .sp-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
        margin-bottom: 6px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--bg-border);
      }

      .sp-header-icon {
        font-size: 12px;
        opacity: 0.7;
      }

      .sp-built-at {
        margin-left: auto;
        font-size: 9px;
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
        opacity: 0.6;
        font-family: var(--font-mono);
      }

      /* Empty / loading states */
      .sp-empty {
        font-size: 11px;
        color: var(--text-muted);
        font-style: italic;
        padding: 8px 0;
      }

      /* Accordion list */
      .sp-sections {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      /* Individual section item */
      .sp-section {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        overflow: hidden;
      }

      /* Section toggle button */
      .sp-section-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 5px 7px;
        background: var(--bg-hover);
        border: none;
        cursor: pointer;
        font-family: var(--font-ui);
        font-size: 11px;
        font-weight: 500;
        color: var(--text-secondary);
        text-align: left;
        transition: background 0.12s;
        min-height: 28px;
      }

      .sp-section-toggle:hover {
        background: var(--accent-subtle);
        color: var(--accent);
      }

      .sp-section-toggle.open {
        background: var(--accent-subtle);
        color: var(--accent);
      }

      .sp-section-icon {
        font-size: 11px;
        flex-shrink: 0;
        opacity: 0.8;
      }

      .sp-section-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .sp-section-len {
        font-size: 9px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        margin-left: auto;
        flex-shrink: 0;
      }

      .sp-chevron {
        font-size: 9px;
        flex-shrink: 0;
        transition: transform 0.15s;
        color: var(--text-muted);
      }

      .sp-chevron.open {
        transform: rotate(90deg);
      }

      /* Section content */
      .sp-section-body {
        display: none;
        padding: 8px;
        background: var(--bg-base);
        border-top: 1px solid var(--bg-border);
      }

      .sp-section-body.open {
        display: block;
      }

      .sp-section-content {
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--text-secondary);
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.5;
        max-height: 300px;
        overflow-y: auto;
      }

      /* Copy button */
      .sp-copy-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-top: 6px;
        padding: 2px 6px;
        font-size: 9px;
        font-family: var(--font-ui);
        color: var(--text-muted);
        background: none;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: color 0.12s;
      }

      .sp-copy-btn:hover {
        color: var(--accent);
        border-color: var(--accent);
      }
    `,
  ];

  @property({ type: String }) systemPrompt: string | null = null;
  @property({ type: String }) builtAt: string | null = null;

  /** Set of section tags that are currently open */
  @state() private _openSections = new Set<string>();

  /** Tracks copy feedback per tag */
  @state() private _copiedTag = "";

  private _toggleSection(tag: string): void {
    const next = new Set(this._openSections);
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    this._openSections = next;
  }

  private _formatBuiltAt(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return iso;
    }
  }

  private async _copySection(content: string, tag: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      this._copiedTag = tag;
      setTimeout(() => {
        this._copiedTag = "";
      }, 1500);
    } catch {
      // clipboard not available — silent fail
    }
  }

  private _renderSection(section: PromptSection, index: number): unknown {
    const tag = section.tag;
    // Deduplicate: if multiple "extra" sections, suffix with index
    const key = tag === "extra" ? `extra-${index}` : tag;
    const isOpen = this._openSections.has(key);
    const label =
      tag === "extra"
        ? msg("Extra content", { id: "ctx-prompt-extra-label" })
        : (TAG_LABELS[tag] ?? tag);
    const icon = TAG_ICONS[tag] ?? "◦";
    const charLen = section.content.length;
    const lenLabel = charLen >= 1000 ? `${(charLen / 1000).toFixed(1)}k` : String(charLen);
    const isCopied = this._copiedTag === key;

    return html`
      <div class="sp-section">
        <button
          class="sp-section-toggle ${isOpen ? "open" : ""}"
          @click=${() => this._toggleSection(key)}
          title="${label}"
        >
          <span class="sp-section-icon">${icon}</span>
          <span class="sp-section-label">${label}</span>
          <span class="sp-section-len">${lenLabel}</span>
          <span class="sp-chevron ${isOpen ? "open" : ""}">▶</span>
        </button>

        <div class="sp-section-body ${isOpen ? "open" : ""}">
          <pre class="sp-section-content">${section.content}</pre>
          <button class="sp-copy-btn" @click=${() => void this._copySection(section.content, key)}>
            ${isCopied
              ? msg("Copied!", { id: "ctx-prompt-copied" })
              : msg("Copy", { id: "ctx-prompt-copy" })}
          </button>
        </div>
      </div>
    `;
  }

  override render() {
    return html`
      <div class="sp-header">
        <span class="sp-header-icon">⬚</span>
        <span>${msg("System prompt", { id: "ctx-prompt-title" })}</span>
        ${this.builtAt
          ? html`<span class="sp-built-at">${this._formatBuiltAt(this.builtAt)}</span>`
          : nothing}
      </div>

      ${this.systemPrompt === null
        ? html`<p class="sp-empty">
            ${msg("Available after first message", { id: "ctx-prompt-empty" })}
          </p>`
        : (() => {
            const sections = parsePromptSections(this.systemPrompt);
            if (sections.length === 0) {
              return html`<p class="sp-empty">
                ${msg("No sections detected", { id: "ctx-prompt-no-sections" })}
              </p>`;
            }
            return html`
              <div class="sp-sections">${sections.map((s, i) => this._renderSection(s, i))}</div>
            `;
          })()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-context-prompt": PilotContextPrompt;
  }
}
