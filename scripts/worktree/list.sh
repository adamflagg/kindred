#!/bin/bash
# List active worktrees with their status
#
# Usage: ./scripts/worktree/list.sh

# --git-common-dir, not --show-toplevel: the latter names the *current*
# worktree when run from inside one, and worktrees now nest under the main
# repo. See scripts/worktree/new.sh for the full reasoning.
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

# shellcheck source=../colors.sh
source "$MAIN_REPO/scripts/colors.sh"
WORKTREES_DIR="$MAIN_REPO/.worktrees"

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
