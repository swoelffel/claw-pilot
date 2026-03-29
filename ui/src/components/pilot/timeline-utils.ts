// ui/src/components/pilot/timeline-utils.ts
// Pure functions to transform PilotMessage[] into a unified TimelineEntry[] and apply filters.
import type {
  PilotMessage,
  PilotPart,
  TimelineEntry,
  TimelineEntryKind,
  TimelineFilters,
} from "../../types.js";

// ---------------------------------------------------------------------------
// A2A regex patterns — match the format from send-message.ts
// ---------------------------------------------------------------------------

const A2A_SENT_RE = /^\[message_sent\] To ([^:]+): ([\s\S]*)$/;
const A2A_RECEIVED_RE = /^\[message_received\] From ([^:]+): ([\s\S]*)$/;

// ---------------------------------------------------------------------------
// Part type → TimelineEntryKind mapping
// ---------------------------------------------------------------------------

function partTypeToKind(part: PilotPart): TimelineEntryKind | null {
  let toolName: string | undefined;
  switch (part.type) {
    case "text":
      return "agent_text";
    case "tool_call":
      // Detect create_artifact tool calls
      try {
        toolName = (JSON.parse(part.metadata ?? "{}") as { toolName?: string }).toolName;
      } catch {
        /* ignore */
      }
      return toolName === "create_artifact" ? "artifact" : "tool_call";
    case "tool_result":
      // Rendered inline with their tool_call — skip
      return null;
    case "reasoning":
      return "reasoning";
    case "subtask":
      return "subtask";
    case "compaction":
      return "compaction";
    case "image":
      return "image";
    case "suggestion":
      return "suggestion";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Extract text content from a user message
// ---------------------------------------------------------------------------

function getUserText(msg: PilotMessage): string {
  const textPart = msg.parts.find((p) => p.type === "text");
  return textPart?.content ?? "";
}

// ---------------------------------------------------------------------------
// buildTimeline — main transformation
// ---------------------------------------------------------------------------

/** Transform a flat list of PilotMessages into a unified timeline of entries. */
export function buildTimeline(messages: PilotMessage[], currentAgentId?: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = getUserText(msg);
      const channel = (msg as unknown as { channel?: string }).channel;

      // 1. Check for A2A sent pattern
      const sentMatch = A2A_SENT_RE.exec(text);
      if (sentMatch && sentMatch[1] && sentMatch[2] !== undefined) {
        entries.push({
          id: msg.id,
          kind: "a2a_sent",
          timestamp: msg.createdAt,
          source: currentAgentId ?? "agent",
          message: msg,
          a2aTarget: sentMatch[1],
          a2aContent: sentMatch[2],
          ...(channel !== undefined ? { channel } : {}),
        });
        continue;
      }

      // 2. Check for A2A received pattern
      const recvMatch = A2A_RECEIVED_RE.exec(text);
      if (recvMatch && recvMatch[1] && recvMatch[2] !== undefined) {
        entries.push({
          id: msg.id,
          kind: "a2a_received",
          timestamp: msg.createdAt,
          source: recvMatch[1],
          message: msg,
          a2aTarget: recvMatch[1],
          a2aContent: recvMatch[2],
          ...(channel !== undefined ? { channel } : {}),
        });
        continue;
      }

      // 3. Normal user message
      entries.push({
        id: msg.id,
        kind: "user_chat",
        timestamp: msg.createdAt,
        source: "You",
        message: msg,
        ...(channel !== undefined ? { channel } : {}),
      });
    } else {
      // Assistant message — flatten parts into individual entries
      const parts = [...msg.parts].sort((a, b) => a.sortOrder - b.sortOrder);
      const agentSource = msg.agentId ?? "agent";

      // Track which parts produce entries, to mark the last one
      const partEntries: TimelineEntry[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const kind = partTypeToKind(part);
        if (kind === null) continue;

        partEntries.push({
          id: `${msg.id}:${i}`,
          kind,
          timestamp: msg.createdAt,
          source: agentSource,
          message: msg,
          part,
        });
      }

      // Mark the last entry for footer rendering
      const lastEntry = partEntries[partEntries.length - 1];
      if (lastEntry) {
        lastEntry.isLastInMessage = true;
      }

      entries.push(...partEntries);
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Filter mapping
// ---------------------------------------------------------------------------

const KIND_TO_FILTER: Partial<Record<TimelineEntryKind, keyof TimelineFilters>> = {
  user_chat: "chat",
  agent_text: "chat",
  a2a_sent: "a2a",
  a2a_received: "a2a",
  tool_call: "tools",
  reasoning: "thinking",
  subtask: "subtasks",
};

/** Filter timeline entries based on active filter toggles. */
export function filterTimeline(
  entries: TimelineEntry[],
  filters: TimelineFilters,
): TimelineEntry[] {
  return entries.filter((entry) => {
    const filterKey = KIND_TO_FILTER[entry.kind];
    // Kinds without a dedicated filter (compaction, image, artifact, suggestion) are always visible
    if (filterKey === undefined) return true;
    return filters[filterKey];
  });
}
