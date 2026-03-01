#!/bin/sh
# claw-pilot uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/swoelffel/claw-pilot/main/uninstall.sh | sh
# Options:
#   --dry-run    Show what would be removed, do nothing
#   --yes        Remove everything without confirmation
#   --keep-data  Remove claw-pilot binary/repo but keep ~/.claw-pilot/ and ~/.openclaw-*/
set -e

# Ensure we have a valid working directory
cd "${HOME:-/tmp}" 2>/dev/null || true

# --- Constants ---
DATA_DIR="$HOME/.claw-pilot"
STATE_PREFIX="$HOME/.openclaw-"
DEFAULT_INSTALL_DIR="/opt/claw-pilot"

# --- Parse args ---
DRY_RUN=0
YES=0
KEEP_DATA=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --yes)       YES=1 ;;
    --keep-data) KEEP_DATA=1 ;;
    --help|-h)
      echo "Usage: uninstall.sh [--dry-run] [--yes] [--keep-data]"
      echo ""
      echo "  --dry-run    Show what would be removed, do nothing"
      echo "  --yes        Remove everything without confirmation"
      echo "  --keep-data  Keep ~/.claw-pilot/ and ~/.openclaw-*/ (instance data)"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()    { printf "${GREEN}[+]${NC} %s\n" "$1"; }
warn()   { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
error()  { printf "${RED}[x]${NC} %s\n" "$1" >&2; exit 1; }
info()   { printf "${CYAN}[-]${NC} %s\n" "$1"; }
drylog() { printf "${YELLOW}[DRY-RUN]${NC} Would remove: %s\n" "$1"; }

# --- Helpers ---

# Remove a file or directory, with optional sudo fallback
safe_remove() {
  target="$1"
  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    drylog "$target"
    return 0
  fi
  if rm -rf "$target" 2>/dev/null; then
    log "Removed: $target"
  elif command -v sudo >/dev/null 2>&1; then
    warn "Retrying with sudo: $target"
    sudo rm -rf "$target" && log "Removed (sudo): $target" || warn "Could not remove: $target"
  else
    warn "Could not remove (permission denied): $target"
  fi
}

# Stop + disable a systemd user service (best-effort)
stop_systemd_service() {
  svc="$1"
  if ! command -v systemctl >/dev/null 2>&1; then return 0; fi
  if [ "$DRY_RUN" -eq 1 ]; then
    drylog "systemctl --user stop $svc"
    return 0
  fi
  XDG_RUNTIME_DIR="/run/user/$(id -u)"
  export XDG_RUNTIME_DIR
  systemctl --user stop "$svc" 2>/dev/null && log "Stopped service: $svc" || true
  systemctl --user disable "$svc" 2>/dev/null || true
}

# Stop + unload a launchd agent (best-effort)
stop_launchd_agent() {
  label="$1"
  plist="$2"
  if ! command -v launchctl >/dev/null 2>&1; then return 0; fi
  if [ "$DRY_RUN" -eq 1 ]; then
    drylog "launchctl unload $plist"
    return 0
  fi
  launchctl unload "$plist" 2>/dev/null && log "Unloaded agent: $label" || true
}

# Confirm action interactively (skipped if --yes or --dry-run)
confirm() {
  msg="$1"
  if [ "$DRY_RUN" -eq 1 ] || [ "$YES" -eq 1 ]; then
    return 0
  fi
  printf "%s [y/N] " "$msg"
  read -r answer
  case "$answer" in
    [Yy]*) return 0 ;;
    *)     return 1 ;;
  esac
}

# --- Step 1: Detect installation ---

