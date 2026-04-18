# Global Search

Cross-entity search via the Command Palette. Global search provides instant full-text search across all ClawPilot entities using FTS5 BM25 ranking.

## Command Palette

Open the command palette with:

| Platform | Shortcut |
|----------|----------|
| macOS | `Cmd+K` |
| Linux / Windows | `Ctrl+K` |

The palette provides:
- Instant search as you type (no submit button needed)
- Results grouped by entity type
- Keyboard navigation with arrow keys
- Press `Enter` to navigate to the selected result
- Press `Escape` to close

## Searchable Entity Types

| Entity Type | What Is Searched | Navigation Target |
|-------------|-----------------|-------------------|
| instance | Instance name, slug, description | Instance dashboard |
| agent | Agent name, ID, role, instructions | Agent configuration panel |
| task | Task title, description, labels | Task detail view |
| blueprint | Blueprint name, description, category | Blueprint editor |
| agent_blueprint | Agent blueprint name, role, capabilities | Agent blueprint detail |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search?q=<query>&limit=<n>` | Search across all entity types |

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| q | string | required | Search query text |
| limit | integer | 20 | Maximum number of results to return |

### Response Format

Results are returned as an array of matches, each containing:

| Field | Description |
|-------|-------------|
| type | Entity type (instance, agent, task, blueprint, agent_blueprint) |
| id | Entity identifier |
| title | Display name or title |
| snippet | Text excerpt with matching terms highlighted |
| score | BM25 relevance score |

Results are sorted by BM25 score in descending order (most relevant first).

## Search Engine

### FTS5 Virtual Table

Search is powered by SQLite FTS5 via the `search_index` virtual table. FTS5 provides:
- Tokenized full-text indexing
- BM25 ranking algorithm for relevance scoring
- Prefix queries (partial word matching)
- Boolean operators (AND, OR, NOT)

### BM25 Ranking

BM25 (Best Match 25) ranks results based on:
- **Term frequency**: How often the search term appears in the document
- **Inverse document frequency**: Rarer terms score higher
- **Document length normalization**: Shorter documents with matches score higher

### Index Maintenance

The search index is rebuilt from entity data when entities are created, updated, or deleted. The index stays synchronized with the underlying data automatically.

## Search Tips

- Use specific keywords for better results (e.g., "monitoring agent" instead of "agent")
- Partial words are supported (e.g., "monit" matches "monitoring")
- Multiple words are ANDed by default (all must match)
- Search is case-insensitive

## Troubleshooting

If search returns no results for terms that should match:
- Verify the entity exists via direct API or dashboard navigation
- The search index may need rebuilding after a database migration
- Check that the search query does not contain special FTS5 syntax unintentionally

*ClawPilot v0.74.1*
