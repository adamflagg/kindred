#!/usr/bin/env bash
# Test for .claude/hooks/worktree-guard.sh
#
# The guard is a PreToolUse hook on Bash. It reads the tool payload on stdin
# and exits 0 to allow or 2 to block, with the reason on stderr.
#
# It covers two unrelated hazards that share one mechanism:
#
#   1. `git worktree add` -- bypasses ./scripts/worktree/new.sh, which owns
#      port allocation, branch naming, DB seeding and config symlinks.
#
#   2. `git clean` with BOTH an ignored-file flag and a doubled force --
#      worktrees now live at .worktrees/ INSIDE the repo and are gitignored,
#      so this command deletes them and leaves .git/worktrees/* dangling.
#
# The git-clean half is deliberately narrow, and the boundaries below are
# empirical, not guessed. Measured against a gitignored nested repo:
#
#   git clean -dff    survives  -- without -x/-X, ignored files are untouched
#   git clean -xdf    survives  -- git prints "Skipping repository" itself
#   git clean -xdff   DELETED   -- "Removing .worktrees/"
#   git clean -Xdff   DELETED   -- -X is ignored-files-ONLY, so it hits too
#
# Blocking any wider than that would flag commands git already refuses to
# execute, and train the reader to bypass the guard. Blocking any narrower
# would miss -X or a flag order the author did not think of, which is why
# TEST 7-9 pin the reorderings rather than one canonical spelling.

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
GUARD="$REPO_ROOT/.claude/hooks/worktree-guard.sh"

if [[ ! -x "$GUARD" ]]; then
  echo "FAIL: $GUARD not executable or missing" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required to build the hook payload" >&2
  exit 1
fi

FAILURES=0

# Feed one command to the guard as a real tool payload and report its exit
# code. jq builds the JSON so quoting, newlines and backslashes in the
# command under test cannot corrupt the payload.
guard_rc() {
  local cmd="$1" rc=0
  jq -nc --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$GUARD" >/dev/null 2>&1 || rc=$?
  echo "$rc"
}

expect_block() {
  local label="$1" cmd="$2" rc
  rc=$(guard_rc "$cmd")
  if [[ "$rc" -ne 2 ]]; then
    echo "FAIL: [$label] expected BLOCK (exit 2), got $rc" >&2
    echo "      command: $cmd" >&2
    FAILURES=$((FAILURES + 1))
  else
    echo "  ok  BLOCK  $label"
  fi
}

expect_allow() {
  local label="$1" cmd="$2" rc
  rc=$(guard_rc "$cmd")
  if [[ "$rc" -ne 0 ]]; then
    echo "FAIL: [$label] expected ALLOW (exit 0), got $rc" >&2
    echo "      command: $cmd" >&2
    FAILURES=$((FAILURES + 1))
  else
    echo "  ok  ALLOW  $label"
  fi
}

echo "=== TEST 1-3: git worktree add stays blocked (regression) ==="
expect_block "plain"             "git worktree add ../foo feature/bar"
expect_block "intervening flags" "git -C /tmp/repository worktree add x y"
expect_block "chained"           "cd /tmp && git worktree add z"

echo
echo "=== TEST 4-6: worktree subcommands that are not 'add' stay allowed ==="
expect_allow "list"    "git worktree list"
expect_allow "remove"  "git worktree remove .worktrees/foo"
expect_allow "prune"   "git worktree prune"

echo
echo "=== TEST 7-9: git clean that deletes .worktrees/ is blocked ==="
expect_block "-xdff"                "git clean -xdff"
expect_block "-ffdx (reordered)"    "git clean -ffdx"
expect_block "-Xdff (ignored-only)" "git clean -Xdff"

echo
echo "=== TEST 10-12: the same danger spelled other ways is blocked ==="
expect_block "separate short flags" "git clean -x -f -f"
expect_block "long force twice"     "git clean --force --force -x"
expect_block "mixed short and long" "git clean -x -f --force"

echo
echo "=== TEST 13: chained after another command is blocked ==="
expect_block "chained" "npm run build && git clean -xdff"

echo
echo "=== TEST 13a-13d: line continuations do not smuggle a command past ==="
# A backslash-newline is a continuation: bash joins it into ONE command before
# running it. A guard that splits on the raw newline first sees `git clean \`
# and `-xdff` as unrelated segments, and neither looks destructive on its own.
# Verified as a live bypass before this was fixed -- the command ran and
# printed "Removing .worktrees/". Both checks are affected, because grep
# matches line by line too.
expect_block "clean, continued before flags"  $'git clean \\\n  -xdff'
expect_block "clean, continued mid-flags"     $'git clean -x \\\n  -f -f'
expect_block "worktree add, continued"        $'git worktree \\\n  add ../foo bar'
# The join must not manufacture a block out of a safe continued command.
expect_allow "safe clean, continued"          $'git clean \\\n  -xdf'

echo
echo "=== TEST 14-17: git clean forms that CANNOT reach .worktrees/ are allowed ==="
# Each of these is a real command a developer runs. Blocking them would be a
# false positive, and the measured behavior above is why they are safe.
expect_allow "-xdf  (single force; git skips repos)" "git clean -xdf"
expect_allow "-dff  (no -x; ignored files untouched)" "git clean -dff"
expect_allow "-n    (dry run)"                        "git clean -nxd"
# -nxdff carries every ingredient the guard looks for and still deletes
# nothing -- measured as "Would remove .worktrees/". Listing what a
# destructive command WOULD do is how you decide whether to run it, so the
# guard must not block the safe half of that workflow.
expect_allow "-nxdff (dry run, doubled force)"        "git clean -nxdff"
expect_allow "--dry-run --force --force -x"           "git clean --dry-run --force --force -x"

echo
echo "=== TEST 18-20: unrelated commands are untouched ==="
expect_allow "git status"       "git status --porcelain"
expect_allow "ls"               "ls -la"
expect_allow "clean in prose"   "echo 'remember to clean the build dir'"

echo
echo "=== TEST 21: a block explains itself on stderr ==="
BLOCK_OUT=$(jq -nc '{tool_name:"Bash",tool_input:{command:"git clean -xdff"}}' \
  | "$GUARD" 2>&1 >/dev/null || true)
if ! grep -q '\.worktrees' <<<"$BLOCK_OUT"; then
  echo "FAIL: block message does not mention .worktrees" >&2
  echo "$BLOCK_OUT" >&2
  FAILURES=$((FAILURES + 1))
else
  echo "  ok  message names the directory at risk"
fi

echo
if [[ "$FAILURES" -gt 0 ]]; then
  echo "FAILED: $FAILURES check(s)" >&2
  exit 1
fi
echo "PASS: worktree-guard behaves as specified"
