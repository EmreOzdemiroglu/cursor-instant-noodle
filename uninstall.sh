#!/usr/bin/env bash
# uninstall.sh — Remove Cursor Instant Noodle
#
# Removes:
#   - The cursor-noodle binary from $HOME/.local/bin (or /usr/local/bin)
#   - npm global link if present
#   - PATH line from ~/.zshrc / ~/.bashrc
#   - Local state files (.env, .cursor-noodle.pid, .cursor-noodle.log)
#
# Does NOT remove:
#   - The repo directory itself
#   - Your ~/.codex / ~/.config/opencode / etc. (those are external CLIs)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${CYAN}→${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${RESET} %s\n" "$*"; }

# Stop the service if running
DATA_DIR="$HOME/.cursor-noodle"
if [ -f "$DATA_DIR/.cursor-noodle.pid" ]; then
    pid=$(cat "$DATA_DIR/.cursor-noodle.pid")
    if kill -0 "$pid" 2>/dev/null; then
        info "Stopping running service (pid $pid)..."
        kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
        sleep 1
    fi
fi

# Find and remove the binary
for dir in "$HOME/.local/bin" "/usr/local/bin" "/opt/homebrew/bin"; do
    if [ -f "$dir/cursor-noodle" ]; then
        info "Removing $dir/cursor-noodle"
        rm -f "$dir/cursor-noodle"
    fi
done

# Remove npm package if present
if command -v npm >/dev/null 2>&1; then
    info "Removing npm package..."
    npm uninstall -g cursor-instant-noodle 2>/dev/null || true
fi

# Clean up the persistent data dir (~/.cursor-noodle)
if [ -d "$DATA_DIR" ]; then
    info "Removing data dir $DATA_DIR"
    rm -rf "$DATA_DIR"
fi

# Legacy: clean up old in-project state files (pre-0.0.2 used the package dir)
for f in .env .env.bak .cursor-noodle.pid .cursor-noodle.log debug_req.log debug_traffic.log; do
    if [ -f "./$f" ]; then
        info "Removing ./$f"
        rm -f "./$f"
    fi
done

# Remove from PATH in shell rc files
for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    if [ -f "$rc" ] && grep -q "Cursor Instant Noodle" "$rc"; then
        info "Cleaning $rc"
        # Remove the lines we added (between markers, or the specific lines)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' '/# Cursor Instant Noodle/,+1d' "$rc" 2>/dev/null || true
        else
            sed -i '/# Cursor Instant Noodle/,+1d' "$rc" 2>/dev/null || true
        fi
    fi
done

ok "Uninstall complete."
warn "The Cursor Instant Noodle directory itself was NOT removed. Delete it manually if you want."
