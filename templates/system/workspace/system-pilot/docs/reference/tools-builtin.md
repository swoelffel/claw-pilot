# Built-in Agent Tools

ClawPilot provides 12 core built-in tools available to agents based on their assigned tool profile. Tools are exposed via the Model Context Protocol (MCP) and executed by the runtime engine. Plugin tools extend this set with additional capabilities.

## Core Tool Reference

| Tool | Description | Parameters |
|---|---|---|
| `read` | Read file content from the workspace or filesystem | `file_path`, `offset` (line), `limit` (lines) |
| `write` | Create or overwrite a file | `file_path`, `content` |
| `edit` | Find-and-replace text in a file | `file_path`, `old_string`, `new_string`, `replace_all` |
| `multiedit` | Apply multiple find-and-replace edits in a single call | `file_path`, `edits[]` (array of old/new pairs) |
| `bash` | Execute a shell command and return stdout/stderr | `command`, `timeout`, `run_in_background` |
| `glob` | Find files matching a glob pattern | `pattern`, `path` (search root) |
| `grep` | Search file contents with regex | `pattern`, `path`, `glob` (filter), `output_mode` |
| `webfetch` | Fetch and parse web content (HTML to markdown) | `url`, `format` (html/markdown/text) |
| `question` | Ask the user a question, optionally with clickable options | `question`, `options[]` |
| `todowrite` | Create or update a structured todo list | `todos[]` (task items with status) |
| `todoread` | Read the current todo list state | (none) |
| `skill` | Invoke a named skill from the agent workspace | `skill`, `args` |

## Tool Profiles

Tool profiles control which tools are available to an agent. Each profile is a named set that the runtime resolves at session initialization. Profiles are assigned in the agent configuration.

| Profile | Tools Included | Typical Use |
|---|---|---|
| `minimal` | question | Simple Q&A agents, no file or system access |
| `messaging` | question, webfetch | Research agents, web browsing, user interaction |
| `coding` | read, write, edit, multiedit, bash, glob, grep, question, todowrite, todoread, skill | Developer agents, full filesystem and shell access |
| `full` | All coding tools + task, send_message | Team agents with task management and A2A messaging |
| `pilot` | question, webfetch, task, send_message, task_board, create_artifact, send_file | Orchestrator agents that coordinate teams |

## Tool Profile Details

### minimal

The most restricted profile. Agents can only ask questions to the user. No filesystem access, no shell commands, no network access. Suitable for chatbot-style agents that answer questions from their training data and system prompt.

### messaging

Adds web fetching to the minimal profile. Agents can retrieve and parse web pages. Useful for research assistants and information-gathering agents.

### coding

The standard developer profile. Provides full filesystem access (read, write, edit, multiedit), shell command execution (bash), file search (glob, grep), and workspace skill invocation. This is the default profile for coding agents.

### full

Extends coding with team collaboration tools. Agents can create and manage tasks on the task board (`task`) and send messages to other agent instances (`send_message`). Used by agents that participate in multi-agent workflows.

### pilot

Designed for orchestrator and pilot agents. Includes question, webfetch, task management, inter-agent messaging, task board overview, artifact creation, and file sending. Does not include filesystem editing tools — pilots delegate coding work to subagents.

## Plugin Tools

Plugin tools extend the built-in set with additional capabilities loaded at runtime. They are registered via the plugin system and added on top of the agent's base tool profile.

| Plugin Tool | Description | Source |
|---|---|---|
| `ws_list_files` | List files in an agent's workspace directory | Workspace plugin |
| `ws_search_files` | Full-text search across workspace files (FTS5) | Workspace plugin |

## Permission System

Tools can be gated by the permission system. Permission rules (stored in `rt_permissions`) define allow, deny, or ask policies per tool and per scope pattern. When a tool call matches an "ask" rule, the runtime pauses execution and sends a `permission.asked` event to the user.

| Permission Action | Behavior |
|---|---|
| `allow` | Tool executes immediately without user intervention |
| `deny` | Tool call is blocked and an error returned to the agent |
| `ask` | Execution paused, user prompted to allow or deny |

## Tool Call Lifecycle

1. Agent generates a tool call in its response stream
2. Runtime resolves the tool from the agent's profile
3. Permission rules are evaluated (allow/deny/ask)
4. Tool executes and returns a result
5. Bus events emitted: `tool.call.started` and `tool.call.ended`
6. Result is fed back into the agent's conversation context

## Error Recovery

When a tool call fails, the runtime emits a `tool.error.recovered` event and returns the error message to the agent. The agent can retry or choose an alternative approach. Doom loop detection (`tool.doom_loop` event) triggers when an agent repeatedly calls the same tool with the same parameters and gets the same error.

*ClawPilot v0.74.1*
