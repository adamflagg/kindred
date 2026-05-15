#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks direct `git worktree add` calls.
# Must use ./scripts/worktree/new.sh which handles port allocation,
# branch naming, DB seeding, and config symlinks.
#
# Exit codes:
#   0 = allow the tool call
#   2 = block (Claude Code surfaces stderr as the denial reason)

set -u

if ! command -v jq >/dev/null 2>&1; then
  # No jq → can't parse; fail open so we don't break other tooling.
  exit 0
fi

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# Match `git worktree add` with arbitrary whitespace.
# The wrapper script itself shells out to `git worktree add` internally, but
# those subprocesses don't go through the Bash tool, so the hook only sees
# Claude's direct invocations.
if printf '%s' "$command" | grep -qE '(^|[^/[:alnum:]_-])git[[:space:]]+worktree[[:space:]]+add\b'; then
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
