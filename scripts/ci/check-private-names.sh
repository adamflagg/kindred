#!/usr/bin/env bash
# scripts/ci/check-private-names.sh -- no private name in tracked files.
#
# Terms come from files CI builds from the private branding config and the
# GUIDE_REPO secret. This script never prints a term or a matched line, only
# file:line and path/count, because CI logs on this repo are public.
#
# Two term groups:
#   PRIVATE_NAMES_STRICT_FILE   any hit in any tracked file fails.
#   PRIVATE_NAMES_RATCHET_FILE  hits are allowed per file up to the count in
#                               PRIVATE_NAMES_BASELINE (default
#                               scripts/ci/private-names-baseline.txt), and
#                               that list may only SHRINK: a file over its
#                               count, a file not listed, and a file now BELOW
#                               its count (or gone) all fail, so a cleanup has
#                               to lower the baseline in the same change.
# Each file holds one term per line; blank lines are ignored.
#
# Exit: 0 clean (or skipped: no terms, fork or Dependabot PR), 1 hits or a
# stale/malformed baseline, 2 no terms at all while PRIVATE_NAMES_REQUIRED=1.
# Behaviour pinned by scripts/ci/test-check-private-names.sh.
set -euo pipefail

abs() { case "$1" in ''|/*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
strict_in="$(abs "${PRIVATE_NAMES_STRICT_FILE:-}")"
ratchet_in="$(abs "${PRIVATE_NAMES_RATCHET_FILE:-}")"
baseline="$(abs "${PRIVATE_NAMES_BASELINE:-}")"
cd "$(git rev-parse --show-toplevel)"
[ -n "$baseline" ] || baseline="$PWD/scripts/ci/private-names-baseline.txt"

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
# A blank line would be an empty pattern, which `git grep -F -f` matches
# against every line of every file, so only non-blank terms are kept.
nonblank() { if [ -n "$1" ] && [ -r "$1" ]; then grep -v '^[[:space:]]*$' "$1" || true; fi; }
nonblank "$strict_in" > "$work/strict"
nonblank "$ratchet_in" > "$work/ratchet"

if [ ! -s "$work/strict" ] && [ ! -s "$work/ratchet" ]; then
  if [ "${PRIVATE_NAMES_REQUIRED:-0}" = 1 ]; then echo "::error::no private-name terms available"; exit 2; fi
  echo "::notice::no private-name terms on this run (fork or Dependabot PR); guard skipped"; exit 0
fi

# file:line for every tracked line matching any term in $1. Paths only, never
# content: `cut` drops everything after the line number.
scan() { git grep -n -I -i -F -f "$1" -- . ':!*.lock' | cut -d: -f1,2 || true; }

status=0

if [ -s "$work/strict" ]; then
  strict_hits="$(scan "$work/strict")"
  if [ -n "$strict_hits" ]; then
    printf '%s\n' "$strict_hits"
    echo "::error::$(printf '%s\n' "$strict_hits" | wc -l | tr -d ' ') line(s) contain a private name that is never allowed (term withheld). Replace with {camp_name} placeholders or generic wording."
    status=1
  fi
fi

if [ -s "$work/ratchet" ]; then
  scan "$work/ratchet" > "$work/ratchet-hits"
  if [ -r "$baseline" ]; then cp "$baseline" "$work/baseline"; else : > "$work/baseline"; fi
  # Baseline format: `<path>\t<count>`, one file per line; `#` comments and
  # blank lines are ignored. Output is file:line, path/count, and messages.
  if ! awk -F'\t' '
    FNR == NR {
      if ($0 ~ /^#/ || $0 ~ /^[[:space:]]*$/) next
      if (NF != 2 || $2 !~ /^[0-9]+$/ || ($1 in base)) {
        printf "::error::malformed private-names baseline line %d (want <path><TAB><count>, each path once)\n", FNR
        bad = 1; next
      }
      base[$1] = $2 + 0; next
    }
    {
      n = index($0, ":"); p = substr($0, 1, n - 1)
      cur[p]++; lines[p] = lines[p] $0 "\n"
    }
    END {
      for (p in cur) {
        if (!(p in base)) {
          printf "%s", lines[p]
          printf "::error::%s: %d line(s) contain a private name and the file is not in the baseline (term withheld). Replace with {camp_name} placeholders or generic wording.\n", p, cur[p]
          bad = 1
        } else if (cur[p] > base[p]) {
          printf "%s", lines[p]
          printf "::error::%s: %d line(s) contain a private name, baseline allows %d (term withheld). Remove the new occurrence.\n", p, cur[p], base[p]
          bad = 1
        } else if (cur[p] < base[p]) {
          printf "::error::baseline is stale: lower %s to %d\n", p, cur[p]
          bad = 1
        }
      }
      for (p in base) if (!(p in cur)) {
        printf "::error::baseline is stale: remove %s\n", p
        bad = 1
      }
      exit bad
    }' "$work/baseline" "$work/ratchet-hits"; then
    status=1
  fi
fi

[ "$status" = 0 ] && echo "private-names guard: clean"
exit "$status"
