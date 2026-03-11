#!/bin/sh
# Claw Pilot installer
# Usage: curl -fsSL https://raw.githubusercontent.com/swoelffel/claw-pilot/main/install.sh | sh
set -e

# Ensure we have a valid working directory (cwd may have been deleted)
cd "${HOME:-/tmp}" 2>/dev/null || true

# Save original PATH before any modifications — used later to detect if the
# user's login shell will find the installed binaries without extra config.
ORIGINAL_PATH="${PATH:-}"

REPO="swoelffel/claw-pilot"
REPO_URL="https://github.com/${REPO}.git"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"
MIN_NODE_VERSION=22
INSTALL_DIR="${CLAW_PILOT_INSTALL_DIR:-/opt/claw-pilot}"
OPENCLAW_INSTALL_URL="${OPENCLAW_INSTALL_URL:-https://openclaw.ai/install.sh}"
OPENCLAW_INSTALL_TIMEOUT=600

# Resolve version from package.json on GitHub
CLAW_PILOT_VERSION=$(curl -fsSL "${RAW_BASE}/package.json" 2>/dev/null \
  | grep '"version"' | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/') \
  || CLAW_PILOT_VERSION="unknown"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { printf "${GREEN}[+]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
error() { printf "${RED}[x]${NC} %s\n" "$1"; exit 1; }

# ── Tmpfile management ────────────────────────────────────────────────────────
# All temp files are tracked and cleaned up on exit (even on error).
_TMPFILES=""
_cleanup_tmpfiles() {
  for _f in $_TMPFILES; do
    rm -rf "$_f" 2>/dev/null || true
  done
}
trap _cleanup_tmpfiles EXIT

mktempfile() {
  _t=$(mktemp)
  _TMPFILES="$_TMPFILES $_t"
  printf '%s' "$_t"
}

# ── PATH helpers ──────────────────────────────────────────────────────────────

# Prepend a directory to PATH, deduplicating any existing occurrence.
# Inspired by OpenClaw installer — avoids PATH bloat on re-runs.
# Uses sed for pattern substitution (POSIX sh compatible — works on dash/macOS sh).
prepend_path_dir() {
  # Strip newlines from input — a path with a newline would break the sed below.
  _dir=$(printf '%s' "${1:-}" | tr -d '\n')
  _dir="${_dir%/}"
  [ -z "$_dir" ] && return 0
  # Strip existing occurrence(s) of _dir from PATH using sed (POSIX, no ${//})
  _cur=$(printf '%s' ":${PATH:-}:" | sed "s|:${_dir}:|:|g")
  _cur="${_cur#:}"
  _cur="${_cur%:}"
  if [ -n "$_cur" ]; then
    export PATH="${_dir}:${_cur}"
  else
    export PATH="${_dir}"
  fi
  hash -r 2>/dev/null || true
}

# Warn the user if a directory is not present in their *original* login PATH,
# so they know to add it to their shell profile.
warn_path_missing() {
  _check_dir="$1"
  _label="$2"
  case ":${ORIGINAL_PATH}:" in
    *":${_check_dir}:"*) return 0 ;;  # already in original PATH — no warning needed
  esac
  warn "${_label} is not in your shell PATH."
  warn "Add this line to your shell profile (~/.bashrc, ~/.zshrc, etc.) and restart your session:"
  warn "  export PATH=\"${_check_dir}:\$PATH\""
}

# ── Quiet step runner ─────────────────────────────────────────────────────────
# Runs a command silently. On failure, dumps the last 40 lines of the log
# and calls error() to abort — compatible with set -e.
# Usage: run_quiet_step "Description" cmd arg1 arg2 ...
run_quiet_step() {
  _title="$1"; shift
  _log=$(mktempfile)
  log "$_title..."
  if "$@" >"$_log" 2>&1; then
    return 0
  fi
  warn "$_title failed — last output:"
  tail -n 40 "$_log" >&2 || true
  error "$_title failed. Fix the error above and re-run the installer."
}

# ── Package manager helpers ───────────────────────────────────────────────────

