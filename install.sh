#!/bin/sh
# Claw Pilot installer
# Usage: curl -fsSL https://raw.githubusercontent.com/swoelffel/claw-pilot/main/install.sh | sh
set -e

# Ensure we have a valid working directory (cwd may have been deleted)
cd "${HOME:-/tmp}" 2>/dev/null || true

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

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { printf "${GREEN}[+]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
error() { printf "${RED}[x]${NC} %s\n" "$1"; exit 1; }

# Helper: run apt-get or dnf with sudo if needed
_apt() { command -v sudo >/dev/null 2>&1 && sudo apt-get "$@" || apt-get "$@"; }
_dnf() { command -v sudo >/dev/null 2>&1 && sudo dnf "$@" || dnf "$@"; }

# Helper: install a package via the available package manager (Linux only)
install_pkg() {
  pkg_apt="$1"  # package name for apt
  pkg_dnf="$2"  # package name for dnf (optional, defaults to pkg_apt)
  pkg_dnf="${pkg_dnf:-$pkg_apt}"
  if command -v apt-get >/dev/null 2>&1; then
    _apt install -y "$pkg_apt"
  elif command -v dnf >/dev/null 2>&1; then
    _dnf install -y "$pkg_dnf"
  else
    return 1
  fi
}

# Helper: validate an openclaw binary is actually functional (not a broken symlink)
openclaw_is_valid() {
  bin="$1"
  [ -f "$bin" ] || return 1
  "$bin" --version >/dev/null 2>&1 || return 1
  return 0
}

# Helper: resolve the absolute path of node (handles nvm, volta, fnm, etc.)
resolve_node_bin() {
  # command -v respects the current shell PATH (nvm/volta/fnm already loaded)
  NODE_BIN=$(command -v node 2>/dev/null)
  if [ -z "$NODE_BIN" ]; then
    # Fallback: scan common non-PATH locations
    for candidate in \
      "$HOME/.nvm/versions/node/"*/bin/node \
      "$HOME/.volta/bin/node" \
      "$HOME/.fnm/node-versions/"*/installation/bin/node \
      /usr/local/bin/node \
      /usr/bin/node; do
      # glob may not expand — skip literal patterns
      [ -f "$candidate" ] && NODE_BIN="$candidate" && break
    done
  fi
  printf '%s' "$NODE_BIN"
}

# 1. Banner
log "Installing claw-pilot v${CLAW_PILOT_VERSION} from ${REPO_URL}"
echo ""

# 2. Check sudo privileges (required for apt installs, /opt clone, /usr/local/bin link)
if [ "$(id -u)" != "0" ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    error "sudo is not installed. Run this script as root or install sudo first."
  fi
  if ! sudo -n true 2>/dev/null && ! sudo -v 2>/dev/null; then
    error "This script requires sudo privileges. Run as a sudoer or as root."
  fi
  log "sudo privileges confirmed."
fi

# 3. Check OS
OS=$(uname -s)
case "$OS" in
  Linux)  log "Detected Linux" ;;
  Darwin) log "Detected macOS (dev mode — systemd not available)" ;;
  *)      error "Unsupported OS: $OS" ;;
esac

# 4. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  error "Node.js not found. Install Node.js >= $MIN_NODE_VERSION first: https://nodejs.org"
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
  error "Node.js >= $MIN_NODE_VERSION required (found $(node -v))"
fi
log "Node.js $(node -v)"

# 5. Check git — auto-install on Linux if missing
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

# 6. Check pnpm (install if missing, configure if needed)
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found, installing via npm..."
  npm install -g pnpm
fi
# Ensure pnpm global bin dir exists and is in PATH
if ! pnpm bin --global >/dev/null 2>&1; then
  warn "pnpm global bin dir not configured, running 'pnpm setup'..."
  pnpm setup
  # Source the updated shell config if possible
  # shellcheck disable=SC1090
  [ -f "$HOME/.bashrc" ]  && . "$HOME/.bashrc"  2>/dev/null || true
  [ -f "$HOME/.profile" ] && . "$HOME/.profile" 2>/dev/null || true
  [ -f "$HOME/.zshrc" ]   && . "$HOME/.zshrc"   2>/dev/null || true
fi
log "pnpm $(pnpm --version)"

# 7. Check build tools (required for better-sqlite3 native bindings)
#    Done early so we fail fast before cloning / compiling anything.
BUILD_TOOLS_OK=1
for tool in cc make python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    warn "Build tool '$tool' not found."
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
    for tool in cc make python3; do
      command -v "$tool" >/dev/null 2>&1 || error "Build tool '$tool' still not found after install. Aborting."
    done
    log "Build tools ready."
  else
    error "Missing build tools and no supported package manager found. Install manually: gcc make python3"
  fi
fi

