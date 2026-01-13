#!/bin/bash
# List active worktrees with their status
#
# Usage: ./scripts/worktree/list.sh

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

MAIN_REPO="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$MAIN_REPO")"
REPO_PARENT="$(dirname "$MAIN_REPO")"
WORKTREES_DIR="$REPO_PARENT/${REPO_NAME}-worktrees"

echo -e "${GREEN}=== Git Worktrees ===${NC}"
echo -e ""

# Main repo
echo -e "${BLUE}Main:${NC} $MAIN_REPO"
echo -e "      Branch: $(git -C "$MAIN_REPO" branch --show-current)"
echo -e ""

# Feature worktrees (only count directories, not README.md)
WORKTREE_COUNT=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [ "$WORKTREE_COUNT" -gt 0 ]; then
    echo -e "${BLUE}Feature Worktrees:${NC}"
    for dir in "$WORKTREES_DIR"/*/; do
        [ -d "$dir" ] || continue
        name=$(basename "$dir")
        branch=$(git -C "$dir" branch --show-current 2>/dev/null || echo "detached")

        # Check if running (look for port in .env)
        status="${RED}stopped${NC}"
        if [ -f "$dir/.env" ]; then
            source "$dir/.env"
            if [ -n "$POCKETBASE_PORT" ] && lsof -ti:$POCKETBASE_PORT >/dev/null 2>&1; then
                status="${GREEN}running${NC}"
            fi
        fi

        # Port info
        ports=""
        [ -n "$VITE_PORT" ] && ports="Vite:$VITE_PORT"
        [ -n "$CADDY_PORT" ] && ports="$ports Caddy:$CADDY_PORT"

        echo -e "  ${YELLOW}$name${NC} [$status]"
        echo -e "      Branch: $branch"
        echo -e "      Path: $dir"
        [ -n "$ports" ] && echo -e "      Ports: $ports"
        echo -e ""
    done
else
    echo -e "${YELLOW}No feature worktrees active${NC}"
    echo -e ""
    echo -e "Create one with: ./scripts/worktree/new.sh <feature-name>"
fi
