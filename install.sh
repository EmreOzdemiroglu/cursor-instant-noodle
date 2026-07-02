#!/usr/bin/env bash
# install.sh — Install Cursor Instant Noodle
#
# Usage:
#   ./install.sh                          # install from current directory
#   curl -fsSL URL/install.sh | bash      # install from GitHub release
#
# What it does:
#   1. Detects if running from a source checkout (has package.json)
#      → builds the binary, installs to ~/.local/bin/cursor-noodle
#   2. Otherwise downloads the matching binary from GitHub releases
#   3. Verifies the install with `cursor-noodle --version`

set -e

REPO="${CURSOR_NOODLE_REPO:-EmreOzdemiroglu/cursor-instant-noodle}"
VERSION="${CURSOR_NOODLE_VERSION:-latest}"
INSTALL_DIR="${CURSOR_NOODLE_INSTALL_DIR:-$HOME/.local/bin}"
BIN_NAME="cursor-noodle"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

info()  { printf "${CYAN}→${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${RESET} %s\n" "$*"; }
err()   { printf "${RED}✗${RESET} %s\n" "$*" >&2; }

print_banner() {
    printf "${CYAN}${BOLD}\n"
    printf "   ╔══════════════════════════════════════════════════╗\n"
    printf "   ║           🍜  Cursor Instant Noodle  🍜              ║\n"
    printf "   ║   Antigravity · Codex · z.ai · Opencode · Local ║\n"
    printf "   ╚══════════════════════════════════════════════════╝\n"
    printf "${RESET}\n"
}

# ─── Detect platform ─────────────────────────────────────
detect_platform() {
    local os arch
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)

    case "$os-$arch" in
        darwin-arm64)  PLATFORM="macos-arm64" ;;
        darwin-x64)    PLATFORM="macos-x64" ;;
        linux-x86_64)  PLATFORM="linux-x64" ;;
        linux-aarch64) PLATFORM="linux-arm64" ;;
        *)
            err "Unsupported platform: $os-$arch"
            err "Currently supported: macOS (arm64, x64), Linux (x64, arm64)"
            exit 1
            ;;
    esac
}

# ─── Source install (cloned repo) ────────────────────────
install_from_source() {
    info "Installing from source..."
    cd "$SOURCE_DIR"

    if ! command -v bun >/dev/null 2>&1; then
        warn "bun not found. Installing..."
        curl -fsSL https://bun.sh/install | bash >/dev/null
        export PATH="$HOME/.bun/bin:$PATH"
    fi

    info "Installing dependencies..."
    npm install --no-audit --no-fund --silent

    info "Building binary..."
    mkdir -p dist
    # Convert our platform name to bun's target format
    case "$PLATFORM" in
        macos-arm64)  BUN_TARGET="bun-darwin-arm64" ;;
        macos-x64)    BUN_TARGET="bun-darwin-x64" ;;
        linux-x64)    BUN_TARGET="bun-linux-x64" ;;
        linux-arm64)  BUN_TARGET="bun-linux-arm64" ;;
    esac
    bun build --compile --target="$BUN_TARGET" --outfile="dist/$BIN_NAME" bin/cursor-noodle.cjs

    if [ ! -f "dist/$BIN_NAME" ]; then
        err "Build failed — binary not found at dist/$BIN_NAME"
        exit 1
    fi

    mkdir -p "$INSTALL_DIR"
    cp "dist/$BIN_NAME" "$INSTALL_DIR/$BIN_NAME"
    chmod +x "$INSTALL_DIR/$BIN_NAME"
}

# ─── GitHub release install ─────────────────────────────
install_from_release() {
    info "Downloading from GitHub ($REPO @ $VERSION)..."

    local archive="$BIN_NAME-$PLATFORM.tar.gz"
    local url
    if [ "$VERSION" = "latest" ]; then
        url="https://github.com/$REPO/releases/latest/download/$archive"
    else
        url="https://github.com/$REPO/releases/download/$VERSION/$archive"
    fi

    local tmp
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT

    info "Fetching $url"
    if ! curl -fsSL "$url" -o "$tmp/$archive"; then
        err "Download failed. No release for $PLATFORM yet?"
        err "Build from source:  git clone $REPO && cd cursor-instant-noodle && ./install.sh"
        exit 1
    fi

    info "Extracting..."
    tar -xzf "$tmp/$archive" -C "$tmp"

    mkdir -p "$INSTALL_DIR"
    cp "$tmp/$BIN_NAME" "$INSTALL_DIR/$BIN_NAME"
    chmod +x "$INSTALL_DIR/$BIN_NAME"
}

# ─── Main ───────────────────────────────────────────────
print_banner
detect_platform

# Detect source checkout
SOURCE_DIR=""
if [ -f "./package.json" ] && [ -f "./bin/cursor-noodle.cjs" ]; then
    SOURCE_DIR="$(pwd)"
fi
# If run via curl|bash, also accept env var
if [ -n "$CURSOR_NOODLE_SOURCE" ] && [ -f "$CURSOR_NOODLE_SOURCE/package.json" ]; then
    SOURCE_DIR="$CURSOR_NOODLE_SOURCE"
fi

if [ -n "$SOURCE_DIR" ]; then
    install_from_source
else
    install_from_release
fi

# ─── Post-install ──────────────────────────────────────
# Ensure ~/.local/bin is on PATH (for the current session)
case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
        warn "$INSTALL_DIR is not on your PATH."
        warn "Add this to your ~/.zshrc (or ~/.bashrc):"
        printf "\n    ${BOLD}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}\n\n"
        # Try to add it automatically
        SHELL_RC="$HOME/.zshrc"
        [ ! -f "$SHELL_RC" ] && SHELL_RC="$HOME/.bashrc"
        if [ -f "$SHELL_RC" ] && ! grep -q "$INSTALL_DIR" "$SHELL_RC"; then
            if printf '\n# Cursor Instant Noodle\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$SHELL_RC"; then
                ok "Added $INSTALL_DIR to PATH in $SHELL_RC"
                warn "Run:  source $SHELL_RC"
            fi
        fi
        ;;
esac

# Verify
if command -v cursor-noodle >/dev/null 2>&1; then
    ok "Installed: $(command -v cursor-noodle)"
    printf "\n"
    cursor-noodle --version
    printf "\n"
    ok 'Done! Next: cursor-noodle setup to configure your API keys, then cursor-noodle start'
else
    ok "Installed to $INSTALL_DIR/$BIN_NAME"
    printf "\n"
    "$INSTALL_DIR/$BIN_NAME" --version
    printf "\n"
    ok 'Done! Add '"$INSTALL_DIR"' to your PATH, then run cursor-noodle setup'
fi
