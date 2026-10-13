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
# PRIVATE_NAMES_BASE_BASELINE, when set, is the BASE branch's copy of the
# baseline. The current baseline may not list a path the base lacks, nor raise
# a count (lowering or removing is fine), so a PR cannot baseline its own new
# hit. A missing base copy (the PR that introduces the file) skips with a
# notice. Needs no terms, so it also runs on fork and Dependabot PRs.
# Each file holds one term per line; blank lines are ignored.
#
# Both groups also apply to tracked PATHS, with zero tolerance (a baseline
# line naming such a path would itself contain the term); only their count is
# printed, and the content scan does not run, since its file:line would print
# them. Binary files are scanned as text.
#
# Exit: 0 clean (or skipped: no terms, fork or Dependabot PR), 1 hits or a
# stale/malformed baseline, 2 a term group is empty while
# PRIVATE_NAMES_REQUIRED=1, 3 a scan itself failed, so the tree was never checked.
# Behaviour pinned by scripts/ci/test-check-private-names.sh.
set -euo pipefail

abs() { case "$1" in ''|/*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
strict_in="$(abs "${PRIVATE_NAMES_STRICT_FILE:-}")"
ratchet_in="$(abs "${PRIVATE_NAMES_RATCHET_FILE:-}")"
baseline="$(abs "${PRIVATE_NAMES_BASELINE:-}")"
cd "$(git rev-parse --show-toplevel)"
[ -n "$baseline" ] || baseline="$PWD/scripts/ci/private-names-baseline.txt"

base_baseline="$(abs "${PRIVATE_NAMES_BASE_BASELINE:-}")"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
# A blank line would be an empty pattern, which `git grep -F -f` matches
# against every line of every file, so only non-blank terms are kept.
nonblank() { if [ -n "$1" ] && [ -r "$1" ]; then grep -v '^[[:space:]]*$' "$1" || true; fi; }
nonblank "$strict_in" > "$work/strict"
nonblank "$ratchet_in" > "$work/ratchet"

# Shrink-only against the base branch. Prints paths and counts only.
if [ -n "$base_baseline" ]; then
  if [ ! -r "$base_baseline" ]; then
    echo "::notice::no base-branch baseline to compare with; shrink-only check skipped"
  elif ! awk -F'\t' '
      FILENAME == ARGV[1] {
        if ($0 ~ /^#/ || $0 ~ /^[[:space:]]*$/ || NF != 2 || $2 !~ /^[0-9]+$/) next
        base[$1] = $2 + 0; next
      }
      $0 ~ /^#/ || $0 ~ /^[[:space:]]*$/ || NF != 2 || $2 !~ /^[0-9]+$/ { next }
      !($1 in base) { printf "::error::baseline adds %s: new private-name hits may not be baselined\n", $1; bad = 1; next }
      $2 + 0 > base[$1] { printf "::error::baseline raises %s from %d to %d\n", $1, base[$1], $2; bad = 1 }
      END { exit bad }' "$base_baseline" "${baseline}"; then
    exit 1
  fi
fi

# With the deploy key present BOTH groups must have terms: one silently empty
# group (an unreadable file, a renamed branding key) would pass as clean.
if [ "${PRIVATE_NAMES_REQUIRED:-0}" = 1 ]; then
  for g in strict ratchet; do
    [ -s "$work/$g" ] || { echo "::error::no $g private-name terms available"; exit 2; }
  done
elif [ ! -s "$work/strict" ] && [ ! -s "$work/ratchet" ]; then
  echo "::notice::no private-name terms on this run (fork or Dependabot PR); guard skipped"; exit 0
fi

# A term in a tracked path: count only, never the path, and stop before the
# content scan, whose file:line output would print it.
cat "$work/strict" "$work/ratchet" > "$work/all"
git ls-files -z | tr '\0' '\n' > "$work/paths"
rc=0; n_paths="$(grep -c -i -F -f "$work/all" "$work/paths" 2>/dev/null)" || rc=$?
if [ "$rc" -gt 1 ]; then echo "::error::path scan failed (exit $rc); the private-names guard could not scan the tree"; exit 3; fi
if [ "$n_paths" -gt 0 ]; then
  echo "::error::$n_paths tracked path(s) contain a private name (paths and term withheld). Rename them to generic wording."
  exit 1
fi

# Writes file:line for every tracked line matching any term in $1 to $2 (`-a`:
# binary files too). Paths only, never content: `cut` drops everything after
# the line number. git grep exits 1 for "no match" and >1 for an error; an
# error must fail the guard, not read as a clean tree. Its stderr is dropped
# because it could quote a term.
scan() {
  local rc=0
  git grep -n -a -i -F -f "$1" -- . ':!*.lock' > "$work/grep-out" 2>/dev/null || rc=$?
  if [ "$rc" -gt 1 ]; then
    echo "::error::git grep failed (exit $rc); the private-names guard could not scan the tree"
    return 1
  fi
  cut -d: -f1,2 "$work/grep-out" > "$2"
}

status=0

if [ -s "$work/strict" ]; then
  scan "$work/strict" "$work/strict-hits" || exit 3
  if [ -s "$work/strict-hits" ]; then
    cat "$work/strict-hits"
    echo "::error::$(wc -l < "$work/strict-hits" | tr -d ' ') line(s) contain a private name that is never allowed (term withheld). Replace with {camp_name} placeholders or generic wording."
    status=1
  fi
fi

if [ -s "$work/ratchet" ]; then
  scan "$work/ratchet" "$work/ratchet-hits" || exit 3
  if [ -r "$baseline" ]; then cp "$baseline" "$work/baseline"; else : > "$work/baseline"; fi
  # Baseline format: `<path>\t<count>`, one file per line; `#` comments and
  # blank lines are ignored. Output is file:line, path/count, and messages.
  # FILENAME, not the FNR == NR idiom: an empty baseline has no records, so
  # FNR == NR would hold for the hits file and read each hit as a baseline line.
  if ! awk -F'\t' '
    FILENAME == ARGV[1] {
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
