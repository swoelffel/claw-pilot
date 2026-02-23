// src/lib/constants.ts

export const constants = {
  // Claw Pilot data directory
  DATA_DIR: ".claw-pilot",
  DB_FILE: "registry.db",
  CONFIG_FILE: "config.json",
  DASHBOARD_TOKEN_FILE: "dashboard-token",

  // OpenClaw defaults
  // OPENCLAW_HOME is only used as fallback when the env var is not set.
  // In practice, getOpenClawHome() uses os.homedir() unless OPENCLAW_HOME is overridden.
  OPENCLAW_HOME: "/opt/openclaw",
  OPENCLAW_STATE_PREFIX: ".openclaw-", // ~/.openclaw-<slug>/
  OPENCLAW_LEGACY_DIR: ".openclaw", // legacy single-instance directory
  OPENCLAW_USER: "openclaw",

  // Ports
  PORT_RANGE_START: 18789,
  PORT_RANGE_END: 18799,
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

  // Templates
  WORKSPACE_FILES: ["AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md", "MEMORY.md"],

  // OpenClaw install script URL (overridable via OPENCLAW_INSTALL_URL env var)
  OPENCLAW_INSTALL_URL: "https://openclaw.ai/install.sh",
} as const;
