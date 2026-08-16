#!/usr/bin/env bash
# PreToolUse hook for Bash. Blocks two commands that silently break the
# worktree layout. Self-tested by scripts/dev/test-worktree-guard.sh.
#
# Exit codes:
#   0 = allow the tool call
#   2 = block (Claude Code surfaces stderr as the denial reason)
#
# The hook only sees commands Claude issues through the Bash tool. Scripts
# that shell out internally -- including new.sh's own `git worktree add` --
# do not pass through it, and a developer's own terminal is unaffected.

set -u

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
else
  # Fallback: scan the raw JSON payload. Less precise than parsing
  # .tool_input.command -- may catch the literal string in other fields -- but
  # preserves enforcement. Failing open would leave worktree creation
  # unguarded on hosts without jq.
  command=$input
fi

# Join backslash-newline line continuations before anything inspects the text.
# Bash folds them into a single command before executing, so the guard has to
# see what will actually run. Without this both checks below are bypassable:
# grep matches line by line, and the git-clean splitter treats a newline as a
# command separator -- so `git clean \<newline> -xdff` arrives as `git clean \`
# plus `-xdff`, and neither half looks destructive on its own. Verified live
# before the fix: the command ran and printed "Removing .worktrees/".
# Pinned by TEST 13a-13d in scripts/dev/test-worktree-guard.sh.
command=${command//\\$'\n'/ }

# ── 1. Direct `git worktree add` ────────────────────────────────────────
# Match `git ... worktree add`, allowing intervening flags like `-C <dir>` or
# `--git-dir=…` that would otherwise bypass the guard. Shell separators
# (`;`, `&`, `|`) bound the match so chained commands still trigger.
if printf '%s' "$command" | grep -qE '\bgit\b[^|;&]*\bworktree[[:space:]]+add\b'; then
  cat >&2 <<'EOF'
[worktree-guard] BLOCKED: direct `git worktree add` is not allowed in this project.

Use: ./scripts/worktree/new.sh <feature-name>

The script handles things bare `git worktree add` skips:
  - Port allocation (Vite/FastAPI/Caddy/PocketBase offsets — parallel worktrees collide without it)
  - Branch naming (feature/<name>)
  - DB seed from main
  - .env / local-config symlinks

If the user explicitly asked for a non-standard worktree path, confirm that
intent with them before bypassing — don't just retry.
EOF
  exit 2
fi

# ── 2. `git clean` that can delete .worktrees/ ──────────────────────────
# Worktrees live at .worktrees/ inside the repo and are gitignored, which
# puts them in range of `git clean`. Only one combination actually reaches
# them, and the boundaries are measured, not assumed:
#
#   git clean -dff     survives — without -x/-X, ignored files are untouched
#   git clean -xdf     survives — git prints "Skipping repository" itself
#   git clean -nxdff   survives — dry run deletes nothing
#   git clean -xdff    DELETED  — "Removing .worktrees/"
#   git clean -Xdff    DELETED  — -X is ignored-files-ONLY, so it hits too
#
# So the trigger is: an ignored-file flag (-x/-X), AND force given twice,
# AND not a dry run. Blocking wider than that would flag commands git
# already refuses to execute, which trains the reader to bypass the guard.
clean_is_destructive() {
  local segment="$1"
  printf '%s' "$segment" | grep -qE '\bgit\b.*\bclean\b' || return 1

  local force=0 ignored=0 dryrun=0 tok rest i
  while IFS= read -r tok; do
    case "$tok" in
      --) break ;;                       # end of options; rest are pathspecs
      --force)   force=$((force + 1)) ;;
      --dry-run) dryrun=1 ;;
      -[!-]*)
        # Short-flag cluster, e.g. -xdff. Inspect each letter: bundling is
        # why a plain substring match on "-ff" would miss `git clean -ffdx`.
        rest=${tok#-}
        for (( i = 0; i < ${#rest}; i++ )); do
          case "${rest:i:1}" in
            f)   force=$((force + 1)) ;;
            x|X) ignored=1 ;;
            n)   dryrun=1 ;;
          esac
        done
        ;;
    esac
    # `printf '%s\n'`, not '%s': `read` reports failure at EOF on a line with
    # no trailing newline, so the final token -- which is exactly where the
    # flags sit -- would be read into $tok and then discarded by the loop
    # condition. Same reason the segment split below adds one.
  done < <(printf '%s\n' "$segment" | tr -s ' \t' '\n')

  [ "$ignored" -eq 1 ] && [ "$force" -ge 2 ] && [ "$dryrun" -eq 0 ]
}

# Split on shell separators so a `git clean` chained behind another command
# is still examined on its own.
while IFS= read -r segment; do
  if clean_is_destructive "$segment"; then
    cat >&2 <<'EOF'
[worktree-guard] BLOCKED: this `git clean` would delete .worktrees/.

Worktrees live at .worktrees/ inside the repo and are gitignored, so an
ignored-file flag (-x or -X) combined with a doubled force (-ff) removes
them outright — and leaves .git/worktrees/* pointing at nothing.

Safe alternatives:
  git clean -xdf              # single -f; git skips nested repositories
  git clean -nxdff            # dry run; shows what would go
  git clean -xdff -e .worktrees   # keep the worktrees, clean everything else

To remove a worktree properly: ./scripts/worktree/cleanup.sh <feature-name>

If the user explicitly asked to wipe the tree including worktrees, confirm
that intent with them before bypassing — don't just retry.
EOF
    exit 2
  fi
done < <(printf '%s\n' "$command" | tr ';|&\n' '\n')

exit 0
