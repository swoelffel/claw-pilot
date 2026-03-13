#!/bin/sh
# Claw Pilot installer
# Usage: curl -fsSL https://raw.githubusercontent.com/swoelffel/claw-pilot/main/install.sh | sh
set -e

# Ensure we have a valid working directory (cwd may have been deleted)
cd "${HOME:-/tmp}" 2>/dev/null || true

# Save original PATH before any modifications — used later to detect if the
# user's login shell will find the installed binaries without extra config.
ORIGINAL_PATH="${PATH:-}"

# Prevent corepack from blocking on interactive download prompts in non-interactive
# sessions (e.g. "curl | sh"). With STRICT=0, corepack falls through transparently
# if the requested version is not cached, instead of hanging waiting for confirmation.
export COREPACK_ENABLE_STRICT=0

REPO="swoelffel/claw-pilot"
REPO_URL="https://github.com/${REPO}.git"
CLAW_PILOT_REPO_BRANCH="${CLAW_PILOT_REPO_BRANCH:-main}"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/${CLAW_PILOT_REPO_BRANCH}"
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
  [ -z "$_bin" ] && return 1
  [ -f "$_bin" ] || return 1
  "$_bin" --version >/dev/null 2>&1 || return 1
  return 0
}

# Derive the openclaw wrapper bin path from a dist/index.js path found in ps/service.
# /opt/openclaw/.npm-global/lib/node_modules/openclaw/dist/index.js
# → /opt/openclaw/.npm-global/bin/openclaw
_openclaw_bin_from_dist() {
  printf '%s' "$1" | sed 's|/lib/node_modules/openclaw/dist/index\.js$|/bin/openclaw|'
}

# Pass 1 — detect from a running openclaw-gateway process (Linux only).
# openclaw-gateway renames argv[0] so ps aux shows no path — instead we read
# HOME from /proc/<pid>/environ (requires sudo, which is a pre-req of this installer).
# HOME points to the openclaw user's home (e.g. /opt/openclaw), from which we
# derive the conventional npm-global bin path.
_find_openclaw_from_process() {
  [ "$OS" = "Darwin" ] && return 1
  # Find PIDs of openclaw-gateway processes
  _pids=$(ps -eo pid,args 2>/dev/null \
    | grep 'openclaw-gateway' \
    | grep -v grep \
    | awk '{print $1}')
  [ -z "$_pids" ] && return 1
  for _pid in $_pids; do
    # Read HOME from the process environment
    _home=$(sudo cat "/proc/${_pid}/environ" 2>/dev/null \
      | tr '\0' '\n' \
      | grep '^HOME=' \
      | sed 's/^HOME=//' \
      | head -1)
    [ -z "$_home" ] && continue
    _bin="${_home}/.npm-global/bin/openclaw"
    openclaw_is_valid "$_bin" && OPENCLAW_BIN="$_bin" && return 0
  done
  return 1
}

# Pass 2 — detect from systemd user service files (openclaw-*.service) (Linux only).
# Uses sudo (required by the installer) to read files in other users' homes.
# ExecStart format: /usr/bin/node /path/.npm-global/lib/node_modules/openclaw/dist/index.js ...
# The sed anchors on a space before the path to avoid capturing a partial prefix.
_find_openclaw_from_service() {
  [ "$OS" = "Darwin" ] && return 1
  for _svc in $(find /home /opt /root -maxdepth 6 -name "openclaw-*.service" 2>/dev/null | head -20); do
    _dist=$(sudo cat "$_svc" 2>/dev/null \
      | grep 'ExecStart' \
      | sed 's|.* \(/[^ ]*/node_modules/openclaw/dist/index\.js\).*|\1|' \
      | head -1)
    [ -z "$_dist" ] && continue
    _bin=$(_openclaw_bin_from_dist "$_dist")
    openclaw_is_valid "$_bin" && OPENCLAW_BIN="$_bin" && return 0
  done
  return 1
}

