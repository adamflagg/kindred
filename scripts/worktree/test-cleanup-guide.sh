#!/bin/bash
# Tests for cleanup.sh's removal of the paired guide worktree (see new.sh --guide).
# Run: bash scripts/worktree/test-cleanup-guide.sh
#
# cleanup.sh finds its repo from the current directory's git common dir, so each
# case runs a COPY of it inside a throwaway repo, with a stub `gh` that reports
# every PR as merged. Nothing here touches the real checkout or any real guide
# checkout.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FAILED=0

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# A git hook exports GIT_DIR and friends, which would point every git call
# below at the real repository instead of the scratch one.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

mkdir -p "$SCRATCH/bin"
printf '#!/bin/sh\necho MERGED\n' > "$SCRATCH/bin/gh"
chmod +x "$SCRATCH/bin/gh"
export PATH="$SCRATCH/bin:$PATH"

fail() { echo "FAIL: $1"; FAILED=1; }
pass() { echo "PASS: $1"; }
g() { git -c user.name=t -c user.email=t@example.test -c commit.gpgsign=false "$@"; }

# make_case <dir> <name...>: a kindred-like main repo plus a guide repo, each
# with a worktree on feature/<name> for every name given.
make_case() {
    local dir="$1" name
    shift
    MAIN="$dir/main"
    GUIDE="$dir/guide"
    mkdir -p "$MAIN/scripts/worktree" "$GUIDE"
    cp "$ROOT/scripts/colors.sh" "$MAIN/scripts/"
    cp "$ROOT/scripts/worktree/cleanup.sh" "$MAIN/scripts/worktree/"
    git -C "$MAIN" init -q -b main
    git -C "$MAIN" add scripts
    g -C "$MAIN" commit -q -m seed
    git -C "$GUIDE" init -q -b main
    g -C "$GUIDE" commit -q --allow-empty -m seed
    for name in "$@"; do
        git -C "$MAIN" worktree add -q "$MAIN/.worktrees/$name" -b "feature/$name"
        git -C "$GUIDE" worktree add -q "$GUIDE/.worktrees/$name" -b "feature/$name"
        # Mirrors new.sh --guide: a symlink into the kindred worktree.
        ln -s "$MAIN/.worktrees/$name/facts.json" "$GUIDE/.worktrees/$name/facts.json"
    done
}

# Runs cleanup.sh from the scratch main repo; sets $out and $code.
run_cleanup() {
    out=$(cd "$MAIN" && "$@" 2>&1)
    code=$?
}

# (a) single name: guide worktree removed, guide branch kept, kindred cleaned.
make_case "$SCRATCH/a" one
run_cleanup env KINDRED_GUIDE_DIR="$GUIDE" bash "$MAIN/scripts/worktree/cleanup.sh" one
if [ "$code" -eq 0 ]; then pass "a: exit 0"; else fail "a: exit $code: $out"; fi
if [ ! -e "$GUIDE/.worktrees/one" ]; then pass "a: guide worktree removed"; else fail "a: guide worktree remains"; fi
if git -C "$GUIDE" worktree list --porcelain | grep -qF ".worktrees/one"; then fail "a: still registered"; else pass "a: guide worktree unregistered"; fi
if git -C "$GUIDE" show-ref --verify -q refs/heads/feature/one; then pass "a: guide branch kept"; else fail "a: guide branch deleted"; fi
if [ ! -e "$MAIN/.worktrees/one" ]; then pass "a: kindred worktree removed"; else fail "a: kindred worktree remains"; fi
if git -C "$MAIN" show-ref --verify -q refs/heads/feature/one; then fail "a: kindred branch kept"; else pass "a: kindred branch removed"; fi

# (b) KINDRED_GUIDE_DIR unset: the guide worktree is untouched, no noise.
make_case "$SCRATCH/b" two
run_cleanup env -u KINDRED_GUIDE_DIR bash "$MAIN/scripts/worktree/cleanup.sh" two
if [ "$code" -eq 0 ]; then pass "b: exit 0"; else fail "b: exit $code: $out"; fi
if [ -e "$GUIDE/.worktrees/two" ]; then pass "b: guide worktree untouched"; else fail "b: guide worktree removed"; fi
if printf '%s' "$out" | grep -qi 'guide'; then fail "b: mentions guide: $out"; else pass "b: silent about guide"; fi

# (c) a guide checkout with no matching worktree: silent, exit 0.
make_case "$SCRATCH/c" three
git -C "$GUIDE" worktree remove --force "$GUIDE/.worktrees/three"
run_cleanup env KINDRED_GUIDE_DIR="$GUIDE" bash "$MAIN/scripts/worktree/cleanup.sh" three
if [ "$code" -eq 0 ]; then pass "c: exit 0"; else fail "c: exit $code: $out"; fi
if printf '%s' "$out" | grep -qi 'warn'; then fail "c: warned: $out"; else pass "c: no warning"; fi

# (d) guide removal fails (locked worktree): one warning line, kindred cleanup
# still done, exit 0, guide worktree and branch left in place.
make_case "$SCRATCH/d" four
git -C "$GUIDE" worktree lock "$GUIDE/.worktrees/four"
run_cleanup env KINDRED_GUIDE_DIR="$GUIDE" bash "$MAIN/scripts/worktree/cleanup.sh" four
if [ "$code" -eq 0 ]; then pass "d: exit 0"; else fail "d: exit $code: $out"; fi
if [ "$(printf '%s\n' "$out" | grep -ci 'warning.*guide')" -eq 1 ]; then pass "d: one warning line"; else fail "d: warning missing or repeated: $out"; fi
if [ ! -e "$MAIN/.worktrees/four" ]; then pass "d: kindred worktree removed"; else fail "d: kindred worktree remains"; fi
if [ -e "$GUIDE/.worktrees/four" ]; then pass "d: guide worktree left"; else fail "d: guide worktree gone"; fi

# (e) --all-merged cleans the guide side of every kindred worktree it removes.
make_case "$SCRATCH/e" five six
run_cleanup env KINDRED_GUIDE_DIR="$GUIDE" bash "$MAIN/scripts/worktree/cleanup.sh" --all-merged
if [ "$code" -eq 0 ]; then pass "e: exit 0"; else fail "e: exit $code: $out"; fi
for n in five six; do
    if [ ! -e "$GUIDE/.worktrees/$n" ]; then pass "e: guide $n removed"; else fail "e: guide $n remains"; fi
    if git -C "$GUIDE" show-ref --verify -q "refs/heads/feature/$n"; then pass "e: guide branch $n kept"; else fail "e: guide branch $n deleted"; fi
done

exit "$FAILED"
