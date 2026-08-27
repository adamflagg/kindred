#!/usr/bin/env bash
# Spec 3.8: the lodging registry is DATA, not code. It now lives in exactly one
# place — the private config/lodging_registry.json, carried in kindred-local
# and loaded on boot (docs/reference/lodging-registry.md).
#
# It used to live in pb_migrations/, which is why this guard used to skip that
# directory. It no longer does: with the data gone from the seed migrations,
# that exclusion was a hole in precisely the place a future seed would land.
# Prose in a migration is not fine either, since kindred#2512: comments are
# SCANNED, not dropped, so a unit name in a migration header fails exactly as a
# unit list in a migration body does.
#
# ★ DECISION kindred#2551 (2026-08-24): OPTION B. NEEDLES is now BUILT FROM
# THE REGISTRY (scripts/dev/lib/build_lodging_needles.py) whenever one is
# readable, rather than sampled by hand. Two facts forced this over the
# cheaper separator-tolerant widening (Option A) first proposed for the same
# issue: (1) this guard runs ONLY in CI -- it is wired into neither
# .lefthook.yml nor scripts/pre-push-verify.sh -- so widening a sample CI
# already ran past fixes nothing CI actually gates; and (2) re-measuring the
# sample's blind spot found separator tolerance would have closed 1 of 14
# known misses, not all of them -- the other 13 were area and unit names the
# sample never sampled at all, which no widening of a hand list closes for
# the NEXT unit either.
#
# The cost, taken deliberately: the `lodging-guard` CI job now clones the
# private kindred-local repo via the `KINDRED_LOCAL_DEPLOY_KEY` secret
# (.github/workflows/ci.yml) -- the same one CD already uses for branding
# assets -- so a job that needed no secrets before now reads one, purely to
# build this pattern. build_lodging_needles.py's distinctiveness filter keeps
# the registry's bare single-token entries out of NEEDLES, which is what makes
# reading the whole registry workable rather than a false-positive machine.
# Read that module's docstring before touching the filter: it is a token-COUNT
# test, not an ordinariness test, so it does not remove the false-positive
# class precisely -- what makes it acceptable is that its residue fails LOUDLY
# (kindred#2573).
#
# FALLBACK_NEEDLES below is what a fork or a contributor without the deploy
# key gets instead: the same hand-picked, unwidened sample this guard has
# always shipped. Option A was superseded by this decision, not folded into
# it, so that sample is deliberately untouched. Every run announces which
# mode it used ("needle source = ..." below) -- a guard that silently
# degrades from registry to sample while still printing OK is worse than one
# that fails loudly.
#
# SCOPE, honestly stated: this is a tripwire, not a proof, IN EITHER MODE. The
# scan is textual -- a paraphrase, a name split across lines, or a unit name
# that is itself an ordinary-word substring can still slip past exact literal
# matching. In fallback mode specifically, a leak of a unit name that is not
# in FALLBACK_NEEDLES will also pass, exactly as it always has. Treat a green
# run as "the obvious cases are clean", never as "no unit name exists in
# source".
set -euo pipefail