# 8. Check OpenClaw — install before building claw-pilot so 'claw-pilot init' works immediately
OPENCLAW_BIN=""
_find_openclaw() {
  # Build candidate list — include nvm/volta/fnm node bin dirs
  _oc_candidates="$(command -v openclaw 2>/dev/null)
$HOME/.npm-global/bin/openclaw
/opt/openclaw/.npm-global/bin/openclaw
/opt/homebrew/bin/openclaw
/usr/local/bin/openclaw"

  # Append all nvm-managed node bin dirs (glob expanded by shell)
  for _nvm_bin in "$HOME/.nvm/versions/node/"*/bin; do
    [ -d "$_nvm_bin" ] && _oc_candidates="$_oc_candidates
$_nvm_bin/openclaw"
  done
  # Volta
  [ -d "$HOME/.volta/bin" ] && _oc_candidates="$_oc_candidates
$HOME/.volta/bin/openclaw"

  for p in $_oc_candidates; do
    [ -z "$p" ] && continue
    if openclaw_is_valid "$p"; then
      OPENCLAW_BIN="$p"
      return 0
    fi
  done
  return 1
}

if _find_openclaw; then
  log "OpenClaw $($OPENCLAW_BIN --version 2>/dev/null) found at $OPENCLAW_BIN"
else
  warn "OpenClaw not found — installing now..."

  # Warn if low memory and no swap (libopus compiles from source and is memory-intensive)
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

  # Run installer with timeout to avoid hanging indefinitely
  OPENCLAW_INSTALLED=0
  if command -v timeout >/dev/null 2>&1; then
    if timeout "$OPENCLAW_INSTALL_TIMEOUT" sh -c \
        "curl -fsSL --proto '=https' --tlsv1.2 '$OPENCLAW_INSTALL_URL' | bash"; then
      OPENCLAW_INSTALLED=1
    fi
  else
    # No timeout command available — run without guard
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

# 9. Clone or update the repository
log "Installing claw-pilot from ${REPO_URL}..."
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing installation at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
  log "Rebuilding after update..."
  ( cd "$INSTALL_DIR" && pnpm install --frozen-lockfile && pnpm run build:cli && pnpm run build:ui )
  log "claw-pilot $(node "$INSTALL_DIR/dist/index.mjs" --version 2>/dev/null) updated successfully!"
  # Manage dashboard service (Linux only)
  if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
    CLAW_PILOT_BIN="node $INSTALL_DIR/dist/index.mjs"
    if command -v claw-pilot >/dev/null 2>&1; then
      CLAW_PILOT_BIN="claw-pilot"
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
        if $CLAW_PILOT_BIN service install; then
          log "Dashboard service installed and started."
          log "View logs: journalctl --user -u claw-pilot-dashboard.service -f"
        else
          warn "Dashboard service installation failed. Run manually: claw-pilot service install"
        fi
      fi
    fi
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

# 10. Install dependencies and build
log "Installing dependencies (compiling better-sqlite3 native bindings)..."
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  log "ARM64 detected — native compilation may take several minutes. Please wait..."
fi
( cd "$INSTALL_DIR" && pnpm install --frozen-lockfile )

log "Building CLI and UI..."
( cd "$INSTALL_DIR" && pnpm run build:cli && pnpm run build:ui )

# 11. Install claw-pilot wrapper binary
#     A wrapper script is used instead of a symlink so that the correct node
#     binary is always invoked, even when node is installed via nvm/volta/fnm
#     and not present in the system PATH.
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
  # Fallback: pnpm global bin dir
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

# 12. Verify
if command -v claw-pilot >/dev/null 2>&1; then
  log "claw-pilot $(claw-pilot --version) installed successfully! (linked at $LINK_PATH)"
else
  warn "claw-pilot not found in PATH yet."
  warn "Add the following to your shell profile and restart your session:"
  warn "  export PATH=\"$(dirname "$LINK_PATH"):\$PATH\""
  warn "Or run directly: node $INSTALL_DIR/dist/index.mjs"
fi

# 13. Initialize
echo ""
log "Running 'claw-pilot init' to set up the registry..."
if command -v claw-pilot >/dev/null 2>&1; then
  CLAW_PILOT_CMD="claw-pilot"
else
  CLAW_PILOT_CMD="node $INSTALL_DIR/dist/index.mjs"
fi
$CLAW_PILOT_CMD init --yes

# 14. Install dashboard as systemd service (Linux only)
if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
  echo ""
  log "Setting up dashboard as a systemd service..."

  DASHBOARD_PID=$(lsof -ti:19000 2>/dev/null || true)
  if [ -n "$DASHBOARD_PID" ]; then
    warn "Stopping manual dashboard process (PID $DASHBOARD_PID) on port 19000..."
    kill "$DASHBOARD_PID" 2>/dev/null || true
    sleep 2
  fi

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
