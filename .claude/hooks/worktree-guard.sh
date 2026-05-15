#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks direct `git worktree add` calls.
# Must use ./scripts/worktree/new.sh which handles port allocation,
# branch naming, DB seeding, and config symlinks.
#
# Exit codes:
#   0 = allow the tool call
#   2 = block (Claude Code surfaces stderr as the denial reason)

set -u

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
else
  # Fallback: scan the raw JSON payload. Less precise than parsing
  # .tool_input.command — may catch the literal string in other fields — but
  # preserves enforcement. Failing open would leave worktree creation
  # unguarded on hosts without jq.
  command=$input
fi

# Match `git ... worktree add`, allowing intervening flags like `-C <dir>` or
# `--git-dir=…` that would otherwise bypass the guard. Shell separators
# (`;`, `&`, `|`) bound the match so chained commands still trigger.
# The wrapper script itself shells out to `git worktree add` internally, but
# those subprocesses don't go through the Bash tool, so the hook only sees
# Claude's direct invocations.
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

exit 0
