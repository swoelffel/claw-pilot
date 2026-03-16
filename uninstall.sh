#!/bin/sh
# claw-pilot uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/swoelffel/claw-pilot/main/uninstall.sh | sh
# Note: pipe to sh disables interactive prompts — pass --yes to confirm automatically.
# Options:
#   --dry-run    Show what would be removed, do nothing
#   --yes        Remove everything without confirmation (required when piping to sh)
#   --keep-data  Remove claw-pilot binary/repo but keep ~/.claw-pilot/ and instance state dirs
set -e

# Ensure we have a valid working directory
cd "${HOME:-/tmp}" 2>/dev/null || true

# --- Constants ---
DATA_DIR="$HOME/.claw-pilot"
STATE_PREFIX_LEGACY="$HOME/.openclaw-"
STATE_PREFIX_RUNTIME="$HOME/.runtime-"
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
      echo "  --keep-data  Keep ~/.claw-pilot/ and instance state dirs (instance data)"
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

# Confirm action interactively (skipped if --yes or --dry-run).
# When stdin is not a TTY (e.g. curl | sh), prompts cannot be answered interactively.
# In that case, abort with a clear message asking the user to pass --yes.
confirm() {
  msg="$1"
  if [ "$DRY_RUN" -eq 1 ] || [ "$YES" -eq 1 ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    warn "Non-interactive shell detected (stdin is not a TTY)."
    warn "Re-run with --yes to skip confirmation prompts:"
    warn "  curl -fsSL https://raw.githubusercontent.com/swoelffel/claw-pilot/main/uninstall.sh | sh -s -- --yes"
    exit 1
  fi
  printf "%s [y/N] " "$msg"
  read -r answer
  case "$answer" in
    [Yy]*) return 0 ;;
    *)     return 1 ;;
  esac
}

# --- Step 1: Detect installation ---

