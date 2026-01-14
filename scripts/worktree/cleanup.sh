#!/bin/bash
# Remove a git worktree and optionally its branch
#
# Usage:
#   ./scripts/worktree/cleanup.sh <feature-name> [--force|--keep-branch]
#   ./scripts/worktree/cleanup.sh --all-merged
#   ./scripts/worktree/cleanup.sh fix-auth-bug
#   ./scripts/worktree/cleanup.sh fix-auth-bug --force  # Force cleanup even if PR not merged

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

# Check if a PR for this branch was merged (the only safe heuristic)
is_pr_merged() {
    local branch="$1"
    local state
    state=$(gh pr list --head "$branch" --state merged --json state --jq '.[0].state' 2>/dev/null)
    [ "$state" = "MERGED" ]
}

# Handle --all-merged flag
if [ "$1" = "--all-merged" ]; then
    if [ ! -d "$WORKTREES_DIR" ]; then
        echo -e "${YELLOW}No worktrees directory found${NC}"
        exit 0
    fi

    MERGED_COUNT=0
    for dir in "$WORKTREES_DIR"/*/; do
        [ -d "$dir" ] || continue
        name=$(basename "$dir")
        branch="feature/$name"

        # Only clean if a merged PR exists for this branch
        if is_pr_merged "$branch"; then
            echo -e "${GREEN}Cleaning up merged worktree: $name${NC}"
            "$0" "$name"
            ((MERGED_COUNT++)) || true
        fi
    done

    if [ "$MERGED_COUNT" -eq 0 ]; then
        echo -e "${YELLOW}No merged worktrees to clean up${NC}"
        echo -e "Worktrees are only auto-cleaned when their PR is merged on GitHub"
    else
        echo -e "${GREEN}Cleaned up $MERGED_COUNT worktree(s)${NC}"
    fi
    exit 0
fi

FEATURE_NAME="${1:-}"
KEEP_BRANCH=false
[ "$2" = "--keep-branch" ] && KEEP_BRANCH=true

if [ -z "$FEATURE_NAME" ]; then
    echo -e "${RED}Usage: $0 <feature-name> [--force|--keep-branch]${NC}"
    echo -e "       $0 --all-merged"
    echo -e ""
    echo -e "Cleanup only works after the PR is merged (use --force to override)"
    echo -e ""
    echo -e "Active worktrees:"
    if [ -d "$WORKTREES_DIR" ]; then
        found=false
        for dir in "$WORKTREES_DIR"/*/; do
            [ -d "$dir" ] || continue
            found=true
            echo -e "  $(basename "$dir")"
        done
        [ "$found" = false ] && echo -e "  (none)"
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

# Only allow cleanup if PR is merged (protects work-in-progress)
if ! is_pr_merged "$BRANCH_NAME"; then
    echo -e "${RED}Cannot clean up: PR for $BRANCH_NAME is not merged${NC}"
    echo -e "Push your branch and merge the PR first, or use --force to override"
    [ "$2" = "--force" ] || exit 1
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

# Remove branch (we already verified PR is merged)
if [ "$KEEP_BRANCH" = false ]; then
    echo -e "${BLUE}Removing branch: $BRANCH_NAME${NC}"
    git branch -D "$BRANCH_NAME" 2>/dev/null || true
fi

echo -e "${GREEN}Cleanup complete${NC}"
