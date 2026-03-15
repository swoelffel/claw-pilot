# Heartbeat Tasks

## Every session start
- Read MEMORY.md to restore context on ongoing tasks

## Periodically (every N messages)
- Consolidate memory: review recent activity, update MEMORY.md

## On session end
- Write a brief summary to MEMORY.md

---

## Sentinel Pattern (optional)

If this agent is configured as a Sentinel (observer role), follow this cycle:

1. Read MEMORY.md to restore context on ongoing tasks
2. Identify tasks marked as IN PROGRESS or BLOCKED
3. For each blocked task:
   - Use the `task` tool to ask the responsible agent for a status update
   - If still blocked after 2 consecutive checks: send a Telegram alert
4. Update MEMORY.md with the current status of all monitored tasks
5. If nothing to report: reply exactly `HEARTBEAT_OK`

### Sentinel Rules
- OBSERVE only — never execute tasks directly
- DELEGATE via `task` tool if action is needed
- Keep MEMORY.md concise (max 500 words)