# Resolve INSTALL_DIR from the claw-pilot symlink or fallback
resolve_install_dir() {
  # Try to find the symlink
  CLAW_PILOT_BIN=$(command -v claw-pilot 2>/dev/null || true)
  if [ -n "$CLAW_PILOT_BIN" ]; then
    # Follow the symlink to the actual file
    REAL_BIN=$(readlink "$CLAW_PILOT_BIN" 2>/dev/null || echo "")
    if [ -n "$REAL_BIN" ]; then
      # REAL_BIN is something like /opt/claw-pilot/dist/index.mjs
      # Go up two levels: dist/ -> repo root
      CANDIDATE=$(dirname "$(dirname "$REAL_BIN")")
      if [ -f "$CANDIDATE/package.json" ]; then
        echo "$CANDIDATE"
        return 0
      fi
    fi
  fi
  # Fallback: env var or default
  echo "${CLAW_PILOT_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
}

# List instance slugs by scanning ~/.openclaw-*/openclaw.json
list_instances() {
  for dir in "${STATE_PREFIX}"*/; do
    [ -d "$dir" ] || continue
    slug=$(basename "$dir" | sed "s/^\.openclaw-//")
    [ -n "$slug" ] && echo "$slug"
  done
}

INSTALL_DIR=$(resolve_install_dir)
INSTANCES=$(list_instances)
INSTANCE_COUNT=0
for _i in $INSTANCES; do INSTANCE_COUNT=$((INSTANCE_COUNT + 1)); done

# Detect symlink path
SYMLINK_PATH=$(command -v claw-pilot 2>/dev/null || true)

# --- Step 2: Summary ---

echo ""
printf "${CYAN}=== claw-pilot uninstaller ===${NC}\n"
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  warn "DRY-RUN mode — nothing will be removed"
  echo ""
fi

info "Installation directory : ${INSTALL_DIR}"
info "Binary symlink         : ${SYMLINK_PATH:-not found in PATH}"
info "Data directory         : ${DATA_DIR}"
info "Instances found        : ${INSTANCE_COUNT}"

if [ "$INSTANCE_COUNT" -gt 0 ]; then
  for slug in $INSTANCES; do
    info "  - $slug  (~/.openclaw-${slug}/)"
  done
fi

if [ "$KEEP_DATA" -eq 1 ]; then
  warn "Instance data and claw-pilot data will be KEPT (--keep-data)"
fi

echo ""

# Check that there is something to uninstall
if [ ! -d "$INSTALL_DIR" ] && [ -z "$SYMLINK_PATH" ] && [ ! -d "$DATA_DIR" ] && [ "$INSTANCE_COUNT" -eq 0 ]; then
  warn "claw-pilot does not appear to be installed. Nothing to remove."
  exit 0
fi

if ! confirm "Proceed with uninstallation?"; then
  info "Aborted."
  exit 0
fi

echo ""

# --- Step 3: Stop all services ---

OS=$(uname -s)

# Stop OpenClaw instance services
if [ "$INSTANCE_COUNT" -gt 0 ]; then
  log "Stopping OpenClaw instance services..."
  for slug in $INSTANCES; do
    if [ "$OS" = "Linux" ]; then
      stop_systemd_service "openclaw-${slug}.service"
    elif [ "$OS" = "Darwin" ]; then
      plist="$HOME/Library/LaunchAgents/ai.openclaw.${slug}.plist"
      stop_launchd_agent "ai.openclaw.${slug}" "$plist"
    fi
  done
fi

# Stop dashboard service
log "Stopping claw-pilot dashboard service..."
if [ "$OS" = "Linux" ]; then
  stop_systemd_service "claw-pilot-dashboard.service"
elif [ "$OS" = "Darwin" ]; then
  plist="$HOME/Library/LaunchAgents/io.claw-pilot.dashboard.plist"
  stop_launchd_agent "io.claw-pilot.dashboard" "$plist"
fi

# Reload systemd after stopping services
if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1 && [ "$DRY_RUN" -eq 0 ]; then
  XDG_RUNTIME_DIR="/run/user/$(id -u)"
  export XDG_RUNTIME_DIR
  systemctl --user daemon-reload 2>/dev/null || true
fi

# --- Step 4: Remove service files ---

log "Removing service files..."