# Preflight BEFORE the first git call — checking for git after invoking it is
# pointless, since the missing binary would already have exited 127.
for cmd in git grep awk python3 mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: required command '$cmd' not found" >&2; exit 2; }
done

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# FALLBACK sample, used only when no registry is readable (see the ★
# DECISION note above) -- unwidened since kindred#2551 superseded Option A
# rather than adopting it. Everything below this line, including the \b
# policy, is the pre-existing sample: do not widen it to "fix" a gap here --
# widen the registry-derived path instead, which is what closes gaps for
# real.
#
# Distinctive unit strings that must never appear outside seed migrations.
# Double-quoted so "Doctor's House" can carry its apostrophe.
# "Cloud'?s Rest" matches both spellings on purpose: the canonical unit name is
# "Clouds Rest" (1500000120) but every historical alias string is "Cloud's Rest"
# with the apostrophe (1500000121), and a leak could copy either.
#
# Matched CASE-INSENSITIVELY (the -i on the grep below), kindred#2512 review.
# The list is written in title case, but the codebase names units in prose by
# their lowercase CODE ("gt-<unit>", "<unit>-new-trailer"), so a title-case scan
# read straight past them: seven such comment hits were sitting in tracked
# source when this was measured, in a migration header, two frontend components
# and three test files. Case-insensitivity adds 64 raw hits repo-wide, 63 of
# them lowercase codes in test FIXTURE data (already exempt) and 1 an ordinary
# English false positive, handled just below.
#
# "El Cap" is the one needle that is also an English fragment once case is
# folded -- it matches inside "parallel capturers". \b fixes that and costs
# nothing: the needle contains a space, so it never matched a camelCase
# identifier anyway, and a real leak spells it at a word boundary. \b is
# deliberately NOT applied to the whole list -- it would stop matching
# camelCase identifiers such as a Go variable built from a unit name, which is
# a leak shape this guard does catch today.
FALLBACK_NEEDLES="Ridge Yurt|Tawonga Village|Manzanita|Tuolumne|Cloud'?s Rest|Wawona|Half Dome|\bEl Cap|Bayit|Tenaya|Tioga|Le Shack|Lofty|Kitty|Doctor's House"

# --include='*.js' matters: pocketbase/pb_hooks/ is application JavaScript and
# pocketbase/pb_migrations/ is where the registry used to live, so both have to
# be scanned. One directory is still excluded, and by directory rather than by
# file:
#   pb_public/ — gitignored build output; the minified frontend bundle embeds
#                the same city/school geo tables and matches "Kitty"/"Tioga" as
#                ordinary US place names
# Scan roots, overridable ONLY so the test suite can point the guard at a
# missing directory and assert it fails rather than reporting a clean scan.
#
# SIX ROOTS, AND THE RULE TABLE BELOW APPLIES TO ALL OF THEM EQUALLY. tests/
# joined in kindred#2515 -- DECISION: OPTION A, not B. It was missing from the
# very first version of this guard and stayed missing through every widening
# since, so nothing under the pytest tree was ever checked, in either column:
# a full-registry re-measurement (not just the NEEDLES sample) found 17
# comment-line hits across two files under tests/unit/api/services/, all
# rewritten in the same change that added this root. Option B -- exempt
# tests/ deliberately -- was rejected because it is not a coherent rule: this
# guard already scans other test files (frontend/src/**/*.test.ts,
# pocketbase/**/*_test.go) under the code/comment table below, so the same
# comment would fail in a Go test file and pass in a pytest file purely by
# directory. Fixture CODE in a test file stays exempt here exactly as it does
# under every other root -- only the comment split changed.
read -r -a SCAN_ROOTS <<<"${LODGING_SCAN_ROOTS:-pocketbase/ api/ bunking/ frontend/src/ scripts/ tests/}"

