#!/bin/bash
# Tests for the optional --guide flag of new.sh.
# Run: bash scripts/worktree/test-new-guide-flag.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAIN_REPO="$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")"
NEW_SH="$ROOT/scripts/worktree/new.sh"
FAILED=0
SCRATCH="guide-flag-scratch-$$"

fail() { echo "FAIL: $1"; FAILED=1; }
pass() { echo "PASS: $1"; }

# (a) --guide without KINDRED_GUIDE_DIR fails fast, before anything is created.
out=$(env -u KINDRED_GUIDE_DIR bash "$NEW_SH" "$SCRATCH" --guide 2>&1)
code=$?
expected='--guide needs KINDRED_GUIDE_DIR set to your guide checkout'
if [ "$code" -eq 1 ]; then pass "exit 1 when KINDRED_GUIDE_DIR unset"; else fail "expected exit 1, got $code"; fi
if printf '%s' "$out" | grep -qF -- "$expected"; then pass "exact message"; else fail "message missing: $out"; fi
if [ ! -e "$MAIN_REPO/.worktrees/$SCRATCH" ]; then pass "no worktree created"; else fail "worktree was created"; fi
if git -C "$MAIN_REPO" rev-parse --verify -q "feature/$SCRATCH" >/dev/null; then
    fail "branch was created"
else
    pass "no branch created"
fi

# (b) the guide is located only through KINDRED_GUIDE_DIR.
if [ "$(grep -c 'KINDRED_GUIDE_DIR' "$NEW_SH")" -ge 1 ]; then pass "new.sh reads KINDRED_GUIDE_DIR"; else fail "new.sh never mentions KINDRED_GUIDE_DIR"; fi

exit "$FAILED"