if [ "$OS" = "Linux" ]; then
  SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
  # Remove instance service files
  for slug in $INSTANCES; do
    safe_remove "${SYSTEMD_USER_DIR}/openclaw-${slug}.service"
  done
  # Remove dashboard service file
  safe_remove "${SYSTEMD_USER_DIR}/claw-pilot-dashboard.service"
  # Final daemon-reload
  if command -v systemctl >/dev/null 2>&1 && [ "$DRY_RUN" -eq 0 ]; then
    XDG_RUNTIME_DIR="/run/user/$(id -u)"
    export XDG_RUNTIME_DIR
    systemctl --user daemon-reload 2>/dev/null || true
  fi
elif [ "$OS" = "Darwin" ]; then
  LAUNCHD_DIR="$HOME/Library/LaunchAgents"
  for slug in $INSTANCES; do
    safe_remove "${LAUNCHD_DIR}/ai.openclaw.${slug}.plist"
  done
  safe_remove "${LAUNCHD_DIR}/io.claw-pilot.dashboard.plist"
fi

# --- Step 5: Remove instance data (unless --keep-data) ---

if [ "$KEEP_DATA" -eq 0 ] && [ "$INSTANCE_COUNT" -gt 0 ]; then
  echo ""
  if confirm "Remove all instance data (~/.openclaw-*/)? This includes API keys and workspaces."; then
    log "Removing instance data..."
    warn "Note: API keys stored in .env files will be permanently deleted."
    for slug in $INSTANCES; do
      safe_remove "${STATE_PREFIX}${slug}"
    done
  else
    info "Instance data kept."
  fi
fi

# --- Step 6: Remove claw-pilot data (unless --keep-data) ---

if [ "$KEEP_DATA" -eq 0 ] && [ -d "$DATA_DIR" ]; then
  echo ""
  if confirm "Remove claw-pilot data (~/.claw-pilot/)? This includes the registry database and dashboard token."; then
    log "Removing claw-pilot data..."
    safe_remove "$DATA_DIR"
  else
    info "claw-pilot data kept."
  fi
fi

# --- Step 7: Remove binary symlink ---

echo ""
log "Removing binary symlink..."

if [ -n "$SYMLINK_PATH" ] && [ -L "$SYMLINK_PATH" ]; then
  # Verify the symlink points to our install dir before removing
  LINK_TARGET=$(readlink "$SYMLINK_PATH" 2>/dev/null || echo "")
  case "$LINK_TARGET" in
    "$INSTALL_DIR"*)
      safe_remove "$SYMLINK_PATH"
      ;;
    *)
      warn "Symlink at $SYMLINK_PATH points to $LINK_TARGET (not $INSTALL_DIR) — skipping"
      ;;
  esac
else
  # Try common locations
  for candidate in \
    "$(pnpm bin --global 2>/dev/null || true)/claw-pilot" \
    "/usr/local/bin/claw-pilot" \
    "$HOME/.local/bin/claw-pilot"; do
    if [ -L "$candidate" ]; then
      LINK_TARGET=$(readlink "$candidate" 2>/dev/null || echo "")
      case "$LINK_TARGET" in
        "$INSTALL_DIR"*)
          safe_remove "$candidate"
          ;;
      esac
    fi
  done
fi

# --- Step 8: Remove installation directory ---

echo ""
if [ -d "$INSTALL_DIR" ]; then
  if confirm "Remove installation directory ($INSTALL_DIR)?"; then
    log "Removing installation directory..."
    safe_remove "$INSTALL_DIR"
  else
    info "Installation directory kept at $INSTALL_DIR"
  fi
else
  info "Installation directory not found at $INSTALL_DIR — skipping"
fi

# --- Step 9: Done ---

echo ""
if [ "$DRY_RUN" -eq 1 ]; then
  log "Dry run complete. Run without --dry-run to actually remove."
else
  log "claw-pilot has been uninstalled."
  if [ "$KEEP_DATA" -eq 1 ]; then
    info "Instance data kept in ~/.openclaw-*/"
    info "claw-pilot data kept in ~/.claw-pilot/"
  fi
  echo ""
  warn "OpenClaw was not removed."
  warn "To uninstall OpenClaw: npm uninstall -g openclaw"
fi
echo ""
