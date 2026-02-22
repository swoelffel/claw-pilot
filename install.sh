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

# 1. Banner
log "Installing claw-pilot v${CLAW_PILOT_VERSION} from ${REPO_URL}"
echo ""

# 2. Check OS
OS=$(uname -s)
case "$OS" in
  Linux)  log "Detected Linux" ;;
  Darwin) log "Detected macOS (dev mode — systemd not available)" ;;
  *)      error "Unsupported OS: $OS" ;;
esac

# 3. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  error "Node.js not found. Install Node.js >= $MIN_NODE_VERSION first: https://nodejs.org"
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
  error "Node.js >= $MIN_NODE_VERSION required (found $(node -v))"
fi
log "Node.js $(node -v)"

# 4. Check git
if ! command -v git >/dev/null 2>&1; then
  error "git not found. Install git first."
fi

# 5. Check pnpm (install if missing, configure if needed)
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
fi
log "pnpm $(pnpm --version)"

# 6. Check OpenClaw (optional — claw-pilot can install it automatically)
OPENCLAW_FOUND=0
if command -v openclaw >/dev/null 2>&1; then
  log "OpenClaw $(openclaw --version 2>/dev/null || echo 'unknown')"
  OPENCLAW_FOUND=1
else
  for p in "/opt/openclaw/.npm-global/bin/openclaw" "$HOME/.npm-global/bin/openclaw"; do
    if [ -x "$p" ]; then
      log "OpenClaw found at $p (not in PATH)"
      OPENCLAW_FOUND=1
      break
    fi
  done
fi

if [ "$OPENCLAW_FOUND" -eq 0 ]; then
  warn "OpenClaw CLI not found."
  warn "claw-pilot will offer to install it automatically on first run ('claw-pilot init')."
  warn "To install it now manually: curl -fsSL $OPENCLAW_INSTALL_URL | sh"
fi

# 7. Clone or update the repository
log "Installing claw-pilot from ${REPO_URL}..."
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing installation at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
  log "Rebuilding after update..."
  pnpm install --dir "$INSTALL_DIR" --frozen-lockfile
  pnpm --dir "$INSTALL_DIR" run build:cli
  pnpm --dir "$INSTALL_DIR" run build:ui
  log "claw-pilot $(node "$INSTALL_DIR/dist/index.mjs" --version 2>/dev/null) updated successfully!"
  exit 0
else
  if [ -d "$INSTALL_DIR" ]; then
    error "$INSTALL_DIR already exists but is not a git repo. Remove it first or set CLAW_PILOT_INSTALL_DIR."
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

# 8. Install dependencies and build
# Note: better-sqlite3 native bindings are compiled automatically via
# pnpm.onlyBuiltDependencies in package.json (requires python3 + make + g++)
log "Installing dependencies (includes compiling better-sqlite3 native bindings)..."
pnpm install --dir "$INSTALL_DIR" --frozen-lockfile

log "Building CLI..."
pnpm --dir "$INSTALL_DIR" run build:cli

log "Building UI..."
pnpm --dir "$INSTALL_DIR" run build:ui

# 9. Link binary globally
log "Linking claw-pilot binary..."
PNPM_GLOBAL_BIN=$(pnpm bin --global 2>/dev/null || echo "")

if [ -n "$PNPM_GLOBAL_BIN" ]; then
  ln -sf "$INSTALL_DIR/dist/index.mjs" "$PNPM_GLOBAL_BIN/claw-pilot"
  chmod +x "$INSTALL_DIR/dist/index.mjs"
  LINK_PATH="$PNPM_GLOBAL_BIN/claw-pilot"
else
  # Fallback: /usr/local/bin (may need sudo)
  LINK_TARGET="/usr/local/bin/claw-pilot"
  if ln -sf "$INSTALL_DIR/dist/index.mjs" "$LINK_TARGET" 2>/dev/null; then
    chmod +x "$INSTALL_DIR/dist/index.mjs"
    LINK_PATH="$LINK_TARGET"
  elif command -v sudo >/dev/null 2>&1; then
    sudo ln -sf "$INSTALL_DIR/dist/index.mjs" "$LINK_TARGET"
    sudo chmod +x "$INSTALL_DIR/dist/index.mjs"
    LINK_PATH="$LINK_TARGET"
  else
    error "Cannot create symlink in /usr/local/bin. Add $(dirname "$INSTALL_DIR/dist/index.mjs") to PATH manually."
  fi
fi

# 10. Verify
if command -v claw-pilot >/dev/null 2>&1; then
  log "claw-pilot $(claw-pilot --version) installed successfully! (linked at $LINK_PATH)"
else
  warn "claw-pilot not found in PATH yet."
  warn "Add the following to your shell profile and restart your session:"
  warn "  export PATH=\"$(dirname "$LINK_PATH"):\$PATH\""
  warn "Or run directly: node $INSTALL_DIR/dist/index.mjs"
fi

# 11. Initialize
echo ""
log "Running 'claw-pilot init' to set up the registry..."
if command -v claw-pilot >/dev/null 2>&1; then
  claw-pilot init --yes
else
  node "$INSTALL_DIR/dist/index.mjs" init --yes
fi

echo ""
log "Done! Run 'claw-pilot --help' to see available commands."
log "Run 'claw-pilot create' to provision a new instance."