# Pass 3 — hardcoded candidate paths (no pipe, no subshell — POSIX safe).
# Covers fresh installs where openclaw is installed but not yet running.
# On macOS, this is the only detection pass used.
_find_openclaw_from_paths() {
  for _p in \
    "$(command -v openclaw 2>/dev/null)" \
    "$HOME/.npm-global/bin/openclaw" \
    "/opt/openclaw/.npm-global/bin/openclaw" \
    "/opt/homebrew/bin/openclaw" \
    "/usr/local/bin/openclaw"; do
    openclaw_is_valid "$_p" && OPENCLAW_BIN="$_p" && return 0
  done
  # nvm / volta / fnm — dynamic node version managers
  for _nvm_bin in "$HOME/.nvm/versions/node/"*/bin; do
    [ -d "$_nvm_bin" ] || continue
    openclaw_is_valid "$_nvm_bin/openclaw" && OPENCLAW_BIN="$_nvm_bin/openclaw" && return 0
  done
  if openclaw_is_valid "$HOME/.volta/bin/openclaw"; then
    OPENCLAW_BIN="$HOME/.volta/bin/openclaw" && return 0
  fi
  return 1
}

# ── Node.js binary resolver ───────────────────────────────────────────────────
# Resolve the absolute path of node (handles nvm, volta, fnm, etc.)
resolve_node_bin() {
  NODE_BIN=$(command -v node 2>/dev/null)
  if [ -z "$NODE_BIN" ]; then
    for _candidate in \
      $HOME/.nvm/versions/node/*/bin/node \
      $HOME/.volta/bin/node \
      $HOME/.fnm/node-versions/*/installation/bin/node \
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
# resolve_node_bin() handles nvm/volta/fnm — PATH may not include node in
# non-interactive shells (e.g. /bin/bash -c "$(curl ...)").
_node_bin_early=$(resolve_node_bin)
if [ -z "$_node_bin_early" ]; then
  error "Node.js not found. Install Node.js >= $MIN_NODE_VERSION first: https://nodejs.org"
fi
# Prepend the resolved node's bin dir to PATH so subsequent `node` calls work.
prepend_path_dir "$(dirname "$_node_bin_early")"
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
  # "npm bin -g" is removed in npm v10+ and prints an error message on stdout
  # (not stderr) with exit 0 on some versions — never use it.
  # Use "npm prefix -g" only, strip trailing newline before appending /bin.
  _npm_global_bin=$({ _pfx=$(npm prefix -g 2>/dev/null | tr -d '\n'); [ -n "$_pfx" ] && printf '%s/bin' "$_pfx"; } || true)
  [ -n "$_npm_global_bin" ] && prepend_path_dir "$_npm_global_bin"
  # Also pick up whatever pnpm reports as its global bin (if pnpm is now in PATH).
  # COREPACK_ENABLE_STRICT=0 is already exported globally — belt-and-suspenders here
  # to ensure corepack shims don't block on download prompts in non-interactive sessions.
  if command -v pnpm >/dev/null 2>&1; then
    _pnpm_global_bin=$(COREPACK_ENABLE_STRICT=0 pnpm bin --global 2>/dev/null || true)
    [ -n "$_pnpm_global_bin" ] && prepend_path_dir "$_pnpm_global_bin" || true
  fi
  return 0
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

# Ensure pnpm global bin dir is in PATH (handles fresh installs in the same session).
# COREPACK_ENABLE_STRICT=0 prevents corepack shims from blocking on download prompts.
if ! COREPACK_ENABLE_STRICT=0 pnpm bin --global >/dev/null 2>&1; then
  warn "pnpm global bin dir not configured, running 'pnpm setup'..."
  COREPACK_ENABLE_STRICT=0 pnpm setup 2>/dev/null || true
fi
_reload_pnpm_path

# Final check
if ! command -v pnpm >/dev/null 2>&1; then
  error "pnpm installed but not found in PATH. Open a new shell and re-run this script."
fi
log "pnpm $(COREPACK_ENABLE_STRICT=0 pnpm --version)"

# Warn if pnpm's bin dir is absent from the user's original login PATH
_pnpm_bin_dir=$(COREPACK_ENABLE_STRICT=0 pnpm bin --global 2>/dev/null || true)
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
# OpenClaw is optional — claw-pilot also supports claw-runtime instances.
# If not found, the user is prompted (N/y). Default is to skip.
# Set INSTALL_OPENCLAW=1 to force install without prompt (CI / automation).
OPENCLAW_BIN=""
# Orchestrate the 3 detection passes in order.
# On macOS, Pass 1 (/proc) and Pass 2 (systemd) are skipped automatically.
_find_openclaw() {
  _find_openclaw_from_process && return 0
  _find_openclaw_from_service && return 0
  _find_openclaw_from_paths   && return 0
  return 1
}

# Run the OpenClaw installer (shared logic for prompt and forced install paths).
_install_openclaw() {
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
    _oc_ver=$("$OPENCLAW_BIN" --version 2>/dev/null || true)
    log "OpenClaw ${_oc_ver} installed successfully."
  else
    warn "OpenClaw installation failed or binary not functional after install."
    warn "You can install it manually later:"
    warn "  curl -fsSL $OPENCLAW_INSTALL_URL | bash"
  fi
}

if _find_openclaw; then
  _oc_ver=$("$OPENCLAW_BIN" --version 2>/dev/null || true)
  log "OpenClaw ${_oc_ver} found at $OPENCLAW_BIN"
else
  warn "OpenClaw not found."
  warn "Note: claw-pilot supports two instance types — openclaw and claw-runtime."
  warn "OpenClaw is optional. You can skip it and use claw-runtime instances instead."
  echo ""

  _do_install_openclaw=0

  if [ "${INSTALL_OPENCLAW:-0}" = "1" ]; then
    # Forced via env var (CI / automation)
    log "INSTALL_OPENCLAW=1 — installing OpenClaw..."
    _do_install_openclaw=1
  elif [ -t 0 ]; then
    # Interactive session — prompt the user (default: N)
    printf "  Install OpenClaw now? [N/y]: "
    read -r _oc_answer </dev/tty || _oc_answer=""
    case "$_oc_answer" in
      [yY]|[yY][eE][sS]) _do_install_openclaw=1 ;;
      *) _do_install_openclaw=0 ;;
    esac
  else
    # Non-interactive (curl | sh) — skip silently
    warn "Non-interactive session detected — skipping OpenClaw installation."
    warn "To install OpenClaw later: curl -fsSL $OPENCLAW_INSTALL_URL | bash"
    warn "To force install in automation: INSTALL_OPENCLAW=1 curl -fsSL <installer> | sh"
  fi

  if [ "$_do_install_openclaw" -eq 1 ]; then
    _install_openclaw
  else
    warn "OpenClaw skipped. You can install it later or create claw-runtime instances."
  fi
