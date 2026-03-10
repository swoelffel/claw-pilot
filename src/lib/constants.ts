// src/lib/constants.ts

export const constants = {
  // Claw Pilot data directory
  DATA_DIR: ".claw-pilot",
  DB_FILE: "registry.db",
  CONFIG_FILE: "config.json",
  DASHBOARD_TOKEN_FILE: "dashboard-token",

  // OpenClaw defaults
  OPENCLAW_STATE_PREFIX: ".openclaw-", // ~/.openclaw-<slug>/
  OPENCLAW_LEGACY_DIR: ".openclaw", // legacy single-instance directory
  OPENCLAW_USER: "openclaw",

  // Ports
  PORT_RANGE_START: 18789,
  PORT_RANGE_END: 18838,  // 50 ports — 10 instances at min step 5 (OpenClaw 2026.3.x reserves P, P+1, P+2, P+4)
  DASHBOARD_PORT: 19000,

  // Timeouts (ms)
  HEALTH_CHECK_TIMEOUT: 5_000,
  SYSTEMD_START_TIMEOUT: 15_000,
  GATEWAY_READY_TIMEOUT: 30_000,
  PAIRING_DETECT_TIMEOUT: 60_000,

  // Health check polling
  HEALTH_POLL_INTERVAL: 10_000,

  // File permissions
  DIR_MODE: 0o700,
  ENV_FILE_MODE: 0o600,
  CONFIG_FILE_MODE: 0o644,

  // ---------------------------------------------------------------------------
  // Workspace file lists — single source of truth for all code paths.
  // See docs/_work/claw-pilot/workspace-files-analysis.md for rationale.
  // ---------------------------------------------------------------------------

  /** All workspace files recognized by OpenClaw (discoverable + syncable). */
  DISCOVERABLE_FILES: [
    "AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md",
    "USER.md", "HEARTBEAT.md", "MEMORY.md", "BOOTSTRAP.md",
  ] as const,

  /** Subset of discoverable files that the dashboard UI is allowed to edit. */
  EDITABLE_FILES: [
    "AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md",
    "USER.md", "HEARTBEAT.md",
  ] as const,

  /** Files created from templates during provisioning/deployment (on disk). */
  TEMPLATE_FILES: [
    "AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md",
    "USER.md", "HEARTBEAT.md", "MEMORY.md",
  ] as const,

  /** Files included in .team.yaml exports and expected during import. */
  EXPORTABLE_FILES: [
    "AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md",
    "USER.md", "HEARTBEAT.md",
  ] as const,

  // Legacy alias — kept for backward compat, prefer the specific lists above.
  WORKSPACE_FILES: ["AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md", "MEMORY.md"],

  // OpenClaw install script URL (overridable via OPENCLAW_INSTALL_URL env var)
  OPENCLAW_INSTALL_URL: "https://openclaw.ai/install.sh",

  // PATH prefix for non-interactive SSH sessions on Linux servers
  OPENCLAW_PATH_PREFIX: "export PATH=~/.npm-global/bin:/usr/local/bin:/usr/bin:/bin",

  // OpenClaw log directory (JSONL logs written by the daemon)
  OPENCLAW_LOG_DIR: "/tmp/openclaw",

  // Self-update (claw-pilot)
  GITHUB_REPO: "swoelffel/claw-pilot",
  GITHUB_API_BASE: "https://api.github.com",
  SELF_UPDATE_CHECK_TIMEOUT: 5_000,    // fetch GitHub API (ms)
  SELF_UPDATE_TIMEOUT: 600_000,        // git + build timeout (ms) — 10 min
  SELF_UPDATE_RATE_LIMIT_MS: 300_000,  // rate limit POST /api/self/update
  SELF_UPDATE_POLL_INTERVAL: 60_000,   // polling UI (ms)

  // Auth & sessions
  SESSION_COOKIE_NAME: "__cp_sid",
  SESSION_TTL_MS: 24 * 60 * 60 * 1000,   // 24h
  SESSION_CLEANUP_INTERVAL_MS: 60 * 1000, // 1 min
  AUTH_RATE_LIMIT_MAX: 5,                  // 5 attempts per window
  AUTH_RATE_LIMIT_WINDOW_MS: 60 * 1000,   // 1 min window
  ADMIN_USERNAME: "admin",
} as const;
