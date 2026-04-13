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
// Target-side format: injected into the recipient's session by send-message.ts
const A2A_FROM_RE = /^\[message_from:([^\]]+)\] ([\s\S]*)$/;
// Delegation traces injected by task.ts after a subagent completes
// Caller-side: "[delegation] Asked <agent>: \"<desc>\" → <summary>"
const A2A_DELEGATION_SENT_RE = /^\[delegation\] Asked ([^:]+): ([\s\S]*)$/;
// Target-side (primary peer): "[delegation] <agent> asked: \"<desc>\" → I responded: <summary>"
const A2A_DELEGATION_RECEIVED_RE = /^\[delegation\] ([^\s]+) asked: ([\s\S]*)$/;
// Async subagent result: "[Async subagent result — task_id: <id>]\n...<task_result>...</task_result>"
const A2A_ASYNC_RESULT_RE =
  /^\[Async subagent result[\s\S]*?<task_result>\n?([\s\S]*?)\n?<\/task_result>/;

// ---------------------------------------------------------------------------
// Part type → TimelineEntryKind mapping
// ---------------------------------------------------------------------------

function partTypeToKind(part: PilotPart): TimelineEntryKind | null {
  let toolName: string | undefined;
  switch (part.type) {
    case "text":
      return "agent_text";
    case "tool_call":
      // Detect tool calls that should render with a dedicated kind:
      // - "question" → interactive Q&A card (always visible, never filtered)
      // - "create_artifact" → collapsible artifact card
      try {
        toolName = (JSON.parse(part.metadata ?? "{}") as { toolName?: string }).toolName;
      } catch {
        /* ignore */
      }
      if (toolName === "question") return "question";
      if (toolName === "create_artifact") return "artifact";
      return "tool_call";
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
          a2aTarget: currentAgentId ?? "agent",
          a2aContent: recvMatch[2],
          ...(channel !== undefined ? { channel } : {}),
        });
        continue;
      }

      // 3. Check for target-side A2A pattern: [message_from:agentId] content
      // fromMatch[1] = sender agent ID, currentAgentId = receiver (this session's agent)
      const fromMatch = A2A_FROM_RE.exec(text);
      if (fromMatch && fromMatch[1] && fromMatch[2] !== undefined) {
        entries.push({
          id: msg.id,
          kind: "a2a_received",
          timestamp: msg.createdAt,
          source: fromMatch[1],
          message: msg,
          a2aTarget: currentAgentId ?? "agent",
          a2aContent: fromMatch[2],
          ...(channel !== undefined ? { channel } : {}),
        });
        continue;
      }

      // 4. Delegation trace (caller-side): current agent asked a subagent
      const delegationSentMatch = A2A_DELEGATION_SENT_RE.exec(text);
      if (delegationSentMatch && delegationSentMatch[1] && delegationSentMatch[2] !== undefined) {
        entries.push({
          id: msg.id,
          kind: "a2a_sent",
          timestamp: msg.createdAt,
          source: currentAgentId ?? "agent",
          message: msg,
          a2aTarget: delegationSentMatch[1],
          a2aContent: delegationSentMatch[2],
          ...(channel !== undefined ? { channel } : {}),
        });
        continue;
      }

      // 5. Delegation trace (target-side): another agent asked current agent
      const delegationRecvMatch = A2A_DELEGATION_RECEIVED_RE.exec(text);
      if (delegationRecvMatch && delegationRecvMatch[1] && delegationRecvMatch[2] !== undefined) {
        entries.push({
          id: msg.id,
          kind: "a2a_received",
          timestamp: msg.createdAt,
          source: delegationRecvMatch[1],
          message: msg,
          a2aTarget: currentAgentId ?? "agent",
          a2aContent: delegationRecvMatch[2],
          ...(channel !== undefined ? { channel } : {}),
        });
        continue;
      }

      // 6. Async subagent result injection
      const asyncMatch = A2A_ASYNC_RESULT_RE.exec(text);
      if (asyncMatch && asyncMatch[1] !== undefined) {
        entries.push({
          id: msg.id,
          kind: "a2a_received",
          timestamp: msg.createdAt,
          source: "subagent",
          message: msg,
          a2aTarget: currentAgentId ?? "agent",
          a2aContent: asyncMatch[1],
          ...(channel !== undefined ? { channel } : {}),
        });
        continue;
      }

      // 7. Normal user message
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

        // After a completed question tool_call, surface the user's answer as
        // a user_chat entry so it appears in the chat flow (like a normal reply).
        // The tool output ("User answered: <text>") is written to the tool_call
        // part's own `content` field by tool-set-builder — there is no
        // separate tool_result part in this runtime.
        if (kind === "question" && part.state === "completed" && part.content) {
          const match = /^User answered:\s*([\s\S]*)$/.exec(part.content);
          const answer = match?.[1]?.trim();
          if (answer) {
            partEntries.push({
              id: `${msg.id}:${i}:answer`,
              kind: "user_chat",
              timestamp: msg.createdAt,
              source: "You",
              message: {
                id: `${msg.id}:${i}:answer`,
                sessionId: msg.sessionId,
                role: "user",
                isCompaction: false,
                createdAt: msg.createdAt,
                parts: [
                  {
                    id: `${msg.id}:${i}:answer:text`,
                    messageId: `${msg.id}:${i}:answer`,
                    type: "text",
                    state: "completed",
                    content: answer,
                    sortOrder: 0,
                    createdAt: msg.createdAt,
                    updatedAt: msg.createdAt,
                  },
                ],
              },
            });
          }
        }
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
  suggestion: "suggestions",
};

/** Filter timeline entries based on active filter toggles. */
export function filterTimeline(
  entries: TimelineEntry[],
  filters: TimelineFilters,
): TimelineEntry[] {
  return entries.filter((entry) => {
    const filterKey = KIND_TO_FILTER[entry.kind];
    // Kinds without a dedicated filter (compaction, image, artifact) are always visible
    if (filterKey === undefined) return true;
    return filters[filterKey];
  });
}
