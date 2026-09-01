#!/bin/bash
# Remove a git worktree and optionally its branch
#
# Usage:
#   ./scripts/worktree/cleanup.sh <feature-name> [--force|--keep-branch]
#   ./scripts/worktree/cleanup.sh --all-merged
#   ./scripts/worktree/cleanup.sh fix-auth-bug
#   ./scripts/worktree/cleanup.sh fix-auth-bug --force  # Force cleanup even if PR not merged

set -e

# Dynamic paths
# --git-common-dir, not --show-toplevel: the latter names the *current*
# worktree when run from inside one, and worktrees now nest under the main
# repo. See scripts/worktree/new.sh for the full reasoning.
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

# shellcheck source=../colors.sh
source "$MAIN_REPO/scripts/colors.sh"
WORKTREES_DIR="$MAIN_REPO/.worktrees"

# Resolve the branch a worktree is actually checked out on.
#
# NEVER derive this from the directory name. The two agree only while nobody
# renames anything: cleaning up after kindred#2666, `.worktrees/goconst-campminder`
# was on `feature/goconst-2665`, so the old `branch="feature/$name"` guess made
# --all-merged skip a merged worktree, and made the single-name form delete the
# *guessed* branch (an empty leftover from new.sh) while leaving the real one.
# Three worktrees and four branches had to be removed by hand.
#
# Prints nothing for a detached HEAD, which callers treat as "no branch".
resolve_branch() {
    local dir="$1"
    git -C "$dir" symbolic-ref --quiet --short HEAD 2>/dev/null || true
}

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
        branch=$(resolve_branch "$dir")

        if [ -z "$branch" ]; then
            echo -e "${YELLOW}Skipping $name: detached HEAD, no branch to check${NC}"
            continue
        fi

        # Only clean if a merged PR exists for the branch it is REALLY on
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

if [ ! -d "$WORKTREE_DIR" ]; then
    echo -e "${RED}Worktree not found: $WORKTREE_DIR${NC}"
    exit 1
fi

# The branch this worktree is on, which is not necessarily feature/$FEATURE_NAME.
BRANCH_NAME=$(resolve_branch "$WORKTREE_DIR")
if [ -z "$BRANCH_NAME" ]; then
    echo -e "${YELLOW}$FEATURE_NAME is on a detached HEAD; removing the worktree only${NC}"
    KEEP_BRANCH=true
elif [ "$BRANCH_NAME" != "feature/$FEATURE_NAME" ]; then
    echo -e "${BLUE}Directory $FEATURE_NAME is on branch $BRANCH_NAME${NC}"
fi

# Only allow cleanup if PR is merged (protects work-in-progress)
if [ -n "$BRANCH_NAME" ] && ! is_pr_merged "$BRANCH_NAME"; then
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