# kindred#2551, Option B: resolve which NEEDLES this run actually uses.
# Overridable on the same "ONLY so the test suite can..." principle as
# LODGING_SCAN_ROOTS above -- test-verify-no-hardcoded-lodging.sh forces a
# path that cannot exist for every pre-existing test (determinism, no
# coupling to whichever registry happens to be checked out locally) and
# points this at a small FICTIONAL registry only for the tests that exercise
# registry mode on purpose. Production behavior (no override) is: read
# config/lodging_registry.json when it exists, fall back when it doesn't.
REGISTRY_PATH="${LODGING_REGISTRY_PATH:-config/lodging_registry.json}"
NEEDLES="$FALLBACK_NEEDLES"
FALLBACK_COUNT=$(( $(grep -o '|' <<<"$FALLBACK_NEEDLES" | wc -l) + 1 ))
NEEDLE_ANNOUNCEMENT="fallback sample ($FALLBACK_COUNT terms)"
# ⚠️ STDERR IS CAPTURED SEPARATELY, AND THE BUILDER'S STDOUT IS NEVER ECHOED.
# This block used to run the builder with `2>&1`, merging stderr into the same
# variable that holds stdout -- and stdout IS the pattern: every unit name,
# area name, code and alias string in the registry, '|'-joined. Any stderr at
# all from an OTHERWISE SUCCESSFUL build then made `head -n1` non-numeric, and
# the "unexpected output" branch below echoed that whole variable: the entire
# registry printed into a world-readable Actions log on a PUBLIC repo, with the
# guard still exiting 0 and printing OK, so nothing about the run looked wrong.
# It took no bug in the builder to fire -- a DeprecationWarning, PYTHONDEVMODE,
# a sitecustomize/.pth print, or a diagnostic someone adds later all do it.
#
# The rule the diagnostics below follow: the builder's STDERR may be echoed
# (it is name-free by construction -- build_lodging_needles.py only ever writes
# "could not read/parse <path>" shapes there), the captured STDOUT never may.
# TEST 29 in test-verify-no-hardcoded-lodging.sh pins this by simulating the
# stray-stderr trigger and asserting no registry term reaches the output.
if [[ -r "$REGISTRY_PATH" ]]; then
  REGISTRY_ERR=$(mktemp)
  REGISTRY_STATUS=0
  REGISTRY_OUT=$(python3 "$REPO_ROOT/scripts/dev/lib/build_lodging_needles.py" "$REGISTRY_PATH" 2>"$REGISTRY_ERR") \
    || REGISTRY_STATUS=$?
  # ONE emission point for the builder's stderr, and it is unconditional: a
  # stray warning is a thing to see, not to swallow. Safe to show because
  # build_lodging_needles.py only ever writes "could not read/parse <path>"
  # shapes there -- name-free by construction. $REGISTRY_OUT is what must never
  # be echoed, in any branch.
  if [[ -s "$REGISTRY_ERR" ]]; then
    echo "verify-no-hardcoded-lodging: needle builder stderr follows:" >&2
    cat "$REGISTRY_ERR" >&2
  fi
  rm -f "$REGISTRY_ERR"
  if [[ "$REGISTRY_STATUS" -eq 0 ]]; then
    REGISTRY_COUNT=$(head -n1 <<<"$REGISTRY_OUT")
    REGISTRY_PATTERN=$(tail -n +2 <<<"$REGISTRY_OUT")
    if [[ "$REGISTRY_COUNT" =~ ^[0-9]+$ ]] && [[ -n "$REGISTRY_PATTERN" ]]; then
      NEEDLES="$REGISTRY_PATTERN"
      NEEDLE_ANNOUNCEMENT="registry ($REGISTRY_PATH, $REGISTRY_COUNT terms)"
    else
      echo "warning: $REGISTRY_PATH is readable but the needle builder returned unexpected output -- using the fallback sample instead. Any stderr it produced is above; its STDOUT is deliberately not printed, because that is the needle pattern." >&2
    fi
  else
    echo "warning: could not build needles from $REGISTRY_PATH (builder exited $REGISTRY_STATUS) -- using the fallback sample instead. Any stderr it produced is above." >&2
  fi
fi
# A guard that silently degrades to the small sample while still printing OK
# is worse than one that fails loudly -- announce the mode on every run,
# clean or not. TESTs 25-28 in test-verify-no-hardcoded-lodging.sh assert
# this line.
echo "verify-no-hardcoded-lodging: needle source = $NEEDLE_ANNOUNCEMENT"