# Resolve INSTALL_DIR from the claw-pilot binary (wrapper script or symlink) or fallback.
# Since install.sh >= v0.20 installs a wrapper script (not a symlink), we parse the
# wrapper content to extract the entry point path rather than relying on readlink.
resolve_install_dir() {
  CLAW_PILOT_BIN=$(command -v claw-pilot 2>/dev/null || true)
  if [ -n "$CLAW_PILOT_BIN" ]; then
    # Case 1: wrapper script — contains: exec "/path/to/node" "/opt/claw-pilot/dist/index.mjs"
    # Extract the entry point path from the exec line (second quoted argument).
    ENTRY=$(grep -m1 'exec ' "$CLAW_PILOT_BIN" 2>/dev/null \
      | sed 's/.*exec "[^"]*" "\([^"]*\)".*/\1/' || true)
    if [ -n "$ENTRY" ] && [ "$ENTRY" != "$CLAW_PILOT_BIN" ]; then
      CANDIDATE=$(dirname "$(dirname "$ENTRY")")
      if [ -f "$CANDIDATE/package.json" ]; then
        echo "$CANDIDATE"
        return 0
      fi
    fi
    # Case 2: legacy symlink — follow with readlink
    REAL_BIN=$(readlink "$CLAW_PILOT_BIN" 2>/dev/null || true)
    if [ -n "$REAL_BIN" ]; then
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

# List instance slugs by scanning ~/.runtime-<slug>/ and legacy ~/.openclaw-<slug>/
# Uses explicit glob expansion check to avoid iterating on unexpanded patterns
# (POSIX sh does not support nullglob).
list_instances() {
  _seen=""
  # Scan new state dirs (~/.runtime-<slug>/)
  for dir in "${STATE_PREFIX_RUNTIME}"*/; do
    # Skip if glob was not expanded (no matching dirs)
    [ -d "$dir" ] || continue
    slug=$(basename "$dir")
    slug=${slug#.runtime-}
    [ -n "$slug" ] && [ "$slug" != "*" ] && echo "$slug" && _seen="$_seen $slug"
  done
  # Scan legacy state dirs (~/.openclaw-<slug>/) — skip duplicates
  for dir in "${STATE_PREFIX_LEGACY}"*/; do
    [ -d "$dir" ] || continue
    slug=$(basename "$dir")
    slug=${slug#.openclaw-}
    [ -z "$slug" ] || [ "$slug" = "*" ] && continue
    case " $_seen " in *" $slug "*) continue ;; esac
    echo "$slug"
  done
}

INSTALL_DIR=$(resolve_install_dir)
INSTANCES=$(list_instances)
INSTANCE_COUNT=0
for _i in $INSTANCES; do INSTANCE_COUNT=$((INSTANCE_COUNT + 1)); done

# Detect binary path (wrapper script or symlink)
BINARY_PATH=$(command -v claw-pilot 2>/dev/null || true)

# --- Step 2: Summary ---

echo ""
printf "${CYAN}=== claw-pilot uninstaller ===${NC}\n"
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  warn "DRY-RUN mode — nothing will be removed"
  echo ""
fi

info "Installation directory : ${INSTALL_DIR}"
info "Binary                 : ${BINARY_PATH:-not found in PATH}"
info "Data directory         : ${DATA_DIR}"
info "Instances found        : ${INSTANCE_COUNT}"

if [ "$INSTANCE_COUNT" -gt 0 ]; then
  for slug in $INSTANCES; do
    if [ -d "${STATE_PREFIX_RUNTIME}${slug}" ]; then
      info "  - $slug  (~/.runtime-${slug}/)"
    else
      info "  - $slug  (~/.openclaw-${slug}/)  [legacy]"
    fi
  done
fi

if [ "$KEEP_DATA" -eq 1 ]; then
  warn "Instance data and claw-pilot data will be KEPT (--keep-data)"
fi

echo ""

# Check that there is something to uninstall
if [ ! -d "$INSTALL_DIR" ] && [ -z "$BINARY_PATH" ] && [ ! -d "$DATA_DIR" ] && [ "$INSTANCE_COUNT" -eq 0 ]; then
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

# Stop instance services
if [ "$INSTANCE_COUNT" -gt 0 ]; then
  log "Stopping instance services..."
  for slug in $INSTANCES; do
    if [ "$OS" = "Linux" ]; then
      stop_systemd_service "claw-runtime-${slug}.service"
    elif [ "$OS" = "Darwin" ]; then
      plist="$HOME/Library/LaunchAgents/ai.claw-runtime.${slug}.plist"
      stop_launchd_agent "ai.claw-runtime.${slug}" "$plist"
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
    safe_remove "${SYSTEMD_USER_DIR}/claw-runtime-${slug}.service"
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
    safe_remove "${LAUNCHD_DIR}/ai.claw-runtime.${slug}.plist"
  done
  safe_remove "${LAUNCHD_DIR}/io.claw-pilot.dashboard.plist"
fi

# --- Step 5: Remove instance data (unless --keep-data) ---

if [ "$KEEP_DATA" -eq 0 ] && [ "$INSTANCE_COUNT" -gt 0 ]; then
  echo ""
  if confirm "Remove all instance data (~/.runtime-*/ and legacy ~/.openclaw-*/)? This includes API keys and workspaces."; then
    log "Removing instance data..."
    warn "Note: API keys stored in .env files will be permanently deleted."
    for slug in $INSTANCES; do
      safe_remove "${STATE_PREFIX_RUNTIME}${slug}"
      safe_remove "${STATE_PREFIX_LEGACY}${slug}"
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

# --- Step 7: Remove binary (wrapper script or symlink) ---

echo ""
log "Removing claw-pilot binary..."

# is_our_binary <path> — returns 0 if the file at <path> belongs to our install dir.
# Handles both wrapper scripts (exec line contains INSTALL_DIR) and legacy symlinks.
is_our_binary() {
  _b="$1"
  [ -f "$_b" ] || [ -L "$_b" ] || return 1
  # Wrapper script: check exec line references INSTALL_DIR
  if grep -q "$INSTALL_DIR" "$_b" 2>/dev/null; then
    return 0
  fi
  # Legacy symlink: follow and check target path
  _t=$(readlink "$_b" 2>/dev/null || true)
  case "$_t" in
    "$INSTALL_DIR"*) return 0 ;;
  esac
  return 1
}

_removed_binary=0

# Primary: use the resolved BINARY_PATH
if [ -n "$BINARY_PATH" ]; then
  if is_our_binary "$BINARY_PATH"; then
    safe_remove "$BINARY_PATH"
    _removed_binary=1
  else
    warn "Binary at $BINARY_PATH does not belong to $INSTALL_DIR — skipping"
  fi
fi

# Fallback: scan common install locations (covers cases where binary is not in PATH)
if [ "$_removed_binary" -eq 0 ]; then
  _pnpm_bin=$(pnpm bin --global 2>/dev/null || true)
  for candidate in \
    "/usr/local/bin/claw-pilot" \
    "$HOME/.local/bin/claw-pilot" \
    "$HOME/bin/claw-pilot" \
    "${_pnpm_bin:+$_pnpm_bin/claw-pilot}"; do
    [ -n "$candidate" ] || continue
    if is_our_binary "$candidate"; then
      safe_remove "$candidate"
      _removed_binary=1
    fi
  done
fi

[ "$_removed_binary" -eq 0 ] && info "No binary found to remove."

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

# --- Step 8b: Clean up shell profile entries added by installer ---

# The installer appends PATH export lines to ~/.zshrc, ~/.bashrc, ~/.profile.
# Remove any block matching the installer comment marker (idempotent, best-effort).
_clean_shell_profile() {
  _rc="$1"
  [ -f "$_rc" ] || return 0
  if grep -q 'claw-pilot' "$_rc" 2>/dev/null; then
    if [ "$DRY_RUN" -eq 1 ]; then
      drylog "Remove claw-pilot PATH lines from $_rc"
      return 0
    fi
    # Remove the comment line + the export PATH line that follows it
    # Pattern: "# claw-pilot bin dir (added by claw-pilot installer)" + next line
    _tmp=$(mktemp)
    awk '
      /# claw-pilot bin dir \(added by claw-pilot installer\)/ { skip=2 }
      skip > 0 { skip--; next }
      { print }
    ' "$_rc" > "$_tmp" && mv "$_tmp" "$_rc" && log "Cleaned PATH entry from $_rc" || true
  fi
}

for _rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
  _clean_shell_profile "$_rc"
done

# --- Step 9: Done ---

echo ""
if [ "$DRY_RUN" -eq 1 ]; then
  log "Dry run complete. Run without --dry-run to actually remove."
else
  log "claw-pilot has been uninstalled."
  if [ "$KEEP_DATA" -eq 1 ]; then
    info "Instance data kept in ~/.runtime-*/ (and legacy ~/.openclaw-*/)"
    info "claw-pilot data kept in ~/.claw-pilot/"
  fi
fi
echo ""