fi

# ── 9. Clone or update the repository ────────────────────────────────────────
log "Installing claw-pilot from ${REPO_URL}..."
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing installation at $INSTALL_DIR..."
  # Fetch and switch to the requested branch (respects CLAW_PILOT_REPO_BRANCH).
  # A plain `git pull --ff-only` would stay on whatever branch was checked out
  # previously (typically main), ignoring the requested branch entirely.
  git -C "$INSTALL_DIR" fetch origin
  git -C "$INSTALL_DIR" checkout "$CLAW_PILOT_REPO_BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$CLAW_PILOT_REPO_BRANCH"

  run_quiet_step "Installing dependencies" sh -c "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"
  run_quiet_step "Building CLI" sh -c "cd '$INSTALL_DIR' && pnpm run build:cli"
  run_quiet_step "Building UI" sh -c "cd '$INSTALL_DIR' && pnpm run build:ui"

  log "claw-pilot $(node "$INSTALL_DIR/dist/index.mjs" --version 2>/dev/null) updated successfully!"

  # Resolve the claw-pilot command — used for auth check and service install below.
  # Must be initialised here (before the Linux-only systemd block) so it is also
  # available on macOS where the systemd block is skipped entirely.
  CP_NODE="node"
  CP_ENTRY="$INSTALL_DIR/dist/index.mjs"
  if command -v claw-pilot >/dev/null 2>&1; then
    CP_NODE="claw-pilot"
    CP_ENTRY=""
  fi

  # Manage dashboard service (Linux only)
  if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
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
  if git clone --branch "$CLAW_PILOT_REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null; then
    : # success
  elif command -v sudo >/dev/null 2>&1; then
    warn "Cloning to $INSTALL_DIR requires elevated privileges..."
    sudo git clone --branch "$CLAW_PILOT_REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
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
elif [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
  # TTY is available — sudo can prompt for password interactively.
  # Write via tmpfile to avoid quoting/newline issues when passing WRAPPER_CONTENT
  # through a sudo subshell. Also ensures the target directory exists (e.g. on a
  # fresh macOS where /usr/local/bin/ is not created until Homebrew is installed).
  _wrapper_tmp=$(mktempfile)
  printf '%s\n' "$WRAPPER_CONTENT" > "$_wrapper_tmp"
  sudo mkdir -p "$(dirname "$WRAPPER_TARGET")"
  # Use sh -c to reset umask before install, ensuring 0755 is not masked.
  sudo sh -c "umask 022 && install -m 0755 '$_wrapper_tmp' '$WRAPPER_TARGET'"
  LINK_PATH="$WRAPPER_TARGET"
else
  # No TTY (e.g. curl | sh) or no sudo — sudo cannot prompt for password.
  # Try pnpm global bin dir first, then fall back to ~/bin/ (always writable).
  PNPM_GLOBAL_BIN=$(COREPACK_ENABLE_STRICT=0 pnpm bin --global 2>/dev/null || echo "")
  if [ -n "$PNPM_GLOBAL_BIN" ]; then
    WRAPPER_TARGET="$PNPM_GLOBAL_BIN/claw-pilot"
    printf '%s\n' "$WRAPPER_CONTENT" > "$WRAPPER_TARGET"
    chmod +x "$WRAPPER_TARGET"
    LINK_PATH="$WRAPPER_TARGET"
  else
    # Final fallback: ~/bin/ — no sudo required, works in curl | sh on any OS.
    WRAPPER_TARGET="$HOME/bin/claw-pilot"
    mkdir -p "$HOME/bin"
    printf '%s\n' "$WRAPPER_CONTENT" > "$WRAPPER_TARGET"
    chmod +x "$WRAPPER_TARGET"
    LINK_PATH="$WRAPPER_TARGET"
  fi
fi

# ── 12. Verify & persist PATH ─────────────────────────────────────────────────
# Persist the wrapper's bin dir in shell profiles if not already there (idempotent).
# This ensures `claw-pilot` is found in new shells without manual PATH editing.
_wrapper_dir=$(dirname "$LINK_PATH")
for _rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  # On macOS, ~/.zshrc is not created by default (unlike Linux) — create it if missing.
  if [ "$OS" = "Darwin" ] && [ "$_rc" = "$HOME/.zshrc" ] && [ ! -f "$_rc" ]; then
    touch "$_rc" 2>/dev/null || true
  fi
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
# Sets CP_NODE and CP_ENTRY so callers can run: $CP_NODE $CP_ENTRY <args>
# Avoids storing "node /path/to/index.mjs" in a single variable (word-splitting
# issue in POSIX sh when the string contains spaces).
_resolve_claw_pilot_cmd() {
  # Attempt 1: direct lookup after cache invalidation
  hash -r 2>/dev/null || true
  if command -v claw-pilot >/dev/null 2>&1; then
    CP_NODE="claw-pilot"; CP_ENTRY=""; return 0
  fi
  # Attempt 2: prepend wrapper dir and retry
  [ -n "${_wrapper_dir:-}" ] && prepend_path_dir "$_wrapper_dir"
  hash -r 2>/dev/null || true
  if command -v claw-pilot >/dev/null 2>&1; then
    CP_NODE="claw-pilot"; CP_ENTRY=""; return 0
  fi
  # Attempt 3: fall back to absolute node + entry point (two separate vars — no word-splitting)
  CP_NODE="$NODE_BIN"
  CP_ENTRY="$INSTALL_DIR/dist/index.mjs"
}

echo ""
log "Running 'claw-pilot init' to set up the registry..."
_resolve_claw_pilot_cmd
$CP_NODE $CP_ENTRY init --yes

# ── 14. Create admin account ──────────────────────────────────────────────────
echo ""
log "Creating admin account..."
$CP_NODE $CP_ENTRY auth setup 2>&1
echo ""
warn "Save the admin password above — you will need it to access the dashboard."
warn "Reset anytime with: $LINK_PATH auth reset"

# ── 15. Install dashboard as systemd/launchd service ─────────────────────────
_service_installed=false

if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
  echo ""
  log "Setting up dashboard as a systemd service..."

  DASHBOARD_PID=$(lsof -ti:19000 2>/dev/null || true)
  if [ -n "$DASHBOARD_PID" ]; then
    warn "Stopping manual dashboard process (PID $DASHBOARD_PID) on port 19000..."
    kill "$DASHBOARD_PID" 2>/dev/null || true
    sleep 2
  fi

  # CP_NODE / CP_ENTRY already resolved in step 13
  if $CP_NODE $CP_ENTRY service install; then
    log "Dashboard service installed and started."
    log "View logs: journalctl --user -u claw-pilot-dashboard.service -f"
    _service_installed=true
  else
    warn "Dashboard service installation failed. You can start it manually:"
    warn "  claw-pilot dashboard"
    warn "  or: claw-pilot service install"
  fi
elif [ "$OS" = "Darwin" ]; then
  echo ""
  # Ask to install as launchd service (only if stdin is a TTY)
  if [ -t 0 ]; then
    printf '[?] Install claw-pilot dashboard as a launchd service (auto-start on login)? [Y/n] '
    read -r _install_service_answer </dev/tty
    case "$_install_service_answer" in
      [nN]*)
        log "Skipping service installation."
        log "You can install it later with: claw-pilot service install"
        ;;
      *)
        log "Installing dashboard as launchd service..."
        if $CP_NODE $CP_ENTRY service install; then
          log "Dashboard service installed and started."
          log "View logs: tail -f ~/.claw-pilot/dashboard.log"
          _service_installed=true
        else
          warn "Service installation failed. Start manually: claw-pilot dashboard start"
        fi
        ;;
    esac
  else
    log "Skipping service setup (non-interactive). Run later: claw-pilot service install"
  fi
else
  echo ""
  log "Skipping service setup (not Linux/macOS or systemd not available)."
fi

echo ""
log "Done! Run 'claw-pilot --help' to see available commands."
log "Run 'claw-pilot create' to provision a new instance."
echo ""
if [ "$_service_installed" = "true" ]; then
  log "Dashboard is running at: http://localhost:19000"
else
  log "To start the dashboard:"
  log "  claw-pilot dashboard start"
  log "Then open: http://localhost:19000"
fi
if [ -t 0 ]; then
  printf '[?] Open the dashboard in your browser now? [Y/n] '
  read -r _open_browser </dev/tty
  case "$_open_browser" in
    [nN]*) ;;
    *)
      if [ "$OS" = "Darwin" ]; then
        open "http://localhost:19000" 2>/dev/null || true
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:19000" 2>/dev/null || true
      fi
      ;;
  esac
fi
echo ""
if ! command -v claw-pilot >/dev/null 2>&1; then
  warn "claw-pilot is not in your current PATH."
  warn "Either open a new terminal, or run:"
  warn "  source ~/.zshrc   (zsh)"
  warn "  source ~/.bashrc  (bash)"
  warn "Or use the full path directly: $LINK_PATH"
fi
