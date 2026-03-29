#!/usr/bin/env bash
# scripts/reset-instance.sh
# Reset all sessions, messages, and memory for a claw-pilot instance.
# Usage: bash scripts/reset-instance.sh <slug> [--remote <ssh-host>]
#
# Examples:
#   bash scripts/reset-instance.sh cpteam                      # local
#   bash scripts/reset-instance.sh cpteam --remote swoelffel@macmini.thiers  # remote via SSH

set -euo pipefail

# ── Args ─────────────────────────────────────────────────────────────────────
SLUG="${1:-}"
REMOTE=""

if [[ -z "$SLUG" ]]; then
  echo "Usage: $0 <instance-slug> [--remote <ssh-host>]"
  exit 1
fi

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote) REMOTE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Confirmation ─────────────────────────────────────────────────────────────
echo "⚠  This will permanently delete for instance '$SLUG':"
echo "   - All sessions (permanent + ephemeral)"
echo "   - All messages and message parts"
echo "   - All memory files (MEMORY.md + memory/ dirs + memory-index.db)"
echo ""
read -rp "Type 'reset' to confirm: " CONFIRM
if [[ "$CONFIRM" != "reset" ]]; then
  echo "Aborted."
  exit 0
fi

# ── Build the reset commands ─────────────────────────────────────────────────
RESET_COMMANDS=$(cat <<'SCRIPT'
SLUG="__SLUG__"
DB="$HOME/.claw-pilot/registry.db"
STATE_DIR="$HOME/.claw-pilot/instances/$SLUG"

if [[ ! -f "$DB" ]]; then
  echo "ERROR: Database not found at $DB"
  exit 1
fi

INSTANCE_ID=$(sqlite3 "$DB" "SELECT id FROM instances WHERE slug='$SLUG'")
if [[ -z "$INSTANCE_ID" ]]; then
  echo "ERROR: Instance '$SLUG' not found"
  exit 1
fi

echo "── Stopping dashboard ──"
launchctl stop io.claw-pilot.dashboard 2>/dev/null || true
sleep 2

echo "── Purging sessions + messages + parts ──"
sqlite3 "$DB" "
  DELETE FROM rt_parts WHERE message_id IN (
    SELECT id FROM rt_messages WHERE session_id IN (
      SELECT id FROM rt_sessions WHERE instance_slug='$SLUG'
    )
  );
  DELETE FROM rt_messages WHERE session_id IN (
    SELECT id FROM rt_sessions WHERE instance_slug='$SLUG'
  );
  DELETE FROM rt_sessions WHERE instance_slug='$SLUG';
"

SESSIONS_LEFT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM rt_sessions WHERE instance_slug='$SLUG'")
echo "   Sessions remaining: $SESSIONS_LEFT"

echo "── Purging MEMORY.md from DB ──"
sqlite3 "$DB" "
  DELETE FROM agent_files
  WHERE filename='MEMORY.md'
    AND agent_id IN (SELECT id FROM agents WHERE instance_id=$INSTANCE_ID);
"

echo "── Purging memory files on disk ──"
if [[ -d "$STATE_DIR/workspaces" ]]; then
  find "$STATE_DIR/workspaces" -name "memory" -type d -exec rm -rf {} + 2>/dev/null || true
  find "$STATE_DIR/workspaces" -name "MEMORY.md" -type f -delete 2>/dev/null || true
  find "$STATE_DIR/workspaces" -name "memory-index.db" -type f -delete 2>/dev/null || true
fi

echo "── Restarting dashboard ──"
launchctl start io.claw-pilot.dashboard 2>/dev/null || true
sleep 2

echo ""
echo "✓ Instance '$SLUG' reset complete."
sqlite3 "$DB" "
  SELECT 'Sessions: ' || COUNT(*) FROM rt_sessions WHERE instance_slug='$SLUG';
  SELECT 'Messages: ' || COUNT(*) FROM rt_messages WHERE session_id IN (SELECT id FROM rt_sessions WHERE instance_slug='$SLUG');
  SELECT 'Memory files: ' || COUNT(*) FROM agent_files WHERE filename='MEMORY.md' AND agent_id IN (SELECT id FROM agents WHERE instance_id=$INSTANCE_ID);
"
SCRIPT
)

# Inject the slug
RESET_COMMANDS="${RESET_COMMANDS//__SLUG__/$SLUG}"

# ── Execute ──────────────────────────────────────────────────────────────────
if [[ -n "$REMOTE" ]]; then
  echo ""
  echo "Executing on $REMOTE ..."
  ssh "$REMOTE" "export PATH=\"\$HOME/.nvm/versions/node/v24.14.0/bin:\$PATH\"; $RESET_COMMANDS"
else
  echo ""
  echo "Executing locally ..."
  eval "$RESET_COMMANDS"
fi
