#!/usr/bin/env bash
# scripts/ci/test-check-pr-text-private-names.sh -- self-test for
# check-pr-text-private-names.sh. Fictional terms only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/check-pr-text-private-names.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# The terms a run derives from GUIDE_REPO=example-owner/example-docs.
printf 'example-owner/example-docs\nexample-docs\n\n' > "$TMP/terms"
: > "$TMP/terms-empty"
printf '\n  \n' > "$TMP/terms-blank"

event() { # event <title> <body-json> -> writes $TMP/event.json
  jq -n --arg t "$1" --argjson b "$2" '{pull_request: {title: $t, body: $b}}' > "$TMP/event.json"
}
# commits: one JSON object per line, {"sha": ..., "message": ...}
commits() { : > "$TMP/commits"; for m in "$@"; do jq -nc --arg m "$m" '{sha: "abc1234def", message: $m}' >> "$TMP/commits"; done; }

fail=0
all_out=""
run() {
  local want="$1" label="$2"; shift 2
  out="$(env "$@" bash "$GUARD" 2>&1)" && rc=0 || rc=$?
  all_out+="$out"$'\n'
  [ "$rc" = "$want" ] || { echo "FAIL $label: expected exit $want, got $rc"; printf '%s\n' "$out" | sed 's/^/    /'; fail=1; }
}
expect() { grep -q -- "$1" <<<"$out" || { echo "FAIL $2: output lacks '$1'"; fail=1; }; }
refute() { if grep -q -- "$1" <<<"$out"; then echo "FAIL $2: output has '$1'"; fail=1; fi; }

T="PR_TEXT_TERMS_FILE=$TMP/terms"
E="GITHUB_EVENT_PATH=$TMP/event.json"
C="PR_TEXT_COMMITS_FILE=$TMP/commits"

event "ci: tidy the guard" '"A plain body\n\nDocs: none"'
commits "ci: tidy the guard" $'second commit\n\nwith a body'
run 0 "clean text" "$T" "$E" "$C"

event "ci: pair with example-owner/example-docs#20" '"clean"'
run 1 "hit in title" "$T" "$E" "$C"
expect 'PR title' "hit in title"
refute 'PR body' "hit in title"
refute 'commit' "hit in title"

event "ci: tidy" '"Paired guide PR: example-owner/example-docs#20"'
run 1 "hit in body" "$T" "$E" "$C"
expect 'PR body' "hit in body"
refute 'PR title' "hit in body"
refute 'commit' "hit in body"

event "ci: tidy" '"clean"'
commits "fine" $'second\n\nsee the example-docs repo'
run 1 "hit in a commit message" "$T" "$E" "$C"
expect 'commit abc1234 message' "hit in a commit message"
refute 'PR title' "hit in a commit message"
refute 'PR body' "hit in a commit message"

# The bare name alone (no owner) is a term too, and matching ignores case.
event "ci: tidy" '"see EXAMPLE-DOCS today"'
commits "fine"
run 1 "case-insensitive bare name" "$T" "$E" "$C"
expect 'PR body' "case-insensitive bare name"

# A body of null (a PR opened with no description) is fine.
event "ci: tidy" 'null'
run 0 "null body" "$T" "$E" "$C"

# Empty or blank-only terms: a notice and a pass (fork and Dependabot PRs).
run 0 "empty terms" "PR_TEXT_TERMS_FILE=$TMP/terms-empty" "$E" "$C"
expect '^::notice::' "empty terms"
run 0 "blank-only terms" "PR_TEXT_TERMS_FILE=$TMP/terms-blank" "$E" "$C"
expect '^::notice::' "blank-only terms"
run 0 "no terms file named" "$E" "$C"
expect '^::notice::' "no terms file named"

# Fail closed: an unreadable event file or a failed commits fetch never passes.
run 3 "unreadable event file" "$T" "GITHUB_EVENT_PATH=$TMP/none.json" "$C"
printf 'not json' > "$TMP/bad.json"
run 3 "malformed event file" "$T" "GITHUB_EVENT_PATH=$TMP/bad.json" "$C"
run 3 "unreadable commits file" "$T" "$E" "PR_TEXT_COMMITS_FILE=$TMP/none"
# Without the injected file the script calls `gh`; a stub that fails stands in.
mkdir "$TMP/badgh"
printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP/badgh/gh"; chmod +x "$TMP/badgh/gh"
run 3 "gh fetch fails" "$T" "$E" "PATH=$TMP/badgh:$PATH" GITHUB_REPOSITORY=o/r PR_NUMBER=1

# No run above ever printed a term.
for leaked in example-docs example-owner EXAMPLE-DOCS; do
  if grep -qi -- "$leaked" <<<"$all_out"; then echo "FAIL some run echoed '$leaked'"; fail=1; fi
done

[ "$fail" = 0 ] && echo "all PR-text guard tests passed"
exit "$fail"
