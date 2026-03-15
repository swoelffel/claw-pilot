#!/bin/bash
set -e

# Rebuild native addons for Linux if they were compiled for macOS (invalid ELF header)
# This happens when node_modules is volume-mounted from a macOS host
SQLITE_NODE="/app/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if [ -f "$SQLITE_NODE" ]; then
  if ! file "$SQLITE_NODE" 2>/dev/null | grep -q "ELF"; then
    echo "[entrypoint] Rebuilding native addons for Linux..."
    cd /app && pnpm rebuild better-sqlite3
  fi
fi

# Build CLI if dist/ is empty (first start — volume mount shadows image dist/)
# or if explicitly requested
if [ ! -f /app/dist/index.mjs ] || [ "${CLAW_PILOT_DEV_REBUILD:-false}" = "true" ]; then
  echo "[entrypoint] Building CLI..."
  cd /app && pnpm build:cli
fi

# XDG_RUNTIME_DIR required on Linux for systemd-aware code paths
export XDG_RUNTIME_DIR="/run/user/$(id -u)"

# Initialize claw-pilot DB (idempotent — runs migrations, seeds default config)
echo "[entrypoint] Initializing claw-pilot..."
node /app/dist/index.mjs init --yes 2>/dev/null || true

# Create admin account if it doesn't exist yet
# The generated password is printed to stdout — check logs on first start
if ! node /app/dist/index.mjs auth check 2>/dev/null; then
  echo "[entrypoint] Creating admin account (password shown below)..."
  node /app/dist/index.mjs auth setup
fi

exec supervisord -c /app/docker/supervisord.conf
