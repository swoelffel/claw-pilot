// src/dashboard/middleware/permission-actions.ts
//
// Catalogue of action identifiers that Community route modules pass to the
// permission middleware. Convention: "<resource-kind>.<verb>", lowercase,
// dot-separated, singular resource name.
//
// The `action` field of PermissionContext is typed as plain `string` — this
// const is purely an ergonomic catalogue; Enterprise may register its own
// actions without depending on this file (preserves R3 byte-identity on
// frozen paths).

export const ACTIONS = {
  // auth
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_ME: "auth.me",

  // profile
  PROFILE_READ: "profile.read",
  PROFILE_UPDATE: "profile.update",

  // named keys (sensitive: even reads are annotated)
  NAMED_KEY_READ: "named-key.read",
  NAMED_KEY_CREATE: "named-key.create",
  NAMED_KEY_UPDATE: "named-key.update",
  NAMED_KEY_DELETE: "named-key.delete",

  // system
  SYSTEM_HEALTH: "system.health",
  SYSTEM_UPDATE_STATUS: "system.update-status",
  SYSTEM_UPDATE_APPLY: "system.update-apply",

  // system instance
  SYSTEM_INSTANCE_STATUS: "system-instance.status",
  SYSTEM_INSTANCE_ENSURE: "system-instance.ensure",
  SYSTEM_INSTANCE_QUERY: "system-instance.query",
  SYSTEM_INSTANCE_READY: "system-instance.ready",

  // notifications
  NOTIFICATION_LIST: "notification.list",
  NOTIFICATION_UNREAD_COUNT: "notification.unread-count",
  NOTIFICATION_MARK_READ: "notification.mark-read",
  NOTIFICATION_MARK_ALL_READ: "notification.mark-all-read",

  // search
  SEARCH_QUERY: "search.query",

  // teams
  TEAM_EXPORT: "team.export",
  TEAM_IMPORT: "team.import",

  // agent blueprints
  AGENT_BLUEPRINT_LIST: "agent-blueprint.list",
  AGENT_BLUEPRINT_READ: "agent-blueprint.read",
  AGENT_BLUEPRINT_CREATE: "agent-blueprint.create",
  AGENT_BLUEPRINT_UPDATE: "agent-blueprint.update",
  AGENT_BLUEPRINT_DELETE: "agent-blueprint.delete",
  AGENT_BLUEPRINT_CLONE: "agent-blueprint.clone",
  AGENT_BLUEPRINT_FILE_READ: "agent-blueprint.file-read",
  AGENT_BLUEPRINT_FILE_UPDATE: "agent-blueprint.file-update",
  AGENT_BLUEPRINT_FILE_DELETE: "agent-blueprint.file-delete",
  AGENT_BLUEPRINT_FROM_AGENT: "agent-blueprint.from-agent",
  AGENT_BLUEPRINT_EXPORT: "agent-blueprint.export",
  AGENT_BLUEPRINT_IMPORT: "agent-blueprint.import",

  // blueprints (team templates)
  BLUEPRINT_LIST: "blueprint.list",
  BLUEPRINT_READ: "blueprint.read",
  BLUEPRINT_CREATE: "blueprint.create",
  BLUEPRINT_UPDATE: "blueprint.update",
  BLUEPRINT_DELETE: "blueprint.delete",
  BLUEPRINT_IMPORT_BUILTIN: "blueprint.import-builtin",
  BLUEPRINT_BUILDER_READ: "blueprint.builder-read",
  BLUEPRINT_AGENT_CREATE: "blueprint.agent-create",
  BLUEPRINT_AGENT_UPDATE: "blueprint.agent-update",
  BLUEPRINT_AGENT_DELETE: "blueprint.agent-delete",
  BLUEPRINT_AGENT_FILE_READ: "blueprint.agent-file-read",
  BLUEPRINT_AGENT_FILE_UPDATE: "blueprint.agent-file-update",

  // instances
  INSTANCE_LIST: "instance.list",
  INSTANCE_READ: "instance.read",
  INSTANCE_CREATE: "instance.create",
  INSTANCE_DELETE: "instance.delete",
  INSTANCE_START: "instance.start",
  INSTANCE_STOP: "instance.stop",
  INSTANCE_RESTART: "instance.restart",
  INSTANCE_HEALTH: "instance.health",
  INSTANCE_NEXT_PORT: "instance.next-port",
  INSTANCE_CONVERSATIONS_READ: "instance.conversations-read",
  INSTANCE_CONFIG_READ: "instance.config-read",
  INSTANCE_CONFIG_UPDATE: "instance.config-update",
  INSTANCE_CONFIG_TELEGRAM_TOKEN_UPDATE: "instance.config-telegram-token-update",

  // providers (listed under instances per URL)
  PROVIDER_LIST: "provider.list",

  // discover
  INSTANCE_DISCOVER: "instance.discover",
  INSTANCE_DISCOVER_ADOPT: "instance.discover-adopt",

  // mcp
  INSTANCE_MCP_TOOLS_READ: "instance.mcp-tools-read",
  INSTANCE_MCP_STATUS: "instance.mcp-status",

  // telegram
  INSTANCE_TELEGRAM_PAIRING_READ: "instance.telegram-pairing-read",
  INSTANCE_TELEGRAM_PAIRING_APPROVE: "instance.telegram-pairing-approve",
  INSTANCE_TELEGRAM_PAIRING_DELETE: "instance.telegram-pairing-delete",

  // budgets
  INSTANCE_BUDGET_LIST: "instance.budget-list",
  INSTANCE_BUDGET_CREATE: "instance.budget-create",
  INSTANCE_BUDGET_UPDATE: "instance.budget-update",
  INSTANCE_BUDGET_DELETE: "instance.budget-delete",
  INSTANCE_BUDGET_OVERRIDE: "instance.budget-override",
  INSTANCE_BUDGET_EVENTS_READ: "instance.budget-events-read",
  INSTANCE_BUDGET_RECONCILE: "instance.budget-reconcile",

  // runtime permissions (tool-call permission rules — orthogonal to route perms)
  INSTANCE_RUNTIME_PERMISSION_LIST: "instance.runtime-permission-list",
  INSTANCE_RUNTIME_PERMISSION_DELETE: "instance.runtime-permission-delete",
  INSTANCE_RUNTIME_PERMISSION_REPLY: "instance.runtime-permission-reply",

  // costs
  INSTANCE_COSTS_SUMMARY: "instance.costs-summary",
  INSTANCE_COSTS_DAILY: "instance.costs-daily",
  INSTANCE_COSTS_BY_AGENT: "instance.costs-by-agent",
  INSTANCE_COSTS_BY_MODEL: "instance.costs-by-model",

  // agents
  AGENT_LIST: "agent.list",
  AGENT_BUILDER_READ: "agent.builder-read",
  AGENT_CREATE: "agent.create",
  AGENT_FROM_TEMPLATE: "agent.from-template",
  AGENT_UPDATE_META: "agent.update-meta",
  AGENT_UPDATE_POSITION: "agent.update-position",
  AGENT_UPDATE_SPAWN_LINKS: "agent.update-spawn-links",
  AGENT_SYNC: "agent.sync",
  AGENT_DELETE: "agent.delete",
  AGENT_KICKOFF: "agent.kickoff",
  AGENT_FILES_READ: "agent.files-read",
  AGENT_FILE_READ: "agent.file-read",
  AGENT_FILE_UPDATE: "agent.file-update",
  AGENT_FILE_DELETE: "agent.file-delete",

  // skills
  SKILL_LIST: "skill.list",
  SKILL_UPLOAD: "skill.upload",
  SKILL_INSTALL: "skill.install",
  SKILL_DELETE: "skill.delete",

  // flows
  FLOW_LIST: "flow.list",
  FLOW_READ: "flow.read",
  FLOW_CREATE: "flow.create",
  FLOW_UPDATE: "flow.update",
  FLOW_DELETE: "flow.delete",
  FLOW_RUN: "flow.run",
  FLOW_RUNS_LIST: "flow.runs-list",
  FLOW_RUN_READ: "flow.run-read",
  FLOW_RUN_CANCEL: "flow.run-cancel",
  FLOW_SESSIONS_LIST: "flow.sessions-list",

  // tasks
  TASK_LIST: "task.list",
  TASK_COUNTS: "task.counts",
  TASK_READ: "task.read",
  TASK_CREATE: "task.create",
  TASK_UPDATE: "task.update",
  TASK_DELETE: "task.delete",
  TASK_STATUS: "task.status",
  TASK_REORDER: "task.reorder",
  TASK_COMMENT: "task.comment",
  TASK_TIMELINE_READ: "task.timeline-read",
  EPIC_LIST: "epic.list",
  EPIC_CHILDREN: "epic.children",

  // shared files
  SHARED_FILES_LIST: "shared-files.list",
  SHARED_FILE_READ: "shared-files.read",
  SHARED_FILE_UPDATE: "shared-files.update",
  SHARED_FILE_DELETE: "shared-files.delete",

  // workspace
  WORKSPACE_DOWNLOAD: "workspace.download",

  // memory
  MEMORY_AGENTS_LIST: "memory.agents-list",
  MEMORY_AGENT_FILES_LIST: "memory.agent-files-list",
  MEMORY_AGENT_FILE_READ: "memory.agent-file-read",
  MEMORY_SEARCH: "memory.search",

  // heartbeat
  HEARTBEAT_SCHEDULE_READ: "heartbeat.schedule-read",
  HEARTBEAT_HEATMAP_READ: "heartbeat.heatmap-read",
  HEARTBEAT_HISTORY_READ: "heartbeat.history-read",

  // events
  EVENT_LIST: "event.list",
  EVENT_STREAM: "event.stream",

  // runtime
  RUNTIME_STATUS: "runtime.status",
  RUNTIME_SESSIONS_LIST: "runtime.sessions-list",
  RUNTIME_SESSIONS_CLEAR: "runtime.sessions-clear",
  RUNTIME_SESSION_MESSAGES_READ: "runtime.session-messages-read",
  RUNTIME_SESSION_CONTEXT_READ: "runtime.session-context-read",
  RUNTIME_CHAT: "runtime.chat",
  RUNTIME_CHAT_ABORT: "runtime.chat-abort",
  RUNTIME_CHAT_STREAM: "runtime.chat-stream",
  RUNTIME_TOOLS_READ: "runtime.tools-read",
  RUNTIME_QUESTION_ANSWER: "runtime.question-answer",
} as const;