# Run apt-get or dnf with sudo if needed
_apt() { command -v sudo >/dev/null 2>&1 && sudo apt-get "$@" || apt-get "$@"; }
_dnf() { command -v sudo >/dev/null 2>&1 && sudo dnf "$@" || dnf "$@"; }

# Install a system package via the available package manager (Linux only)
install_pkg() {
  _pkg_apt="$1"
  _pkg_dnf="${2:-$1}"
  if command -v apt-get >/dev/null 2>&1; then
    _apt install -y "$_pkg_apt"
  elif command -v dnf >/dev/null 2>&1; then
    _dnf install -y "$_pkg_dnf"
  else
    return 1
  fi
}

# ── npm permissions fix ───────────────────────────────────────────────────────
# If npm's global prefix is not writable by the current user (common when Node
# is installed system-wide on Linux), reconfigure npm to use a user-local prefix
# so that `npm install -g` never needs sudo.
# On macOS, npm is installed via Homebrew and the prefix is already user-writable
# (/opt/homebrew or /usr/local) — no reconfiguration needed.
fix_npm_permissions() {
  # macOS: Homebrew prefix is always user-writable — nothing to do
  if [ "$OS" = "Darwin" ]; then
    return 0
  fi
  _npm_prefix=$(npm config get prefix 2>/dev/null || true)
  # Only act if prefix is set and not writable
  if [ -z "$_npm_prefix" ] || [ -w "$_npm_prefix" ]; then
    return 0
  fi
  warn "npm global prefix '$_npm_prefix' is not writable by current user."
  warn "Reconfiguring npm to use user-local prefix (~/.npm-global)..."
  mkdir -p "$HOME/.npm-global"
  npm config set prefix "$HOME/.npm-global"
  prepend_path_dir "$HOME/.npm-global/bin"
  # Persist in shell profiles (idempotent)
  for _rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    [ -f "$_rc" ] || continue
    grep -q '\.npm-global' "$_rc" 2>/dev/null && continue
    printf '\n# npm user-local global bin (added by claw-pilot installer)\nexport PATH="$HOME/.npm-global/bin:$PATH"\n' >> "$_rc"
  done
  log "npm prefix reconfigured to ~/.npm-global"
}

# ── OpenClaw binary helpers ───────────────────────────────────────────────────

# Validate that an openclaw binary is actually functional (not a broken symlink)
openclaw_is_valid() {
  _bin="$1"
  [ -f "$_bin" ] || return 1
  "$_bin" --version >/dev/null 2>&1 || return 1
  return 0
}

# ── Node.js binary resolver ───────────────────────────────────────────────────
# Resolve the absolute path of node (handles nvm, volta, fnm, etc.)
resolve_node_bin() {
  NODE_BIN=$(command -v node 2>/dev/null)
  if [ -z "$NODE_BIN" ]; then
    for _candidate in \
      "$HOME/.nvm/versions/node/"*/bin/node \
      "$HOME/.volta/bin/node" \
      "$HOME/.fnm/node-versions/"*/installation/bin/node \
      /usr/local/bin/node \
      /usr/bin/node; do
      [ -f "$_candidate" ] && NODE_BIN="$_candidate" && break
    done
  fi
  printf '%s' "$NODE_BIN"
}

# ── 1. Banner ─────────────────────────────────────────────────────────────────
log "Installing claw-pilot v${CLAW_PILOT_VERSION} from ${REPO_URL}"
echo ""

# ── 2. sudo check ─────────────────────────────────────────────────────────────
if [ "$(id -u)" != "0" ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    error "sudo is not installed. Run this script as root or install sudo first."
  fi
  if ! sudo -n true 2>/dev/null && ! sudo -v 2>/dev/null; then
    error "This script requires sudo privileges. Run as a sudoer or as root."
  fi
  log "sudo privileges confirmed."
fi

# ── 3. OS detection ───────────────────────────────────────────────────────────
OS=$(uname -s)
case "$OS" in
  Linux)  log "Detected Linux" ;;
  Darwin) log "Detected macOS (dev mode — systemd not available)" ;;
  *)      error "Unsupported OS: $OS" ;;
esac

# ── 4. Node.js check ──────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  error "Node.js not found. Install Node.js >= $MIN_NODE_VERSION first: https://nodejs.org"
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
  error "Node.js >= $MIN_NODE_VERSION required (found $(node -v))"
