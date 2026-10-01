#!/bin/bash
# Report -- and with --apply, delete -- stale local git refs that cannot hold lost work.
#
# Usage:
#   scripts/git-tidy.sh                 # dry run: what is safe, what needs a look
#   scripts/git-tidy.sh --apply         # delete the "safe" list only
#   scripts/git-tidy.sh --notice        # post-merge hook: silent unless there is something
#   scripts/git-tidy.sh --grace-days N  # default 14; younger refs are not considered
#
# THE RULE. A ref is deletable only when nothing on it can be lost:
#   - its tip is already on origin/main, or
#   - its tip is contained in the head of a MERGED or CLOSED PR -- GitHub keeps
#     those commits under refs/pull/N/head after the branch itself is gone.
# Age and PR state alone are never enough. The 2026-09-30 sweep found a test
# commit pushed one minute AFTER kindred#2486 squash-merged: on the branch and
# nowhere else. "PR merged, branch is old" would have deleted it; containment
# keeps it and reports it.
#
# Considered: refs/heads/* (never main, never a branch a worktree has checked
# out), refs/backup/*, and refs/remotes/<name>/* for a <name> that is not a
# configured remote (ad-hoc `git fetch origin pull/N/head:refs/remotes/pr/N`
# leftovers -- nothing else ever prunes them). Configured remotes are left to
# `git fetch --prune`, which a manual run does first.
#
# Stashes are never dropped: they are shared by every worktree, so one agent's
# old stash may be another's parked work. Old ones are listed with their files.
#
# Every SHA is appended to <git-common-dir>/git-tidy-recovery.log (the main
# clone's .git) BEFORE its ref is deleted; a ref whose line cannot be written is
# not deleted. `git branch <name> <sha>` restores one while the commit is still
# local -- once nothing references it, gc prunes it after gc.pruneExpire (2 weeks
# by default). A ref deleted as safe by a PR can always be re-fetched with
# `git fetch origin refs/pull/N/head`.

set -uo pipefail

APPLY=0
NOTICE=0
GRACE_DAYS=14
BASE=origin/main

# The hook must never fail a pull: in notice mode every exit is 0. NOTICE is
# found before parsing, so an argument error is covered whatever its position.
for arg in "$@"; do
    [ "$arg" = --notice ] && NOTICE=1
done
die() { echo "git-tidy: $*" >&2; [ "$NOTICE" -eq 1 ] && exit 0; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --apply) APPLY=1 ;;
        --notice) ;;
        --grace-days)
            [[ "${2:-}" =~ ^[0-9]+$ ]] || die "--grace-days needs a whole number of days"
            GRACE_DAYS="$2"; shift ;;
        -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
    shift
done
# The hook path reports; deleting is only ever a deliberate manual run.
[ "$NOTICE" -eq 1 ] && [ "$APPLY" -eq 1 ] && die "--notice only reports; run --apply on its own"

git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"
for tool in gh jq; do
    command -v "$tool" >/dev/null || die "$tool is required"
done
git rev-parse --verify --quiet "$BASE" >/dev/null || die "$BASE not found"
COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
RECOVERY_LOG="$COMMON_DIR/git-tidy-recovery.log"

# A post-merge hook usually follows a fetch; a manual run should see current
# state. A stale origin/main only keeps more, it never deletes more.
[ "$NOTICE" -eq 1 ] || git fetch -q --prune origin 2>/dev/null || true

CUTOFF=$(( $(date +%s) - GRACE_DAYS * 86400 ))
HELD=" $(git worktree list --porcelain | awk '/^branch /{printf "%s ", $2}')"
REMOTES=" $(git remote | tr '\n' ' ')"

