#!/bin/bash
# Remove a git worktree and optionally its branch
#
# Usage:
#   ./scripts/worktree/cleanup.sh <feature-name> [--keep-branch]
#   ./scripts/worktree/cleanup.sh fix-auth-bug
#   ./scripts/worktree/cleanup.sh fix-auth-bug --keep-branch

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Dynamic paths
MAIN_REPO="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$MAIN_REPO")"
REPO_PARENT="$(dirname "$MAIN_REPO")"
WORKTREES_DIR="$REPO_PARENT/${REPO_NAME}-worktrees"

FEATURE_NAME="${1:-}"
KEEP_BRANCH=false
[ "$2" = "--keep-branch" ] && KEEP_BRANCH=true

if [ -z "$FEATURE_NAME" ]; then
    echo -e "${RED}Usage: $0 <feature-name> [--keep-branch]${NC}"
    echo -e ""
    echo -e "Active worktrees:"
    if [ -d "$WORKTREES_DIR" ]; then
        ls -1 "$WORKTREES_DIR" 2>/dev/null | sed 's/^/  /'
    else
        echo -e "  (none)"
    fi
    exit 1
fi

WORKTREE_DIR="$WORKTREES_DIR/$FEATURE_NAME"
BRANCH_NAME="feature/$FEATURE_NAME"

if [ ! -d "$WORKTREE_DIR" ]; then
    echo -e "${RED}Worktree not found: $WORKTREE_DIR${NC}"
    exit 1
fi

echo -e "${YELLOW}Cleaning up worktree: $FEATURE_NAME${NC}"

# Kill any processes using worktree ports
if [ -f "$WORKTREE_DIR/.env" ]; then
    source "$WORKTREE_DIR/.env"
    for port in ${POCKETBASE_PORT:-} ${FASTAPI_PORT:-} ${CADDY_PORT:-} ${VITE_PORT:-}; do
        [ -n "$port" ] && lsof -ti:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
    done
fi

# Remove worktree
echo -e "${BLUE}Removing worktree...${NC}"
cd "$MAIN_REPO"
git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || rm -rf "$WORKTREE_DIR"

# Remove branch if not keeping and if merged
if [ "$KEEP_BRANCH" = false ]; then
    if git branch --merged main | grep -q "$BRANCH_NAME"; then
        echo -e "${BLUE}Removing merged branch: $BRANCH_NAME${NC}"
        git branch -d "$BRANCH_NAME" 2>/dev/null || true
    else
        echo -e "${YELLOW}Branch not merged to main, keeping: $BRANCH_NAME${NC}"
        echo -e "To force delete: git branch -D $BRANCH_NAME"
    fi
fi

echo -e "${GREEN}Cleanup complete${NC}"