fi
log "Node.js $(node -v)"

# ── 5. git check ──────────────────────────────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
  if [ "$OS" = "Linux" ]; then
    log "git not found — installing via package manager..."
    if ! install_pkg git; then
      error "git not found and no supported package manager available. Install git manually."
    fi
    command -v git >/dev/null 2>&1 || error "git still not found after install. Aborting."
    log "git $(git --version)"
  else
    error "git not found. Install git first (e.g. xcode-select --install on macOS)."
  fi
else
  log "git $(git --version)"
fi

# ── 6. pnpm check & install ───────────────────────────────────────────────────
# Reload PATH with all known pnpm user-local bin directories (deduplicating).
_reload_pnpm_path() {
  # pnpm setup writes to ~/.local/share/pnpm on Linux, ~/Library/pnpm on macOS
  prepend_path_dir "$HOME/.local/share/pnpm"
  prepend_path_dir "$HOME/Library/pnpm"
  prepend_path_dir "$HOME/.pnpm/bin"
  prepend_path_dir "$HOME/.local/bin"
  # npm user-local prefix (set by fix_npm_permissions on Linux)
  prepend_path_dir "$HOME/.npm-global/bin"
  # Also pick up whatever npm reports as its current global bin dir.
  # "npm bin -g" is deprecated — fall back to "npm prefix -g".
  # Strip trailing newline from prefix before appending /bin to avoid a
  # multi-line path that would break the sed in prepend_path_dir.
  _npm_global_bin=$(npm bin -g 2>/dev/null || { _pfx=$(npm prefix -g 2>/dev/null | tr -d '\n'); [ -n "$_pfx" ] && printf '%s/bin' "$_pfx"; } || true)
  [ -n "$_npm_global_bin" ] && prepend_path_dir "$_npm_global_bin"
  # Also pick up whatever pnpm reports as its global bin (if pnpm is now in PATH)
  if command -v pnpm >/dev/null 2>&1; then
    _pnpm_global_bin=$(pnpm bin --global 2>/dev/null || true)
    [ -n "$_pnpm_global_bin" ] && prepend_path_dir "$_pnpm_global_bin"
  fi
}

if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found — trying to install automatically..."

  PNPM_INSTALLED=0

  # Method 1: corepack — user-local install dir to avoid EACCES on /usr/bin.
  # Plain "corepack enable" tries to symlink into the system bin dir (root-only).
  # "--install-directory ~/.local/bin" keeps everything user-local.
  if [ "$PNPM_INSTALLED" -eq 0 ] && command -v corepack >/dev/null 2>&1; then
    log "Trying corepack enable pnpm (user-local)..."
    mkdir -p "$HOME/.local/bin"
    if corepack enable --install-directory "$HOME/.local/bin" pnpm 2>/dev/null; then
      prepend_path_dir "$HOME/.local/bin"
      _reload_pnpm_path
      command -v pnpm >/dev/null 2>&1 && PNPM_INSTALLED=1
    fi
  fi

  # Method 2: official pnpm install script (user-local, no sudo needed).
  # The script requires $SHELL to be set to a supported shell (bash or zsh).
  # In non-interactive "curl | sh" sessions $SHELL is often unset — detect a
  # usable shell explicitly rather than passing "sh" which pnpm does not support.
  if [ "$PNPM_INSTALLED" -eq 0 ]; then
    log "Trying official pnpm install script (user-local)..."
    _pnpm_shell=""
    for _sh_candidate in bash zsh; do
      command -v "$_sh_candidate" >/dev/null 2>&1 && _pnpm_shell=$(command -v "$_sh_candidate") && break
    done
    if [ -n "$_pnpm_shell" ]; then
      if curl -fsSL https://get.pnpm.io/install.sh | SHELL="$_pnpm_shell" "$_pnpm_shell" 2>/dev/null; then
        _reload_pnpm_path
        command -v pnpm >/dev/null 2>&1 && PNPM_INSTALLED=1
      fi
    else
      warn "bash/zsh not found — skipping get.pnpm.io script (requires bash or zsh)"
    fi
  fi

  # Method 3: npm install -g pnpm — fix permissions first so no EACCES.
  # fix_npm_permissions() reconfigures npm prefix to ~/.npm-global on Linux,
  # then prepend_path_dir ensures ~/.npm-global/bin is in PATH immediately.
  if [ "$PNPM_INSTALLED" -eq 0 ]; then
    log "Trying npm install -g pnpm (fixing permissions if needed)..."
    fix_npm_permissions
    if npm install -g pnpm 2>/dev/null; then
      # ~/.npm-global/bin is already prepended by fix_npm_permissions —
      # call _reload_pnpm_path anyway to also pick up pnpm's own global bin.
      _reload_pnpm_path
      command -v pnpm >/dev/null 2>&1 && PNPM_INSTALLED=1
    fi
  fi

  if [ "$PNPM_INSTALLED" -eq 0 ]; then
    error "Cannot install pnpm automatically. Install it manually then re-run this script:
  Option A (recommended): corepack enable pnpm
  Option B (user-local):   curl -fsSL https://get.pnpm.io/install.sh | sh
  Option C (system-wide):  sudo npm install -g pnpm"
  fi
