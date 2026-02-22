#!/bin/sh
# Claw Pilot installer
# Usage: curl -fsSL https://raw.githubusercontent.com/swoelffel/claw-pilot/main/install.sh | sh
set -e

REPO="swoelffel/claw-pilot"
MIN_NODE_VERSION=22
PACKAGE_NAME="claw-pilot"
OPENCLAW_INSTALL_URL="${OPENCLAW_INSTALL_URL:-https://openclaw.ai/install.sh}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { printf "${GREEN}[+]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
error() { printf "${RED}[x]${NC} %s\n" "$1"; exit 1; }

# 1. Check OS
OS=$(uname -s)
case "$OS" in
  Linux)  log "Detected Linux" ;;
  Darwin) log "Detected macOS (dev mode — systemd not available)" ;;
  *)      error "Unsupported OS: $OS" ;;
esac

# 2. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  error "Node.js not found. Install Node.js >= $MIN_NODE_VERSION first: https://nodejs.org"
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
  error "Node.js >= $MIN_NODE_VERSION required (found v$(node -v))"
fi
log "Node.js $(node -v)"

# 3. Check pnpm (install if missing)
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found, installing via npm..."
  npm install -g pnpm
fi
log "pnpm $(pnpm --version)"

# 4. Check OpenClaw (optional — claw-pilot can install it automatically)
OPENCLAW_FOUND=0
if command -v openclaw >/dev/null 2>&1; then
  log "OpenClaw $(openclaw --version 2>/dev/null || echo 'unknown')"
  OPENCLAW_FOUND=1
else
  # Check common non-PATH locations
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

# 5. Install claw-pilot
log "Installing $PACKAGE_NAME..."
pnpm install -g $PACKAGE_NAME 2>/dev/null || npm install -g $PACKAGE_NAME

# 6. Verify
if ! command -v claw-pilot >/dev/null 2>&1; then
  error "Installation failed. claw-pilot not found in PATH."
fi
log "claw-pilot $(claw-pilot --version) installed successfully!"

# 7. Initialize (includes automatic discovery)
echo ""
log "Running 'claw-pilot init' to set up the registry..."
claw-pilot init

echo ""
log "Done! Run 'claw-pilot --help' to see available commands."
log "Run 'claw-pilot create' to provision a new instance."
