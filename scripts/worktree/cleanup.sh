#!/bin/bash
# Remove a git worktree and optionally its branch
#
# Usage:
#   ./scripts/worktree/cleanup.sh <feature-name> [--force|--keep-branch]
#   ./scripts/worktree/cleanup.sh --all-merged
#   ./scripts/worktree/cleanup.sh fix-auth-bug
#   ./scripts/worktree/cleanup.sh fix-auth-bug --force  # Force cleanup even if PR not merged
#
# If KINDRED_GUIDE_DIR names a staff-guide checkout holding a paired worktree
# (made by `new.sh <name> --guide`) at $KINDRED_GUIDE_DIR/.worktrees/<name>, it
# is removed too, for the single-name form and for each worktree --all-merged
# removes. The guide BRANCH is kept: it is the paired PR's branch. A guide
# worktree with uncommitted changes is left in place with a warning (those are
# docs edits), unless --force is given. A guide-side failure only prints a
# warning; it never fails the kindred cleanup.

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
#
# .lefthook.yml's post-merge worktree-cleanup notifier resolves the branch
# the same way and must stay in step; tests/unit/scripts/test_worktree_cleanup.py
# fails if either side drifts.
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

# Remove the paired guide worktree new.sh --guide made, if there is one.
# Silent when KINDRED_GUIDE_DIR is unset or holds no such registered worktree.
# Never deletes the guide branch, never rm -rf, never fails the caller.
# Uncommitted guide edits are kept unless $2 is "--force".
remove_guide_worktree() {
    local name="$1" force="${2:-}" gdir="${KINDRED_GUIDE_DIR:-}" gwt real
    [ -n "$gdir" ] || return 0
    (
        # A different repo: an inherited GIT_DIR & co. would override every -C below.
        unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX
        git -C "$gdir" rev-parse --git-dir >/dev/null 2>&1 || exit 0
        gwt="$gdir/.worktrees/$name"
        [ -d "$gwt" ] || exit 0
        real="$(cd "$gwt" 2>/dev/null && pwd -P)" || exit 0
        git -C "$gdir" worktree list --porcelain 2>/dev/null | grep -qxF "worktree $real" || exit 0
        local -a rm_args=()
        if [ "$force" = "--force" ]; then
            rm_args=(--force)
        elif [ -n "$(git -C "$real" status --porcelain 2>/dev/null)" ]; then
            echo -e "${YELLOW}Warning: guide worktree for $name has uncommitted changes; left in place${NC}"
            exit 0
        fi
        if git -C "$gdir" worktree remove "${rm_args[@]}" "$real" >/dev/null 2>&1; then
            echo -e "${BLUE}Removed paired guide worktree: $name (branch kept)${NC}"
        else
            echo -e "${YELLOW}Warning: could not remove the paired guide worktree for $name${NC}"
        fi
    ) || true
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
    # No branch means no PR to look up, so the merged-PR gate below cannot run
    # at all. Refuse rather than fall through to the removal: a detached HEAD is
    # the WORST case for `git worktree remove --force`, because its commits are
    # reachable from nothing else and removing the worktree takes its reflog
    # with it. Demand --force here exactly as the unmerged-branch case does --
    # the old directory-guessing script refused by accident (`feature/$1` had no
    # merged PR), and resolving the branch properly must not turn that accident
    # into a silent deletion.
    echo -e "${YELLOW}$FEATURE_NAME is on a detached HEAD; no branch, so no PR to check${NC}"
    KEEP_BRANCH=true
    if [ "$2" != "--force" ]; then
        echo -e "${RED}Cannot clean up: refusing to remove a detached worktree without --force${NC}"
        echo -e "Commit onto a branch and merge its PR first, or use --force to override"
        exit 1
    fi
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
remove_guide_worktree "$FEATURE_NAME" "${2:-}"

# Remove branch (the merged-PR gate above passed, or --force overrode it)
if [ "$KEEP_BRANCH" = false ]; then
    echo -e "${BLUE}Removing branch: $BRANCH_NAME${NC}"
    git branch -D "$BRANCH_NAME" 2>/dev/null || true
fi

echo -e "${GREEN}Cleanup complete${NC}"