fi

# Ensure pnpm global bin dir is in PATH (handles fresh installs in the same session)
if ! pnpm bin --global >/dev/null 2>&1; then
  warn "pnpm global bin dir not configured, running 'pnpm setup'..."
  pnpm setup 2>/dev/null || true
fi
_reload_pnpm_path

# Final check
if ! command -v pnpm >/dev/null 2>&1; then
  error "pnpm installed but not found in PATH. Open a new shell and re-run this script."
fi
log "pnpm $(pnpm --version)"

# Warn if pnpm's bin dir is absent from the user's original login PATH
_pnpm_bin_dir=$(pnpm bin --global 2>/dev/null || true)
[ -n "$_pnpm_bin_dir" ] && warn_path_missing "$_pnpm_bin_dir" "pnpm global bin dir ($_pnpm_bin_dir)"

# ── 7. Build tools check ──────────────────────────────────────────────────────
# Done early so we fail fast before cloning / compiling anything.
BUILD_TOOLS_OK=1
for _tool in cc make python3; do
  if ! command -v "$_tool" >/dev/null 2>&1; then
    warn "Build tool '$_tool' not found."
    BUILD_TOOLS_OK=0
  fi
done
if [ "$BUILD_TOOLS_OK" -eq 0 ]; then
  if [ "$OS" = "Darwin" ]; then
    error "Missing build tools. Install them with: xcode-select --install"
  elif command -v apt-get >/dev/null 2>&1 || command -v dnf >/dev/null 2>&1; then
    log "Installing missing build tools (build-essential / python3)..."
    install_pkg build-essential "gcc make" || true
    install_pkg python3
    for _tool in cc make python3; do
      command -v "$_tool" >/dev/null 2>&1 || error "Build tool '$_tool' still not found after install. Aborting."
    done
    log "Build tools ready."
  else
    error "Missing build tools and no supported package manager found. Install manually: gcc make python3"
  fi
fi

# ── 8. OpenClaw check & install ───────────────────────────────────────────────
# Install before building claw-pilot so 'claw-pilot init' works immediately.
OPENCLAW_BIN=""
_find_openclaw() {
  # Build candidate list (one path per line) — include nvm/volta/fnm node bin dirs.
  # Using a newline-delimited string + "while IFS= read" is POSIX-safe and handles
  # paths with spaces correctly (unlike "for p in $var" which splits on spaces too).
  _oc_candidates="$(command -v openclaw 2>/dev/null)
$HOME/.npm-global/bin/openclaw
/opt/openclaw/.npm-global/bin/openclaw
/opt/homebrew/bin/openclaw
/usr/local/bin/openclaw"

  for _nvm_bin in "$HOME/.nvm/versions/node/"*/bin; do
    [ -d "$_nvm_bin" ] && _oc_candidates="$_oc_candidates
$_nvm_bin/openclaw"
  done
  [ -d "$HOME/.volta/bin" ] && _oc_candidates="$_oc_candidates
$HOME/.volta/bin/openclaw"

  printf '%s\n' "$_oc_candidates" | while IFS= read -r _p; do
    [ -z "$_p" ] && continue
    if openclaw_is_valid "$_p"; then
      OPENCLAW_BIN="$_p"
      return 0
    fi
  done
  # Note: the while runs in a subshell — re-check after the pipe
  # by re-scanning with command -v as a fast path.
  if command -v openclaw >/dev/null 2>&1; then
    OPENCLAW_BIN=$(command -v openclaw)
    return 0
  fi
  return 1
}

