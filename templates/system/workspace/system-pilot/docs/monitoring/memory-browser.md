# Memory Browser

View and inspect agent memory files accumulated during permanent sessions. The memory browser provides visibility into what agents have learned, decided, and recorded over time, with full-text search and decay-based relevance scoring.

## How Agent Memory Works

Agents with permanent sessions accumulate memory by writing to files in their `memory/` directory. Memory persists across conversations, giving agents long-term recall of facts, decisions, and events.

### Memory Files

| File | Purpose | Content |
|------|---------|---------|
| `facts.md` | Learned facts | Information the agent has discovered or been told |
| `decisions.md` | Configuration decisions | Choices the agent has made about how to operate |
| `timeline.md` | Important events | Chronological record of significant occurrences |

Agents write to these files using workspace file tools during normal operation. The files grow over time as agents accumulate experience.

## Memory in the System Prompt

Memory files are injected directly into the agent's system prompt when `promptMode=full` is active. This means the LLM sees memory content as part of its instructions, not as conversation messages.

Memory files are excluded from `ws_search_files` and `ws_list_files` results to avoid duplication. Since memory is already in the system prompt, surfacing it again through workspace search would be redundant and waste context window tokens.

## Full-Text Search

The memory system uses FTS5 (SQLite full-text search) via the `memory-index.db` database. This enables fast keyword search across all memory files for all agents in an instance.

FTS5 uses BM25 ranking to order search results by relevance, prioritizing documents where search terms appear frequently and are relatively rare across the corpus.

## Decay Scoring

Memory entries are scored with a decay function that reduces the relevance of older memories over time. Recent memories score higher than older ones, reflecting the assumption that newer information is more likely to be relevant.

The decay score is combined with the FTS5 relevance score to produce a final ranking. This means a highly relevant old memory can still rank above a marginally relevant recent one.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/instances/:slug/memory` | Returns memory files with decay scores |

The response includes:

| Field | Description |
|-------|-------------|
| file | Memory file path |
| content | File content (Markdown) |
| decayScore | Relevance score adjusted for age |
| lastModified | When the file was last written |
| agentId | Which agent owns this memory |

## Dashboard Memory Browser

The dashboard provides a memory browser panel that displays:

- All memory files for the selected instance, grouped by agent
- Files sorted by relevance (decay-adjusted score)
- File content rendered as Markdown
- Last modification timestamp for each file

The browser allows quick inspection of what each agent knows and has decided, without needing to SSH into the instance or navigate the filesystem.

## Use Cases

- **Understanding agent decisions**: Read `decisions.md` to see why an agent is configured the way it is
- **Verifying learned facts**: Check `facts.md` to confirm agents have correctly recorded important information
- **Reviewing event history**: Browse `timeline.md` to see what significant events agents have logged
- **Debugging unexpected behavior**: If an agent acts on stale or incorrect information, inspect its memory files to find the source
- **Auditing agent knowledge**: Review accumulated memory before deploying agents to new environments

## Memory Lifecycle

Memory accumulates over the lifetime of a permanent session:

1. **Discovery**: Agent encounters new information during a conversation
2. **Recording**: Agent writes to the appropriate memory file (facts, decisions, or timeline)
3. **Indexing**: The FTS5 index is updated to include the new content
4. **Recall**: On the next interaction, memory files are injected into the system prompt
5. **Decay**: Over time, older entries receive lower relevance scores

Agents decide autonomously what to record in memory. The memory files serve as the agent's long-term knowledge base, complementing the short-term context of the current conversation.

## Troubleshooting

If memory files are empty, the agent may be using ephemeral sessions (subagents do not accumulate memory) or may not have been configured to write memory.

If decay scores seem wrong, check the agent's last activity timestamp. Decay is calculated from the current time, so inactive agents will have lower scores across all memory entries.

*ClawPilot v0.74.1*
