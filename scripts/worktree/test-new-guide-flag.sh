#!/bin/bash
# Tests for the optional --guide flag of new.sh.
# Run: bash scripts/worktree/test-new-guide-flag.sh
#
# new.sh finds its repo from the current directory, so every case runs it
# inside a throwaway repo. A regression that stops failing fast then builds
# its worktree there, and the trap deletes it -- never in the real checkout.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NEW_SH="$ROOT/scripts/worktree/new.sh"
FAILED=0

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# A git hook exports GIT_DIR and friends, which would point every git call
# below at the real repository instead of the scratch one.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_COMMON_DIR
# And a regression must not copy private config into the scratch tree.
export KINDRED_LOCAL_PATH="$SCRATCH/no-private-config"
REPO="$SCRATCH/repo"
mkdir -p "$REPO/scripts"
cp "$ROOT/scripts/colors.sh" "$REPO/scripts/"
git -C "$REPO" init -q -b main
git -C "$REPO" add scripts/colors.sh
git -C "$REPO" -c user.name=t -c user.email=t@example.test -c commit.gpgsign=false commit -q -m seed

fail() { echo "FAIL: $1"; FAILED=1; }
pass() { echo "PASS: $1"; }

# Runs new.sh in the scratch repo; sets $out and $code.
run_new() {
    out=$(cd "$REPO" && "$@" 2>&1)
    code=$?
}

# Asserts exit 1, the message, and that no worktree or branch was made for $1.
expect_refused() {
    local name="$1" expected="$2" label="$3"
    if [ "$code" -eq 1 ]; then pass "$label: exit 1"; else fail "$label: expected exit 1, got $code"; fi
    if printf '%s' "$out" | grep -qF -- "$expected"; then pass "$label: message"; else fail "$label: message missing: $out"; fi
    if [ ! -e "$REPO/.worktrees/$name" ]; then pass "$label: no worktree"; else fail "$label: worktree was created"; fi
    if git -C "$REPO" rev-parse --verify -q "refs/heads/feature/$name" >/dev/null; then
        fail "$label: branch was created"
    else
        pass "$label: no branch"
    fi
}

# (a) --guide without KINDRED_GUIDE_DIR fails fast, before anything is created.
run_new env -u KINDRED_GUIDE_DIR bash "$NEW_SH" scratch-a --guide
expect_refused scratch-a '--guide needs KINDRED_GUIDE_DIR set to your guide checkout' "unset dir"

# (b) the guide is located only through KINDRED_GUIDE_DIR.
if [ "$(grep -c 'KINDRED_GUIDE_DIR' "$NEW_SH")" -ge 1 ]; then pass "new.sh reads KINDRED_GUIDE_DIR"; else fail "new.sh never mentions KINDRED_GUIDE_DIR"; fi

# (c) a KINDRED_GUIDE_DIR that is not a git checkout also fails fast.
mkdir -p "$SCRATCH/not-a-repo"
run_new env KINDRED_GUIDE_DIR="$SCRATCH/not-a-repo" bash "$NEW_SH" scratch-c --guide
expect_refused scratch-c 'KINDRED_GUIDE_DIR is not a git checkout' "non-git dir"

# (d) a flag where the feature name belongs is refused, not used as the name.
run_new env -u KINDRED_GUIDE_DIR bash "$NEW_SH" --guide
expect_refused --guide 'Usage:' "flag as name"

exit "$FAILED"