if _find_openclaw; then
  log "OpenClaw $($OPENCLAW_BIN --version 2>/dev/null) found at $OPENCLAW_BIN"
else
  warn "OpenClaw not found — installing now..."

  if [ "$OS" = "Linux" ]; then
    TOTAL_MEM_KiB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
    SWAP_KiB=$(grep SwapTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
    TOTAL_MEM_MiB=$((TOTAL_MEM_KiB / 1024))
    if [ "$TOTAL_MEM_MiB" -lt 1536 ] && [ "$SWAP_KiB" -eq 0 ]; then
      warn "Low memory detected (${TOTAL_MEM_MiB} MiB RAM, no swap)."
      warn "OpenClaw installation compiles native modules (libopus) from source."
      warn "This may fail due to OOM. Consider adding a swapfile first:"
      warn "  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile"
      warn "  sudo mkswap /swapfile && sudo swapon /swapfile"
      warn "Continuing anyway..."
    fi

    ARCH=$(uname -m)
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
      log "ARM64 detected — OpenClaw will compile native modules from source."
      log "This may take several minutes (libopus, ~5 min on 1 vCPU). Please wait..."
    fi
  fi

  OPENCLAW_INSTALLED=0
  if command -v timeout >/dev/null 2>&1; then
    if timeout "$OPENCLAW_INSTALL_TIMEOUT" sh -c \
        "curl -fsSL --proto '=https' --tlsv1.2 '$OPENCLAW_INSTALL_URL' | bash"; then
      OPENCLAW_INSTALLED=1
    fi
  else
    if sh -c "curl -fsSL --proto '=https' --tlsv1.2 '$OPENCLAW_INSTALL_URL' | bash"; then
      OPENCLAW_INSTALLED=1
    fi
  fi

  if [ "$OPENCLAW_INSTALLED" -eq 1 ] && _find_openclaw; then
    log "OpenClaw $($OPENCLAW_BIN --version 2>/dev/null) installed successfully."
  else
    warn "OpenClaw installation failed or binary not functional after install."
    warn "You can install it manually and re-run this script:"
    warn "  curl -fsSL $OPENCLAW_INSTALL_URL | bash"
    warn "Continuing claw-pilot installation — you will need OpenClaw to create instances."
  fi
fi

# ── 9. Clone or update the repository ────────────────────────────────────────
log "Installing claw-pilot from ${REPO_URL}..."
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing installation at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only

  run_quiet_step "Installing dependencies" sh -c "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"
  run_quiet_step "Building CLI" sh -c "cd '$INSTALL_DIR' && pnpm run build:cli"
  run_quiet_step "Building UI" sh -c "cd '$INSTALL_DIR' && pnpm run build:ui"

  log "claw-pilot $(node "$INSTALL_DIR/dist/index.mjs" --version 2>/dev/null) updated successfully!"

  # Manage dashboard service (Linux only)
  if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
    # Use two separate variables to avoid word-splitting issues with "node path/to/file"
    CP_NODE="node"
    CP_ENTRY="$INSTALL_DIR/dist/index.mjs"
    if command -v claw-pilot >/dev/null 2>&1; then
      CP_NODE="claw-pilot"
      CP_ENTRY=""
    fi
    if XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user is-active claw-pilot-dashboard.service >/dev/null 2>&1; then
      log "Restarting dashboard service to load updated code..."
      XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user restart claw-pilot-dashboard.service
      log "Dashboard service restarted."
    else
      SERVICE_FILE="$HOME/.config/systemd/user/claw-pilot-dashboard.service"
      if [ ! -f "$SERVICE_FILE" ]; then
        log "Installing dashboard as systemd service..."
        DASHBOARD_PID=$(lsof -ti:19000 2>/dev/null || true)
        if [ -n "$DASHBOARD_PID" ]; then
          warn "Stopping manual dashboard process (PID $DASHBOARD_PID) on port 19000..."
          kill "$DASHBOARD_PID" 2>/dev/null || true
          sleep 2
        fi
        if $CP_NODE $CP_ENTRY service install; then
          log "Dashboard service installed and started."
          log "View logs: journalctl --user -u claw-pilot-dashboard.service -f"
        else
          warn "Dashboard service installation failed. Run manually: claw-pilot service install"
        fi
      fi
    fi
  fi

  # Check if admin account exists (migration from pre-auth version)
  if ! $CP_NODE $CP_ENTRY auth check 2>/dev/null; then
    echo ""
    log "No admin account found — creating one..."
    $CP_NODE $CP_ENTRY auth setup 2>&1
    echo ""
    warn "Save the admin password above — you will need it to access the dashboard."
  fi
  exit 0
else
  # Handle corrupted install dir (exists but not a git repo)
  if [ -d "$INSTALL_DIR" ]; then
    warn "$INSTALL_DIR exists but is not a git repository (corrupted or partial install)."
    warn "Removing it and starting fresh..."
    if command -v sudo >/dev/null 2>&1; then
      sudo rm -rf "$INSTALL_DIR"
    else
      rm -rf "$INSTALL_DIR"
    fi
    log "Removed $INSTALL_DIR."
  fi
  # Try to clone as current user; use sudo only if needed
  if git clone "$REPO_URL" "$INSTALL_DIR" 2>/dev/null; then
    : # success
  elif command -v sudo >/dev/null 2>&1; then
    warn "Cloning to $INSTALL_DIR requires elevated privileges..."
    sudo git clone "$REPO_URL" "$INSTALL_DIR"
    sudo chown -R "$(id -u):$(id -g)" "$INSTALL_DIR"
  else
    error "Cannot clone to $INSTALL_DIR. Set CLAW_PILOT_INSTALL_DIR to a writable path."
  fi
fi

# ── 10. Install dependencies and build ───────────────────────────────────────
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  log "ARM64 detected — native compilation may take several minutes. Please wait..."
fi

run_quiet_step "Installing dependencies (compiling better-sqlite3 native bindings)" \
  sh -c "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"

run_quiet_step "Building CLI" sh -c "cd '$INSTALL_DIR' && pnpm run build:cli"
run_quiet_step "Building UI"  sh -c "cd '$INSTALL_DIR' && pnpm run build:ui"

# ── 11. Install claw-pilot wrapper binary ─────────────────────────────────────
# A wrapper script is used instead of a symlink so that the correct node
# binary is always invoked, even when node is installed via nvm/volta/fnm
# and not present in the system PATH.
log "Installing claw-pilot wrapper binary..."
NODE_BIN=$(resolve_node_bin)
[ -z "$NODE_BIN" ] && error "Cannot locate node binary. Make sure Node.js is installed."
log "Using node at: $NODE_BIN"

WRAPPER_CONTENT="#!/bin/sh
exec \"$NODE_BIN\" \"$INSTALL_DIR/dist/index.mjs\" \"\$@\""

WRAPPER_TARGET="/usr/local/bin/claw-pilot"
_write_wrapper() {
  printf '%s\n' "$WRAPPER_CONTENT" > "$WRAPPER_TARGET"
  chmod +x "$WRAPPER_TARGET"
}

if _write_wrapper 2>/dev/null; then
  LINK_PATH="$WRAPPER_TARGET"
elif command -v sudo >/dev/null 2>&1; then
  sudo sh -c "printf '%s\n' '$WRAPPER_CONTENT' > '$WRAPPER_TARGET' && chmod +x '$WRAPPER_TARGET'"
  LINK_PATH="$WRAPPER_TARGET"
else
  # Fallback: pnpm global bin dir (already in PATH from step 6)
  PNPM_GLOBAL_BIN=$(pnpm bin --global 2>/dev/null || echo "")
  if [ -n "$PNPM_GLOBAL_BIN" ]; then
    WRAPPER_TARGET="$PNPM_GLOBAL_BIN/claw-pilot"
    printf '%s\n' "$WRAPPER_CONTENT" > "$WRAPPER_TARGET"
    chmod +x "$WRAPPER_TARGET"
    LINK_PATH="$WRAPPER_TARGET"
  else
    error "Cannot install claw-pilot wrapper. Add $INSTALL_DIR/dist/ to PATH manually."
  fi
fi

# ── 12. Verify & persist PATH ─────────────────────────────────────────────────
# Persist the wrapper's bin dir in shell profiles if not already there (idempotent).
# This ensures `claw-pilot` is found in new shells without manual PATH editing.
_wrapper_dir=$(dirname "$LINK_PATH")
for _rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  [ -f "$_rc" ] || continue
  grep -q "claw-pilot" "$_rc" 2>/dev/null && continue
  grep -q "$_wrapper_dir" "$_rc" 2>/dev/null && continue
  printf '\n# claw-pilot bin dir (added by claw-pilot installer)\nexport PATH="%s:$PATH"\n' "$_wrapper_dir" >> "$_rc"
done

# Invalidate shell command cache so claw-pilot is found immediately
hash -r 2>/dev/null || true

if command -v claw-pilot >/dev/null 2>&1; then
  log "claw-pilot $(claw-pilot --version) installed successfully! (linked at $LINK_PATH)"
else
  warn "claw-pilot not found in PATH yet."
  [ -n "$_wrapper_dir" ] && warn_path_missing "$_wrapper_dir" "claw-pilot binary dir ($_wrapper_dir)"
  warn "Or run directly: node $INSTALL_DIR/dist/index.mjs"
fi

# ── 13. Initialize ────────────────────────────────────────────────────────────
# Resolve the claw-pilot command with retries — the wrapper may have just been
# written and the shell cache may not have caught up yet (inspired by OpenClaw's
# resolve_openclaw_bin pattern).
_resolve_claw_pilot_cmd() {
  # Attempt 1: direct lookup after cache invalidation
  hash -r 2>/dev/null || true
  if command -v claw-pilot >/dev/null 2>&1; then
    printf '%s' "claw-pilot"; return 0
  fi
  # Attempt 2: prepend wrapper dir and retry
  [ -n "${_wrapper_dir:-}" ] && prepend_path_dir "$_wrapper_dir"
  hash -r 2>/dev/null || true
  if command -v claw-pilot >/dev/null 2>&1; then
    printf '%s' "claw-pilot"; return 0
  fi
  # Attempt 3: fall back to direct node invocation
  printf '%s' "node $INSTALL_DIR/dist/index.mjs"
}

echo ""
log "Running 'claw-pilot init' to set up the registry..."
CLAW_PILOT_CMD=$(_resolve_claw_pilot_cmd)
$CLAW_PILOT_CMD init --yes

# ── 14. Create admin account ──────────────────────────────────────────────────
echo ""
log "Creating admin account..."
$CLAW_PILOT_CMD auth setup 2>&1
echo ""
warn "Save the admin password above — you will need it to access the dashboard."
warn "Reset anytime with: claw-pilot auth reset"

# ── 15. Install dashboard as systemd service (Linux only) ────────────────────
if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
  echo ""
  log "Setting up dashboard as a systemd service..."

  DASHBOARD_PID=$(lsof -ti:19000 2>/dev/null || true)
  if [ -n "$DASHBOARD_PID" ]; then
    warn "Stopping manual dashboard process (PID $DASHBOARD_PID) on port 19000..."
    kill "$DASHBOARD_PID" 2>/dev/null || true
    sleep 2
  fi

  # CLAW_PILOT_CMD already resolved in step 13
  if $CLAW_PILOT_CMD service install; then
    log "Dashboard service installed and started."
    log "View logs: journalctl --user -u claw-pilot-dashboard.service -f"
  else
    warn "Dashboard service installation failed. You can start it manually:"
    warn "  claw-pilot dashboard"
    warn "  or: claw-pilot service install"
  fi
else
  echo ""
  log "Skipping systemd service setup (not Linux or systemd not available)."
  log "Start the dashboard manually: claw-pilot dashboard"
fi

echo ""
log "Done! Run 'claw-pilot --help' to see available commands."
log "Run 'claw-pilot create' to provision a new instance."
