#!/usr/bin/env bash
# Spec 3.8: the lodging registry is DATA, not code. It now lives in exactly one
# place — the private config/lodging_registry.json, carried in kindred-local
# and loaded on boot (docs/reference/lodging-registry.md).
#
# It used to live in pb_migrations/, which is why this guard used to skip that
# directory. It no longer does: with the data gone from the seed migrations,
# that exclusion was a hole in precisely the place a future seed would land.
# Prose in a migration is still fine — comments are dropped below — but a unit
# list in a migration is now a failure, same as in any other source file.
#
# SCOPE, honestly stated: this is a tripwire, not a proof. It greps for a
# REPRESENTATIVE SAMPLE of distinctive unit strings (NEEDLES below) — not the
# full ~90-unit registry, which would be both unmaintainable and prone to
# false positives on ordinary words ("Ridge A", "Kitty"). A leak of a unit name
# that is not in NEEDLES will pass. Treat a green run as "the obvious cases are
# clean", not "no unit name exists in source".
set -euo pipefail

# Preflight BEFORE the first git call — checking for git after invoking it is
# pointless, since the missing binary would already have exited 127.
for cmd in git grep python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: required command '$cmd' not found" >&2; exit 2; }
done

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Distinctive unit strings that must never appear outside seed migrations.
# Double-quoted so "Doctor's House" can carry its apostrophe.
# "Cloud'?s Rest" matches both spellings on purpose: the canonical unit name is
# "Clouds Rest" (1500000120) but every historical alias string is "Cloud's Rest"
# with the apostrophe (1500000121), and a leak could copy either.
NEEDLES="Ridge Yurt|Tawonga Village|Manzanita|Tuolumne|Cloud'?s Rest|Wawona|Half Dome|El Cap|Bayit|Tenaya|Tioga|Le Shack|Lofty|Kitty|Doctor's House"

# --include='*.js' matters: pocketbase/pb_hooks/ is application JavaScript and
# pocketbase/pb_migrations/ is where the registry used to live, so both have to
# be scanned. One directory is still excluded, and by directory rather than by
# file:
#   pb_public/ — gitignored build output; the minified frontend bundle embeds
#                the same city/school geo tables and matches "Kitty"/"Tioga" as
#                ordinary US place names
# Scan roots, overridable ONLY so the test suite can point the guard at a
# missing directory and assert it fails rather than reporting a clean scan.
read -r -a SCAN_ROOTS <<<"${LODGING_SCAN_ROOTS:-pocketbase/ api/ bunking/ frontend/src/ scripts/}"

# Capture grep's OWN status before the filter pipeline swallows it. grep exits
# 0 for matches, 1 for none, and >=2 when the scan itself failed — an
# unreadable or missing search root. The old form sent stderr to /dev/null and
# ended in `|| true`, so a status-2 run produced no hits and printed OK: a
# guard reporting clean on a scan that never happened. Flagged on this script
# in kindred#1867 and asserted by TEST 6 in test-verify-no-hardcoded-lodging.sh.
grep_status=0
RAW=$(grep -rInE "$NEEDLES" \
  --include='*.go' --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' \
  --exclude-dir=pb_public --exclude-dir=node_modules \
  "${SCAN_ROOTS[@]}" 2>&1) || grep_status=$?

if [[ "$grep_status" -ge 2 ]]; then
  echo "error: grep exited $grep_status — the scan did not run, so this is NOT a clean result:" >&2
  printf '%s\n' "$RAW" >&2
  exit 2
fi

# scripts/ joined SCAN_ROOTS in kindred#2223, and these three files are the
# guard itself: they MUST carry the needles to function (verify's own NEEDLES
# definition, the test fixtures in test-verify-no-hardcoded-lodging.sh, and
# the docstring examples in drop_comment_hits.py). Exempted BY PATH,
# deliberately -- NOT via the _test./.test. filter below. That filter is a
# known blind spot (kindred#1909: two real needle-matching literals sailed
# through it once already) and would not even cover the two .sh files here,
# whose names don't match `_test\.` or `\.test\.`.
GUARD_OWN_FILES=(
  "scripts/dev/verify-no-hardcoded-lodging.sh"
  "scripts/dev/test-verify-no-hardcoded-lodging.sh"
  "scripts/dev/lib/drop_comment_hits.py"
)
for owned in "${GUARD_OWN_FILES[@]}"; do
  RAW=$(printf '%s\n' "$RAW" | grep -v -F "${owned}:" || true)
done

# The _test./.test. exemption below is a known blind spot, not an oversight:
# kindred#1909 found that two NEEDLES-matching literals landed in test files
# (via PR #2006 and #2037) and sailed through, because this filter drops
# every hit in a test file -- comment prose and fixture code alike -- with no
# distinction between them. The fix applied there was to scrub those two
# literals at the source, not narrow this filter: a narrower filter (still
# failing on fixture literals, only dropping prose) would also fail on the
# many OTHER lodging test files that legitimately hardcode real unit names as
# fixture data (lodging_alias_resolver_test.go, LodgingUnitForm.test.tsx, and
# others) -- the exact case this exemption exists for. A green run on a test
# file only ever proved "no unit name outside a test file", never "no unit
# name in test fixtures either" -- treat a future NEEDLES hit inside one as
# worth a look, not an automatic pass.
HITS=""
if [[ -n "$RAW" ]]; then
  HITS=$(printf '%s\n' "$RAW" \
    | grep -v '_test\.\|\.test\.\|/tests\?/' \
    | grep -v 'frontend/src/data/cityGeo\.ts\|frontend/src/data/schoolGeo\.ts' || true)
fi

# Prose that names a unit to explain a rule is documentation, not the registry
# living in code. Dropping comment and docstring hits is what makes this guard
# green on a clean `main`: it failed on a docstring in lodging_rules.py, which
# opened Phase C on a red that was not Phase C's (kindred#1891). A file that
# cannot be parsed is treated as all code, so its hits survive.
if [[ -n "$HITS" ]]; then
  HITS=$(printf '%s\n' "$HITS" | python3 "$REPO_ROOT/scripts/dev/lib/drop_comment_hits.py")
fi
# cityGeo.ts / schoolGeo.ts are unrelated city/school geocoding lookup tables
# (a different feature) that coincidentally contain place-name substrings
# ("Manzanita, OR", "El Capitan, AZ", "Wawona, CA", "Tuolumne City, CA") — not
# the lodging registry. Excluded to keep this guard meaningful.

if [[ -n "$HITS" ]]; then
  echo "FAIL: lodging unit names found in application source (spec 3.8 — registry is data, not code):" >&2
  echo "$HITS" >&2
  exit 1
fi
echo "verify-no-hardcoded-lodging: OK"
