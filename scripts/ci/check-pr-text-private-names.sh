#!/usr/bin/env bash
# scripts/ci/check-pr-text-private-names.sh -- no private name in a PR's text.
#
# check-private-names.sh scans tracked FILES. A PR's title, body and commit
# messages never touch a file, yet the body becomes the squash commit message on
# main, so a private name written there lands in the public history. This scans
# those three texts.
#
# Inputs:
#   PR_TEXT_TERMS_FILE    one term per line; blank lines ignored. Matching is
#                         case-insensitive and fixed-string.
#   GITHUB_EVENT_PATH     the pull_request event payload. Title and body are read
#                         from it at run time with jq, never through `env:`,
#                         because env values print in the public log header.
#   PR_TEXT_COMMITS_FILE  optional (tests): one JSON object per line,
#                         {"sha": ..., "message": ...}. Unset, the commits come
#                         from `gh api` for repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER.
#
# CI logs on this repo are public, so this never prints a term or a matched
# line, only WHICH part matched: "PR title", "PR body" or "commit <sha> message".
#
# Exit: 0 clean, or skipped (no terms: fork and Dependabot PRs get no secrets),
# 1 a hit, 3 a read failed -- fail closed, so an unread text never passes.
# Behaviour pinned by scripts/ci/test-check-pr-text-private-names.sh.
set -euo pipefail

terms_in="${PR_TEXT_TERMS_FILE:-}"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

# A blank line is an empty pattern, which grep -F -f matches against every line.
if [ -n "$terms_in" ] && [ -r "$terms_in" ]; then
  grep -v '^[[:space:]]*$' "$terms_in" > "$work/terms" || true
else
  : > "$work/terms"
fi
if [ ! -s "$work/terms" ]; then
  echo "::notice::no private-name terms on this run (fork or Dependabot PR); PR-text guard skipped"
  exit 0
fi

die() { echo "::error::$1"; exit 3; }

event="${GITHUB_EVENT_PATH:-}"
[ -n "$event" ] && [ -r "$event" ] || die "PR-text guard could not read the event payload"
jq -er '.pull_request.title // ""' "$event" > "$work/title" 2>/dev/null || die "PR-text guard could not read the PR title"
jq -er '.pull_request.body // ""' "$event" > "$work/body" 2>/dev/null || die "PR-text guard could not read the PR body"

commits="${PR_TEXT_COMMITS_FILE:-}"
if [ -n "$commits" ]; then
  [ -r "$commits" ] || die "PR-text guard could not read the commit list"
  cp "$commits" "$work/commits"
else
  # stderr is dropped: a failing gh could quote a response.
  gh api --paginate "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/commits" \
    --jq '.[] | {sha: .sha, message: .commit.message}' > "$work/commits" 2>/dev/null \
    || die "PR-text guard could not fetch the PR's commits"
fi

# 0 = a term matched, 1 = none, anything else = grep itself failed.
matches() {
  local rc=0
  grep -q -i -F -f "$work/terms" "$1" 2>/dev/null || rc=$?
  case "$rc" in 0) return 0 ;; 1) return 1 ;; *) die "PR-text guard's scan failed (exit $rc)" ;; esac
}

status=0
hit() { echo "::error::$1 contains a private name (term withheld)"; status=1; }

matches "$work/title" && hit "PR title"
matches "$work/body" && hit "PR body"

# jq -s tolerates both a stream of objects and an empty list.
n="$(jq -s 'length' "$work/commits" 2>/dev/null)" || die "PR-text guard could not parse the commit list"
# GitHub's PR-commits endpoint returns at most 250 commits, however it is paged,
# so a list that long may have been cut short. Fail closed, not clean.
[ "$n" -lt 250 ] || die "PR-text guard cannot tell the commit list is complete (250 or more commits)"
i=0
while [ "$i" -lt "$n" ]; do
  jq -s -r ".[$i].message // \"\"" "$work/commits" > "$work/msg" || die "PR-text guard could not parse the commit list"
  if matches "$work/msg"; then
    sha="$(jq -s -r ".[$i].sha[0:7]" "$work/commits")" || die "PR-text guard could not parse the commit list"
    hit "commit $sha message"
  fi
  i=$((i + 1))
done

if [ "$status" = 0 ]; then
  echo "PR-text guard: clean"
else
  echo "::error::Reword it: refer to a paired guide PR as \"guide #N\", never by its repo name."
fi
exit "$status"
