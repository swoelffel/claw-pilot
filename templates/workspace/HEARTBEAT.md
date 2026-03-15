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

---

## Sentinel Pattern — Full Example

### What is a Sentinel?

A Sentinel is a dedicated agent that runs on a heartbeat schedule (e.g. every 30 minutes)
to monitor the health and progress of other agents in the instance. It does NOT execute
tasks itself — it observes, escalates, and reports.

### Sentinel Cycle (detailed)

```
HEARTBEAT TICK (every 30m)
  |
  v
1. READ MEMORY.md
   - Restore context: active tasks, blocked items, last check timestamps
   |
  v
2. SCAN TASK STATUS
   - For each task in MEMORY.md with status IN_PROGRESS or BLOCKED:
     a. Use `task` tool to query the responsible agent:
        "What is the current status of task: <task_name>?"
     b. Record the response in MEMORY.md with timestamp
   |
  v
3. ESCALATION CHECK
   - If a task has been BLOCKED for >= 2 consecutive checks:
     a. Use `task` tool to notify the owner agent
     b. Log escalation in MEMORY.md
   |
  v
4. UPDATE MEMORY.md
   - Write updated task statuses with ISO timestamps
   - Keep total length under 500 words
   |
  v
5. CONCLUDE
   - If no issues found: reply exactly "HEARTBEAT_OK"
   - If issues found: reply with a brief summary (max 200 words)
```

### MEMORY.md format for Sentinel

```markdown
# Sentinel Memory

## Active Tasks

| Task | Agent | Status | Last Check | Notes |
|------|-------|--------|------------|-------|
| Deploy v1.2 | deploy-agent | IN_PROGRESS | 2026-03-15T10:00Z | On track |
| DB migration | db-agent | BLOCKED | 2026-03-15T09:30Z | Waiting for approval |

## Escalations

- 2026-03-15T10:00Z: DB migration blocked for 2 checks — notified db-agent owner

## Last Heartbeat

2026-03-15T10:00Z — 1 blocked task, 1 escalation sent
```

### Configuration example

See `docs/_work/ClawPilot/examples/sentinel-runtime.json` for a complete
runtime.json configuration with a Sentinel agent.
