// ui/src/components/memory-browser.ts
// Full-page memory browser — explore and search agent memory files.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { tokenStyles } from "../styles/tokens.js";
import { fetchMemoryAgents, fetchMemoryFiles, fetchMemoryFile, searchMemoryFiles } from "../api.js";
import type { MemoryAgentSummary, MemoryFileInfo, MemorySearchResult } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 300;

const DECAY_COLORS = {
  high: "#34d399", // >= 0.7
  mid: "#fbbf24", // 0.4 - 0.7
  low: "#f87171", // < 0.4
  none: "#64748b", // no score
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtRelativeTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

/** Extract the short filename from a path like "memory/facts.md" */
function shortName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1]!;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-memory-browser")
export class MemoryBrowser extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        padding: var(--space-6);
        max-width: 1200px;
        margin: 0 auto;
      }

      /* ── Header ────────────────────────────────────────────────── */

      .header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin-bottom: var(--space-4);
        flex-wrap: wrap;
      }

      .btn-back {
        background: none;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        padding: 4px 10px;
        cursor: pointer;
        font-size: 13px;
        font-family: inherit;
      }
      .btn-back:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
      }

      .search-input {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        padding: 6px 12px;
        font-size: 13px;
        font-family: inherit;
        width: 240px;
      }
      .search-input::placeholder {
        color: var(--text-muted);
      }
      .search-input:focus {
        outline: none;
        border-color: var(--accent);
      }

      /* ── Main layout ───────────────────────────────────────────── */

      .main {
        display: flex;
        gap: 1px;
        background: var(--bg-border);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        min-height: 480px;
      }

      .sidebar-agents {
        width: 180px;
        flex-shrink: 0;
        background: var(--bg-surface);
        overflow-y: auto;
      }

      .sidebar-files {
        width: 200px;
        flex-shrink: 0;
        background: var(--bg-surface);
        overflow-y: auto;
      }

      .content-panel {
        flex: 1;
        background: var(--bg-surface);
        overflow-y: auto;
        padding: var(--space-4);
      }

      /* ── Agent list ────────────────────────────────────────────── */

      .agent-item {
        padding: 10px 14px;
        cursor: pointer;
        border-bottom: 1px solid var(--bg-border);
        transition: background 0.1s;
      }
      .agent-item:hover {
        background: var(--bg-hover);
      }
      .agent-item.selected {
        background: var(--bg-hover);
        border-left: 3px solid var(--accent);
        padding-left: 11px;
      }

      .agent-name {
        font-weight: 500;
        color: var(--text-primary);
        font-size: 13px;
      }

      .agent-meta {
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 2px;
      }

      /* ── File tree ─────────────────────────────────────────────── */

      .file-item {
        padding: 8px 14px;
        cursor: pointer;
        border-bottom: 1px solid var(--bg-border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        transition: background 0.1s;
      }
      .file-item:hover {
        background: var(--bg-hover);
      }
      .file-item.selected {
        background: var(--bg-hover);
        border-left: 3px solid var(--accent);
        padding-left: 11px;
      }

      .file-name {
        font-size: 12px;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .file-name.is-index {
        font-weight: 600;
      }
      .file-name.is-sub {
        padding-left: 12px;
        color: var(--text-secondary);
      }

      .file-size {
        font-size: 10px;
        color: var(--text-muted);
        flex-shrink: 0;
      }

      /* ── Content viewer ────────────────────────────────────────── */

      .md-render {
        font-size: 13px;
        line-height: 1.65;
        color: var(--text-secondary);
      }
      .md-render h1,
      .md-render h2,
      .md-render h3 {
        color: var(--text-primary);
        margin-top: 14px;
        margin-bottom: 6px;
        font-size: 14px;
      }
      .md-render h1 {
        font-size: 16px;
      }
      .md-render p {
        margin: 6px 0;
      }
      .md-render ul,
      .md-render ol {
        padding-left: 18px;
        margin: 6px 0;
      }
      .md-render code {
        background: var(--bg-border);
        padding: 1px 5px;
        border-radius: 3px;
        font-family: var(--font-mono);
        font-size: 11px;
      }
      .md-render pre {
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 10px 12px;
        overflow-x: auto;
      }
      .md-render pre code {
        background: none;
        padding: 0;
      }
      .md-render blockquote {
        border-left: 3px solid var(--accent-border);
        margin: 8px 0;
        padding: 4px 12px;
        color: var(--text-muted);
      }

      .decay-line {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-secondary);
      }

      .decay-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .decay-score {
        font-size: 10px;
        color: var(--text-muted);
        font-variant-numeric: tabular-nums;
        flex-shrink: 0;
        min-width: 28px;
      }

      /* ── Search results ────────────────────────────────────────── */

      .search-result {
        padding: var(--space-3);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        margin-bottom: var(--space-2);
        cursor: pointer;
        transition: border-color 0.15s;
      }
      .search-result:hover {
        border-color: var(--accent-border);
      }

      .search-result-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin-bottom: 4px;
      }

      .search-agent-tag {
        font-size: 10px;
        font-weight: 600;
        background: var(--accent-subtle);
        color: var(--accent);
        padding: 1px 6px;
        border-radius: 3px;
      }

      .search-source {
        font-size: 11px;
        color: var(--text-muted);
      }

      .search-line {
        font-size: 10px;
        color: var(--text-muted);
      }

      .search-snippet {
        font-size: 12px;
        color: var(--text-secondary);
        white-space: pre-wrap;
        font-family: var(--font-mono);
        line-height: 1.5;
      }

      mark {
        background: rgba(79, 110, 247, 0.25);
        color: var(--text-primary);
        border-radius: 2px;
        padding: 0 1px;
      }

      /* ── Stats bar ─────────────────────────────────────────────── */

      .stats-bar {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-2) var(--space-3);
        margin-top: var(--space-3);
        font-size: 12px;
        color: var(--text-muted);
      }

      /* ── Empty / loading / error states ────────────────────────── */

      .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted);
        font-size: 13px;
        padding: var(--space-6);
        text-align: center;
      }

      .error-banner {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: var(--radius-sm);
        color: #f87171;
        padding: var(--space-2) var(--space-3);
        font-size: 13px;
        margin-bottom: var(--space-3);
      }

      .loading-indicator {
        color: var(--text-muted);
        font-size: 12px;
        padding: var(--space-4);
        text-align: center;
      }

      @media (max-width: 800px) {
        .main {
          flex-direction: column;
          min-height: auto;
        }
        .sidebar-agents,
        .sidebar-files {
          width: 100%;
          max-height: 200px;
        }
      }
    `,
  ];

  @property() slug = "";

  // Data
  @state() private _agents: MemoryAgentSummary[] = [];
  @state() private _selectedAgentId = "";
  @state() private _files: MemoryFileInfo[] = [];
  @state() private _selectedFile = "";
  @state() private _fileContent = "";

  // Search
  @state() private _searchQuery = "";
  @state() private _searchResults: MemorySearchResult[] = [];
  @state() private _searchMode = false;

  // Loading / error
  @state() private _loading = false;
  @state() private _loadingFile = false;
  @state() private _error: string | null = null;

  private _searchTimeout: ReturnType<typeof setTimeout> | undefined;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._searchTimeout) {
      clearTimeout(this._searchTimeout);
      this._searchTimeout = undefined;
    }
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug") && this.slug) {
      this._reset();
      void this._loadAgents();
    }
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  private _reset(): void {
    this._agents = [];
    this._selectedAgentId = "";
    this._files = [];
    this._selectedFile = "";
    this._fileContent = "";
    this._searchQuery = "";
    this._searchResults = [];
    this._searchMode = false;
    this._error = null;
  }

  private async _loadAgents(): Promise<void> {
    if (!this.slug) return;
    this._loading = true;
    this._error = null;
    try {
      const data = await fetchMemoryAgents(this.slug);
      this._agents = data.agents;
      // Auto-select if single agent
      if (this._agents.length === 1) {
        this._selectedAgentId = this._agents[0]!.agentId;
        await this._loadFiles(this._selectedAgentId);
      }
    } catch (e) {
      this._error = e instanceof Error ? e.message : "Failed to load agents";
    }
    this._loading = false;
  }

  private async _loadFiles(agentId: string): Promise<void> {
    if (!this.slug) return;
    this._files = [];
    this._selectedFile = "";
    this._fileContent = "";
    try {
      const data = await fetchMemoryFiles(this.slug, agentId);
      this._files = data.files;
      // Auto-select MEMORY.md if present
      const memoryMd = this._files.find((f) => f.path === "MEMORY.md");
      if (memoryMd) {
        await this._loadFile(memoryMd.path);
      }
    } catch (e) {
      this._error = e instanceof Error ? e.message : "Failed to load files";
    }
  }

  private async _loadFile(filePath: string): Promise<void> {
    if (!this.slug || !this._selectedAgentId) return;
    this._selectedFile = filePath;
    this._loadingFile = true;
    this._searchMode = false;
    try {
      const data = await fetchMemoryFile(this.slug, this._selectedAgentId, filePath);
      this._fileContent = data.content;
    } catch (e) {
      this._error = e instanceof Error ? e.message : "Failed to load file";
      this._fileContent = "";
    }
    this._loadingFile = false;
  }

  private _onSearchInput(e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this._searchQuery = value;

    if (this._searchTimeout) clearTimeout(this._searchTimeout);

    if (!value.trim()) {
      this._searchMode = false;
      this._searchResults = [];
      return;
    }

    this._searchTimeout = setTimeout(() => {
      void this._runSearch(value.trim());
    }, SEARCH_DEBOUNCE_MS);
  }

  private async _runSearch(query: string): Promise<void> {
    if (!this.slug || !query) return;
    this._searchMode = true;
    this._loadingFile = true;
    try {
      const data = await searchMemoryFiles(this.slug, query);
      this._searchResults = data.results;
    } catch {
      this._searchResults = [];
    }
    this._loadingFile = false;
  }

  private async _selectSearchResult(result: MemorySearchResult): Promise<void> {
    // Navigate to the agent and file
    this._selectedAgentId = result.agentId;
    this._searchMode = false;
    this._searchQuery = "";
    await this._loadFiles(result.agentId);
    await this._loadFile(result.source);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private async _selectAgent(agentId: string): Promise<void> {
    this._selectedAgentId = agentId;
    this._searchMode = false;
    await this._loadFiles(agentId);
  }

  private _goBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "cluster" },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  override render() {
    return html`
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}

      <div class="header">
        <button class="btn-back" @click=${this._goBack}>
          ← ${msg("Back", { id: "btn-back" })}
        </button>
        <span class="title">${msg("Memory", { id: "memory.title" })}</span>
        <input
          class="search-input"
          type="text"
          placeholder="${msg("Search memory...", { id: "memory.search-placeholder" })}"
          .value=${this._searchQuery}
          @input=${this._onSearchInput}
        />
      </div>

      ${this._loading
        ? html`<div class="loading-indicator">${msg("Loading...", { id: "loading" })}</div>`
        : this._agents.length === 0
          ? html`<div class="empty-state">
              ${msg("No memory files found for this instance", {
                id: "memory.empty-instance",
              })}
            </div>`
          : html`
              <div class="main">
                ${this._renderAgentsSidebar()} ${this._renderFilesSidebar()}
                ${this._renderContentPanel()}
              </div>
              ${this._renderStatsBar()}
            `}
    `;
  }

  private _renderAgentsSidebar() {
    return html`
      <div class="sidebar-agents">
        ${this._agents.map(
          (agent) => html`
            <div
              class="agent-item ${agent.agentId === this._selectedAgentId ? "selected" : ""}"
              @click=${() => this._selectAgent(agent.agentId)}
            >
              <div class="agent-name">${agent.name}</div>
              <div class="agent-meta">
                ${agent.fileCount}
                ${agent.fileCount === 1
                  ? msg("file", { id: "memory.file-singular" })
                  : msg("files", { id: "memory.file-plural" })}
                · ${fmtBytes(agent.totalSize)}
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderFilesSidebar() {
    if (!this._selectedAgentId) {
      return html`<div class="sidebar-files">
        <div class="empty-state">${msg("Select an agent", { id: "memory.select-agent" })}</div>
      </div>`;
    }

    if (this._files.length === 0) {
      return html`<div class="sidebar-files">
        <div class="empty-state">${msg("No memory files", { id: "memory.empty-agent" })}</div>
      </div>`;
    }

    return html`
      <div class="sidebar-files">
        ${this._files.map(
          (file) => html`
            <div
              class="file-item ${file.path === this._selectedFile ? "selected" : ""}"
              @click=${() => this._loadFile(file.path)}
            >
              <span
                class="file-name ${file.path === "MEMORY.md"
                  ? "is-index"
                  : file.path.startsWith("memory/")
                    ? "is-sub"
                    : ""}"
              >
                ${shortName(file.path)}
              </span>
              <span class="file-size">${fmtBytes(file.size)}</span>
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderContentPanel() {
    if (this._loadingFile) {
      return html`<div class="content-panel">
        <div class="loading-indicator">${msg("Loading...", { id: "loading" })}</div>
      </div>`;
    }

    if (this._searchMode) {
      return html`<div class="content-panel">${this._renderSearchResults()}</div>`;
    }

    if (!this._fileContent) {
      return html`<div class="content-panel">
        <div class="empty-state">
          ${msg("Select a file to view its content", { id: "memory.select-file" })}
        </div>
      </div>`;
    }

    return html`<div class="content-panel">${this._renderFileContent()}</div>`;
  }

  private _renderFileContent() {
    // Check if content has decay scores — if so, render with visual indicators
    const hasDecayScores = /^- \[\d+\.\d+\]/m.test(this._fileContent);

    if (hasDecayScores) {
      return this._renderDecayContent(this._fileContent);
    }

    // Standard markdown rendering
    const rawHtml = marked.parse(this._fileContent) as string;
    const clean = DOMPurify.sanitize(rawHtml);
    return html`<div class="md-render" .innerHTML=${clean}></div>`;
  }

  private _renderDecayContent(content: string) {
    const lines = content.split("\n");
    const sections: Array<{ type: "heading" | "decay" | "text"; content: string; score?: number }> =
      [];

    for (const line of lines) {
      const decayMatch = line.match(/^- \[(\d+\.\d+)\]\s*(.*)$/);
      if (decayMatch) {
        sections.push({
          type: "decay",
          content: decayMatch[2]!,
          score: parseFloat(decayMatch[1]!),
        });
      } else if (line.startsWith("#")) {
        sections.push({ type: "heading", content: line });
      } else if (line.trim()) {
        sections.push({ type: "text", content: line });
      }
    }

    return html`
      ${sections.map((s) => {
        if (s.type === "heading") {
          const rawHtml = marked.parse(s.content) as string;
          const clean = DOMPurify.sanitize(rawHtml);
          return html`<div class="md-render" .innerHTML=${clean}></div>`;
        }
        if (s.type === "decay") {
          const color = this._decayColor(s.score!);
          return html`
            <div class="decay-line">
              <span class="decay-dot" style="background:${color}"></span>
              <span class="decay-score">${s.score!.toFixed(1)}</span>
              <span>${s.content}</span>
            </div>
          `;
        }
        return html`<div style="font-size:13px;color:var(--text-secondary);padding:2px 0">
          ${s.content}
        </div>`;
      })}
    `;
  }

  private _decayColor(score: number): string {
    if (score >= 0.7) return DECAY_COLORS.high;
    if (score >= 0.4) return DECAY_COLORS.mid;
    return DECAY_COLORS.low;
  }

  private _renderSearchResults() {
    if (this._searchResults.length === 0) {
      return html`<div class="empty-state">
        ${msg("No results found", { id: "memory.search-empty" })}
      </div>`;
    }

    return html`
      ${this._searchResults.map(
        (r) => html`
          <div class="search-result" @click=${() => this._selectSearchResult(r)}>
            <div class="search-result-header">
              <span class="search-agent-tag">${r.agentId}</span>
              <span class="search-source">${r.source}</span>
              <span class="search-line">L${r.line}</span>
            </div>
            <div class="search-snippet">${this._highlightSnippet(r.snippet)}</div>
          </div>
        `,
      )}
    `;
  }

  private _highlightSnippet(snippet: string) {
    if (!this._searchQuery.trim()) return snippet;
    const query = this._searchQuery.trim();
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = snippet.split(regex);
    return parts.map((part) => (regex.test(part) ? html`<mark>${part}</mark>` : part));
  }

  private _renderStatsBar() {
    const totalFiles = this._agents.reduce((s, a) => s + a.fileCount, 0);
    const totalSize = this._agents.reduce((s, a) => s + a.totalSize, 0);
    const latest = this._agents
      .map((a) => a.lastModified)
      .filter(Boolean)
      .sort()
      .reverse()[0];

    return html`
      <div class="stats-bar">
        <span>
          ${totalFiles}
          ${totalFiles === 1
            ? msg("file", { id: "memory.file-singular" })
            : msg("files", { id: "memory.file-plural" })}
        </span>
        <span>·</span>
        <span>${fmtBytes(totalSize)}</span>
        ${latest
          ? html`
              <span>·</span>
              <span>${msg("Modified", { id: "memory.modified" })} ${fmtRelativeTime(latest)}</span>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-memory-browser": MemoryBrowser;
  }
}
