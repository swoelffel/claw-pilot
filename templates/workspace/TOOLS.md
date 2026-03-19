# TOOLS.md — {{agentName}}

## Available tools

| Tool | Description |
|------|-------------|
| `read` | Read file contents |
| `write` | Write or overwrite a file |
| `edit` | Apply targeted edits to a file |
| `exec` | Execute shell commands |
| `glob` | Find files by pattern |
| `grep` | Search file contents by regex |
| `webFetch` | Fetch content from a URL |

## agentToAgent syntax

```
agentToAgent(agentId: "<target-id>", message: "<msg>", timeoutSeconds: 180)
```

| Timeout | Use case |
|---------|----------|
| 60s | Quick question |
| 120s | Short task |
| **180s** | **Standard (default)** |
| 300s | Complex implementation |

## Control tokens

- `REPLY_SKIP` — End the exchange.
- `ANNOUNCE_SKIP` — Suppress summary to external channel.
