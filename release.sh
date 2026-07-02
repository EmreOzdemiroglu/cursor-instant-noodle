#!/usr/bin/env bash
# release.sh — Build platform binaries and create a GitHub release
#
# Usage:
#   ./release.sh                        # build all + create draft release
#   ./release.sh v1.2.3                 # tag + release with this version
#   ./release.sh v1.2.3 --no-publish    # build only, don't push
#
# Requires: bun, gh (GitHub CLI, authenticated)

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${CYAN}→${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${RESET} %s\n" "$*"; }
err()   { printf "${RED}✗${RESET} %s\n" "$*" >&2; }

VERSION="${1:-}"
PUBLISH=true
[ "${2:-}" = "--no-publish" ] && PUBLISH=false

# Get version from package.json if not provided
if [ -z "$VERSION" ]; then
    VERSION=$(grep '"version"' package.json | head -1 | sed -E 's/.*"version":\s*"([^"]+)".*/\1/')
    info "Using version from package.json: v$VERSION"
fi

# Strip leading 'v' if present
VERSION="${VERSION#v}"

# ─── Prereqs ──────────────────────────────────────────
for cmd in bun gh; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        err "$cmd is required. Install: https://bun.sh and https://cli.github.com"
        exit 1
    fi
done

# ─── Clean & build ────────────────────────────────────
info "Cleaning dist/"
rm -rf dist
mkdir -p dist

PLATFORMS=(
    "bun-darwin-arm64:cursor-noodle-macos-arm64.tar.gz"
    "bun-darwin-x64:cursor-noodle-macos-x64.tar.gz"
    "bun-linux-x64:cursor-noodle-linux-x64.tar.gz"
    "bun-linux-arm64:cursor-noodle-linux-arm64.tar.gz"
)

for entry in "${PLATFORMS[@]}"; do
    target="${entry%%:*}"
    archive="${entry##*:}"
    binname="${archive%.tar.gz}"
    info "Building $target → dist/$binname"
    bun build --compile --target="$target" --outfile="dist/$binname" bin/cursor-noodle.cjs

    # Tar with the binary at the root (matches what install.sh extracts)
    info "Packaging dist/$archive"
    (cd dist && tar -czf "$archive" "$binname")
done

# ─── Checksums ────────────────────────────────────────
info "Generating SHA256SUMS"
(cd dist && shasum -a 256 *.tar.gz > SHA256SUMS)
ok "Built $(ls dist/*.tar.gz | wc -l | tr -d ' ') binaries + checksums"

# ─── Publish ──────────────────────────────────────────
if [ "$PUBLISH" = false ]; then
    ok "Build only mode (--no-publish). Artifacts in dist/"
    exit 0
fi

# Tag if not already
if ! git rev-parse "v$VERSION" >/dev/null 2>&1; then
    info "Tagging v$VERSION"
    git tag -a "v$VERSION" -m "Release v$VERSION"
    git push origin "v$VERSION"
else
    warn "Tag v$VERSION already exists"
fi

# Create release
info "Creating GitHub release v$VERSION"
gh release create "v$VERSION" \
    --title "v$VERSION" \
    --generate-notes \
    dist/*.tar.gz \
    dist/SHA256SUMS

ok "Released v$VERSION"
echo
warn "Users can now install with:"
echo "  ${BOLD}curl -fsSL https://raw.githubusercontent.com/\$REPO/main/install.sh | bash${RESET}"