display() {
    case "$1" in
        refs/heads/*) echo "${1#refs/heads/}" ;;
        *) echo "$1" ;;
    esac
}

# gh_prs <ref> <sha> -> JSON array of {number,state,headRefOid}; nonzero if GitHub
# could not be asked. A failed lookup is "unknown", never "no PR".
gh_prs() {
    local ref="$1" sha="$2" by_head="[]" by_sha
    if [[ "$ref" == refs/heads/* ]]; then
        by_head=$(gh pr list --state all --head "${ref#refs/heads/}" \
            --json number,state,headRefOid 2>/dev/null) || return 1
    fi
    by_sha=$(gh pr list --state all --search "$sha" \
        --json number,state,headRefOid 2>/dev/null) || return 1
    printf '%s\n%s\n' "$by_head" "$by_sha" | jq -sc 'add | unique_by(.number)'
}

# judge <ref> <sha> -> prints "safe <reason>", "keep <reason>" or "skip"
judge() {
    local ref="$1" sha="$2" prs number state head
    if git merge-base --is-ancestor "$sha" "$BASE" 2>/dev/null; then
        echo "safe on main"; return
    fi
    if ! prs=$(gh_prs "$ref" "$sha"); then
        echo "keep GitHub unreachable -- could not check for a PR"; return
    fi
    if [ "$(jq '[.[] | select(.state == "OPEN")] | length' <<<"$prs")" -gt 0 ]; then
        echo "skip"; return  # an open PR is someone's current work
    fi
    while read -r number state head; do
        [ -n "$number" ] || continue
        if ! git cat-file -e "$head^{commit}" 2>/dev/null; then
            git fetch -q origin "refs/pull/$number/head" 2>/dev/null || continue
        fi
        if git merge-base --is-ancestor "$sha" "$head" 2>/dev/null; then
            echo "safe in $(tr '[:upper:]' '[:lower:]' <<<"$state") PR #$number"; return
        fi
    done < <(jq -r '.[] | "\(.number) \(.state) \(.headRefOid)"' <<<"$prs")
    if [ "$(jq length <<<"$prs")" -gt 0 ]; then
        echo "keep has commits its PR #$(jq -r '.[0].number' <<<"$prs") never had (pushed after it closed?)"
    else
        echo "keep commits not on main and in no PR"
    fi
}

SAFE=()
KEEP=()
while read -r ref sha ts; do
    case "$ref" in
        refs/heads/main) continue ;;
        refs/remotes/*)
            remote="${ref#refs/remotes/}"; remote="${remote%%/*}"
            [[ "$REMOTES" == *" $remote "* ]] && continue ;;
    esac
    [[ "$HELD" == *" $ref "* ]] && continue
    [ "$ts" -lt "$CUTOFF" ] || continue

    verdict=$(judge "$ref" "$sha")
    case "$verdict" in
        safe\ *) SAFE+=("$ref $sha ${verdict#safe }") ;;
        keep\ *) KEEP+=("$ref $sha ${verdict#keep }") ;;
    esac
done < <(git for-each-ref --format='%(refname) %(objectname) %(committerdate:unix)' \
    refs/heads refs/backup refs/remotes)

STASHES=()
while read -r sel ts subject; do
    [ -n "$sel" ] && [ "$ts" -lt "$CUTOFF" ] || continue
    files=$(git stash show --name-only "$sel" 2>/dev/null | head -3 | paste -sd, -)
    STASHES+=("$sel $(date -d "@$ts" +%F) $subject ($files)")
done < <(git stash list --format='%gd %ct %gs')

total=$(( ${#SAFE[@]} + ${#KEEP[@]} + ${#STASHES[@]} ))
if [ "$total" -eq 0 ]; then
    [ "$NOTICE" -eq 1 ] || echo "git-tidy: nothing older than $GRACE_DAYS days to report."
    exit 0
fi

echo ""
echo "Stale git refs (older than $GRACE_DAYS days) -- scripts/git-tidy.sh"
if [ ${#SAFE[@]} -gt 0 ]; then
    echo ""
    echo "Safe to delete (${#SAFE[@]}) -- every commit is on main or in a merged/closed PR:"
    for row in "${SAFE[@]}"; do
        read -r ref _ reason <<<"$row"
        printf '  %-48s %s\n' "$(display "$ref")" "$reason"
    done
fi
if [ ${#KEEP[@]} -gt 0 ]; then
    echo ""
    echo "Kept -- needs a look (${#KEEP[@]}) -- holds commits that may exist nowhere else."
    echo "Audit before removing; never delete one of these on age alone:"
    for row in "${KEEP[@]}"; do
        read -r ref _ reason <<<"$row"
        printf '  %-48s %s\n' "$(display "$ref")" "$reason"
    done
fi
if [ ${#STASHES[@]} -gt 0 ]; then
    echo ""
    echo "Old stashes (${#STASHES[@]}) -- shared by every worktree, never dropped automatically:"
    for row in "${STASHES[@]}"; do
        echo "  $row"
    done
fi

if [ "$APPLY" -eq 0 ]; then
    if [ ${#SAFE[@]} -gt 0 ]; then
        echo ""
        echo "Run: scripts/git-tidy.sh --apply   (deletes only the safe list; SHAs logged to $RECOVERY_LOG)"
    fi
    echo ""
    exit 0
fi

echo ""
for row in "${SAFE[@]}"; do
    read -r ref sha reason <<<"$row"
    # Judging made network calls; a ref that moved since holds commits nobody judged.
    if [ "$(git rev-parse -q --verify "$ref")" != "$sha" ]; then
        echo "skipped $(display "$ref") -- it moved after it was judged"; continue
    fi
    # Record first: a deletion the recovery log cannot hold does not happen.
    if ! { echo "$(date -u +%FT%TZ) $sha $ref  # $reason" >>"$RECOVERY_LOG"; } 2>/dev/null; then
        echo "skipped $(display "$ref") -- could not write $RECOVERY_LOG" >&2; continue
    fi
    if [[ "$ref" == refs/heads/* ]]; then
        git branch -q -D "${ref#refs/heads/}" || continue
    else
        git update-ref -d "$ref" "$sha" || continue
    fi
    echo "deleted $(display "$ref")"
done
echo "Recovery SHAs: $RECOVERY_LOG"
echo ""