# Capture grep's OWN status before the filter pipeline swallows it. grep exits
# 0 for matches, 1 for none, and >=2 when the scan itself failed — an
# unreadable or missing search root. The old form sent stderr to /dev/null and
# ended in `|| true`, so a status-2 run produced no hits and printed OK: a
# guard reporting clean on a scan that never happened. Flagged on this script
# in kindred#1867 and asserted by TEST 6 in test-verify-no-hardcoded-lodging.sh.
grep_status=0
RAW=$(grep -rInEi "$NEEDLES" \
  --include='*.go' --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.sh' \
  --exclude-dir=pb_public --exclude-dir=node_modules \
  "${SCAN_ROOTS[@]}" 2>&1) || grep_status=$?

if [[ "$grep_status" -ge 2 ]]; then
  echo "error: grep exited $grep_status — the scan did not run, so this is NOT a clean result:" >&2
  printf '%s\n' "$RAW" >&2
  exit 2
fi

# scripts/ joined SCAN_ROOTS in kindred#2223, and these four files are the
# guard itself: they MUST carry the needles to function (verify's own
# FALLBACK_NEEDLES definition, the test fixtures in
# test-verify-no-hardcoded-lodging.sh, the docstring examples in
# drop_comment_hits.py, and -- since kindred#2551 -- the docstring in
# build_lodging_needles.py, which names the same "El Cap" example
# FALLBACK_NEEDLES's own comment does to explain why every registry-derived
# needle is \b-anchored). Exempted BY PATH, deliberately -- NOT via the
# _test./.test. filter below. That filter is a known blind spot
# (kindred#1909: two real needle-matching literals sailed through it once
# already) and would not even cover the two .sh files here, whose names
# don't match `_test\.` or `\.test\.`.
GUARD_OWN_FILES=(
  "scripts/dev/verify-no-hardcoded-lodging.sh"
  "scripts/dev/test-verify-no-hardcoded-lodging.sh"
  "scripts/dev/lib/drop_comment_hits.py"
  "scripts/dev/lib/build_lodging_needles.py"
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
#
# kindred#2367 narrowed that blind spot for COMMENTS ONLY, and only under
# frontend/src/**: catching needle terms in comments is strictly better than
# catching them only in production code, and a repo-wide measurement found 14
# comment hits across 6 files, split between frontend/src/** (3 hits, 2 files
# -- both fixed at the source in that change) and pocketbase/ Go test files
# (11 hits, 4 files) it had no reason to touch and did not verify against
# sibling in-flight PRs.
#
# kindred#2512 completes the pass #2367 deferred. Comments are now scanned in
# EVERY scan root, not only under frontend/src/**, so the split below is by
# TEST-vs-NOT rather than by directory:
#
#   not a test file -> code hits fail, comment hits fail
#   a test file     -> code hits are exempt, comment hits fail
#
# ...for files under SCAN_ROOTS, which since kindred#2515 is all six roots,
# tests/ included -- see the note there for why it joined and what it cost.
#
# The 18 comment hits this widening newly caught were scrubbed in the same
# change (7 outside test files, including `effective_bathroom`'s own docstring
# and three migration headers; 11 in pocketbase/ Go test comments). #2367 said
# it was leaving the pocketbase/ side "for a future pass, rather than guessing
# at files another issue may be mid-edit on" -- this is that pass.
#
# What is still exempt, and still deliberately: fixture CODE in a test file.
# Real unit names as fixture DATA are legitimate there -- an alias resolver
# test has to resolve the strings staff actually wrote -- and narrowing that
# would fail the many lodging test files built on exactly that. The blind spot
# kindred#1909 found was two needle-matching literals in fixture code, and the
# fix applied there was to scrub them at the source, not to narrow this filter.
# That trade is unchanged; only comments moved.
#
# THE SPLIT IS DECIDED BY THE PATH, AND ONLY BY THE PATH (kindred#2512 review).
# grep -In emits `path:lineno:text`. The first cut of this widening matched an
# unanchored pattern against the WHOLE LINE, so a line's own CONTENT could
# route its file into the test bucket and win the code-hit exemption:
#
#   api/svc.py:12:FIXTURE = "tests/<unit>.json"      -> silently exempted
#   pocketbase/resolver.go:9:var P = "latest/<unit>" -> silently exempted
#
# ('latest/' contains 'test/'.) The pattern it replaced anchored both of its
# alternatives to the path with '^', which is the property that got lost. awk
# splits on ':' and tests $1, so nothing after the path can vote. TEST 14-16
# pin all three shapes.
#
# 'tests?/' must additionally be a whole PATH SEGMENT: '^(.*/)?' can only match
# a prefix ending in '/', so 'test/' has to start the path or follow a slash.
# That keeps frontend/src/test/mockData.ts -- the repo's real shared
# test-helper directory, with no '_test.' or '.test.' in its filename -- inside
# the test bucket (TEST 13, kindred#2367 review) while pocketbase/latest/x.go
# stays out of it.
#
# Written with '[.]' rather than '\.' on purpose: this pattern is handed to awk
# through -v, and awk processes escape sequences in a -v assignment, so gawk
# rewrites '\.' to a bare '.' (matching any character) and warns while doing it.
TEST_FILE_PATTERN='^(.*/)?tests?/|_test[.]|[.]test[.]'
HITS=""
if [[ -n "$RAW" ]]; then
  TEST_RAW=$(printf '%s\n' "$RAW" | awk -F: -v pat="$TEST_FILE_PATTERN" 'NF && $1 ~ pat')
  OTHER_RAW=$(printf '%s\n' "$RAW" | awk -F: -v pat="$TEST_FILE_PATTERN" 'NF && $1 !~ pat')

  HITS=$(printf '%s\n' "$OTHER_RAW" \
    | grep -v 'frontend/src/data/cityGeo\.ts\|frontend/src/data/schoolGeo\.ts' || true)

  # The `|| true` is scoped to grep with a brace group, NOT hung off the whole
  # pipeline (kindred#2512 review). Under `set -euo pipefail` a grep -v that
  # removes EVERY line exits 1, pipefail promotes that to the pipeline's status
  # and `set -e` kills the guard mid-run: exit 1 with nothing printed at all.
  # Reachable because this grep -v matches the path anywhere in the line,
  # including inside a comment's own text. Hanging `|| true` off the end of the
  # pipeline instead would also swallow a python3 crash, which must stay fatal.
  # TEST 17 asserts the guard never exits 1 with an empty report.
  TEST_COMMENT_HITS=""
  if [[ -n "$TEST_RAW" ]]; then
    TEST_COMMENT_HITS=$(printf '%s\n' "$TEST_RAW" \
      | { grep -v 'frontend/src/data/cityGeo\.ts\|frontend/src/data/schoolGeo\.ts' || true; } \
      | python3 "$REPO_ROOT/scripts/dev/lib/drop_comment_hits.py" --only-comments)
  fi
fi

# ⚠️ COMMENTS ARE NO LONGER DROPPED (kindred#2512). This block used to run
# every non-test hit back through drop_comment_hits.py, on the reasoning that
# "prose naming a unit to explain a rule is documentation, not the registry
# living in code" -- which is how a real unit name sat in an `api/` docstring
# and in three migration headers while this guard reported OK.
#
# The reasoning was never wrong about intent, only about consequence: a
# comment is source, it ships in the repo, and a public repo leaks it exactly
# as a literal would. Prose can say what it needs to say without naming a
# building -- all 18 hits this change caught were rewritten, not deleted, and
# none lost its explanatory force.
#
# The historical objection (kindred#1891: it "failed on a docstring in
# lodging_rules.py", reddening an unrelated phase) is spent -- that docstring
# is one of the 18 now scrubbed.
# cityGeo.ts / schoolGeo.ts are unrelated city/school geocoding lookup tables
# (a different feature) that coincidentally contain place-name substrings
# ("Manzanita, OR", "El Capitan, AZ", "Wawona, CA", "Tuolumne City, CA") — not
# the lodging registry. Excluded to keep this guard meaningful.

# TEST_COMMENT_HITS is already comment-only (produced by --only-comments
# above) -- append it here, AFTER the drop-comments step above, not before:
# running it back through that filter would drop the very comment hits it
# exists to report.
if [[ -n "${TEST_COMMENT_HITS:-}" ]]; then
  HITS=$(printf '%s\n%s\n' "$HITS" "$TEST_COMMENT_HITS" | sed '/^$/d')
fi

if [[ -n "$HITS" ]]; then
  echo "FAIL: lodging unit names found in application source (spec 3.8 — registry is data, not code):" >&2
  echo "$HITS" >&2
  exit 1
fi
echo "verify-no-hardcoded-lodging: OK"
