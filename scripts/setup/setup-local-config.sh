#!/usr/bin/env bash
# Setup local config by symlinking from kindred-local private repo
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCAL_REPO="${KINDRED_LOCAL_PATH:-$HOME/kindred-local}"

if [[ ! -d "$LOCAL_REPO" ]]; then
    echo "kindred-local repo not found at $LOCAL_REPO"
    echo "Clone it: git clone git@github.com:adamflagg/kindred-local.git $LOCAL_REPO"
    exit 1
fi

echo "Linking local config from $LOCAL_REPO..."

# Single files (use -r for relative symlinks, works in any directory layout)
ln -sfr "$LOCAL_REPO/CLAUDE.local.md" "$REPO_ROOT/CLAUDE.local.md"
ln -sfr "$LOCAL_REPO/config/branding.local.json" "$REPO_ROOT/config/branding.local.json"
ln -sfr "$LOCAL_REPO/config/staff_list.json" "$REPO_ROOT/config/staff_list.json"
ln -sfr "$LOCAL_REPO/config/sheets_sharing.local.json" "$REPO_ROOT/config/sheets_sharing.local.json"
ln -sfr "$LOCAL_REPO/frontend/vite.config.local.ts" "$REPO_ROOT/frontend/vite.config.local.ts"
ln -sfr "$LOCAL_REPO/scripts/vault.config" "$REPO_ROOT/scripts/vault.config"

# Directories - remove existing dirs first to properly symlink
rm -rf "$REPO_ROOT/docs/camp" "$REPO_ROOT/local"
ln -sfrn "$LOCAL_REPO/docs/camp" "$REPO_ROOT/docs/camp"
ln -sfrn "$LOCAL_REPO/local" "$REPO_ROOT/local"

echo "Linked local config files"
