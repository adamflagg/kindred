#!/usr/bin/env bash
# Test for verify-no-hardcoded-lodging.sh
#
# Verifies the guard actually catches a leak (exit 1, naming file:line) and
# is quiet on a clean tree (exit 0).
#
# Probe filenames are chosen deliberately: a probe meant to test CODE hits
# must NOT match `_test.`, `.test.` or a `tests?/` path segment, because the
# guard exempts code hits in a test file (the exemption exists for fixture
# data, not as a loophole). A code probe planted with one of those names would
# report a false green regardless of what it contains. This happened once
# already during review of kindred#1867, which is exactly why this test exists
# (kindred#1869).
#
# COMMENT hits are a different matter since kindred#2512: they fail in a test
# file too, so the probes that deliberately DO carry a test-shaped name
# (TESTs 10, 12, 13, 18, 20, 21) plant comments and assert exit 1. The guard
# decides which bucket a hit lands in from the PATH FIELD alone -- TESTs 14-16
# pin that, after a first cut let a line's own text choose its bucket.

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GUARD_SCRIPT="$HERE/verify-no-hardcoded-lodging.sh"

if [[ ! -x "$GUARD_SCRIPT" ]]; then
  echo "FAIL: $GUARD_SCRIPT not executable or missing" >&2
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)

# Probe paths deliberately avoid the guard's own test-file exclusions (see
# header above) and sit directly under two of the four scanned trees
# (pocketbase/pb_hooks -- application JS -- and api -- Python).
JS_PROBE="$REPO_ROOT/pocketbase/pb_hooks/leak_probe_kindred1869.js"
PY_PROBE="$REPO_ROOT/api/leak_probe_kindred1869.py"

cleanup() { rm -f "$JS_PROBE" "$PY_PROBE"; }
trap cleanup EXIT INT TERM

if [[ -e "$JS_PROBE" || -e "$PY_PROBE" ]]; then
  echo "FAIL: probe path already exists; refusing to clobber" >&2
  exit 1
fi

echo "=== TEST 1: needles in application CODE should exit 1 and name file:line ==="
# Probes are code, not comments: spec 3.8 forbids the registry living in
# source, and a registry lives in string literals. Comments are covered by
# TEST 4, which since kindred#2512 requires the SAME result.
echo 'const UNITS = ["Tuolumne 1"]' > "$JS_PROBE"
echo 'UNITS = ["Manzanita 3"]' > "$PY_PROBE"

set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e

if [[ $rc -ne 1 ]]; then
  echo "FAIL: expected exit 1 with needles present, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! grep -q "pocketbase/pb_hooks/leak_probe_kindred1869.js:1:" <<<"$OUT"; then
  echo "FAIL: output missing js probe file:line" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! grep -q "api/leak_probe_kindred1869.py:1:" <<<"$OUT"; then
  echo "FAIL: output missing py probe file:line" >&2
  echo "$OUT" >&2
  exit 1
fi
echo "PASS: both needles detected with file:line, exit 1"

echo
echo "=== TEST 2: clean tree should exit 0 ==="
rm -f "$JS_PROBE" "$PY_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
if [[ $rc -eq 0 ]]; then
  echo "PASS: clean tree returned 0"
else
  echo "FAIL: clean tree expected exit 0, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 3: probe filenames matching the guard's own test-file exclusion must NOT be used ==="
# Regression for the false-green this test exists to prevent: a leak file
# named like a test file is invisible to the guard by design (it exists to
# skip the guard's OWN fixtures), so asserting that here documents the trap
# rather than re-discovering it by hand next time.
TESTNAME_PROBE="$REPO_ROOT/pocketbase/pb_hooks/leak_probe_kindred1869_test.js"
cleanup2() { rm -f "$TESTNAME_PROBE"; }
trap 'cleanup2; cleanup' EXIT INT TERM
echo 'const UNITS = ["Tuolumne 1"]' > "$TESTNAME_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$TESTNAME_PROBE"
if [[ $rc -eq 0 ]]; then
  echo "PASS: confirmed a _test.js-named probe is excluded (exit 0) -- do not name real probes this way"
else
  echo "FAIL: expected the _test.js-named probe to be silently excluded (exit 0), got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 4: needles in comments and docstrings MUST fail the guard ==="
# ⚠️ THIS TEST WAS INVERTED IN kindred#2512. It asserted the opposite until
# then -- that prose naming a unit does NOT trip the guard -- and this is a
# REWRITE, not an adaptation: the specification changed, the implementation
# did not drift from it.
#
# The original reasoning (kindred#1891) was that a docstring naming two units
# to explain why merging changes bathroom privacy is "prose about a rule, not
# the registry living in code", and that failing on it opened an unrelated
# phase on a red that was not theirs.
#
# What that reasoning missed: a comment is source. It ships in the repo and a
# public repo leaks it exactly as a literal does. The exemption is how a real
# building name sat in an `api/` docstring, in three migration headers, in a
# `frontend/src/**` component comment and in eleven Go test comments while
# this guard reported OK -- eighteen hits, found only by widening the scan by
# hand. All were rewritten without losing their explanatory force, which is
# the point: prose can say what it needs to say without naming a building.
#
# The 1891 objection is spent -- that very docstring is one of the eighteen.
cat > "$PY_PROBE" <<'PROBE'
"""Module docstring naming Tuolumne 1 and Tuolumne 2 to explain a rule."""


def rule() -> str:
    """Wawona is a container row, which is why it is excluded.

    Tioga 1 and Tioga 2 are each shared until merged.
    """
    # Manzanita is mentioned here in a comment, deliberately.
    return "ok"
PROBE
cat > "$JS_PROBE" <<'PROBE'
// Le Shack is staff-default; this comment explains why.
/* Half Dome and El Cap are container rows.
   Bayit too. */
module.exports = { ok: true }
PROBE
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$JS_PROBE" "$PY_PROBE"
if [[ $rc -eq 1 ]]; then
  # Assert it names BOTH probes, not merely that something failed: a guard
  # that caught only the Python docstring and silently dropped the JS comment
  # would still exit 1 here and would still be half broken.
  if grep -q "leak_probe_kindred1869.py" <<<"$OUT" && grep -q "leak_probe_kindred1869.js" <<<"$OUT"; then
    echo "PASS: prose in comments and docstrings trips the guard, in both languages"
  else
    echo "FAIL: exit 1 but the report did not name both probes" >&2
    echo "$OUT" >&2
    exit 1
  fi
else
  echo "FAIL: expected exit 1 for comment/docstring mentions, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 5: a unit list in a MIGRATION should exit 1 ==="
# The registry used to live in pb_migrations/, so the guard used to skip that
# directory entirely. Now that the data lives in the private
# config/lodging_registry.json, the exclusion would be a hole in exactly the
# place a future seed would land -- this asserts it is gone. Prose in a
# migration is NO LONGER fine either (kindred#2512 inverted TEST 4); this
# probe is a literal, which has always failed.
MIG_PROBE="$REPO_ROOT/pocketbase/pb_migrations/9999999999_leak_probe_kindred1909.js"
cleanup3() { rm -f "$MIG_PROBE"; }
trap 'cleanup3; cleanup' EXIT INT TERM
echo 'const UNITS = ["Tuolumne 1", "Manzanita 3"]' > "$MIG_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$MIG_PROBE"
if [[ $rc -ne 1 ]]; then
  echo "FAIL: expected exit 1 for a unit list in pb_migrations/, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! grep -q "9999999999_leak_probe_kindred1909.js:1:" <<<"$OUT"; then
  echo "FAIL: output missing migration probe file:line" >&2
  echo "$OUT" >&2
  exit 1
fi
echo "PASS: a unit list in pb_migrations/ is caught"

echo
echo "=== TEST 6: a failed scan must exit 2, not report a clean tree ==="
# kindred#1867 flagged this on this script and it shipped unfixed: grep exits 2
# on an unreadable or missing search root, but stderr went to /dev/null and the
# pipeline ended in `|| true`, so the guard printed OK on a scan that never
# ran. A privacy tripwire that false-greens is worse than no tripwire, because
# the green is what gets trusted.
set +e
OUT=$(LODGING_SCAN_ROOTS="definitely_not_a_real_directory_kindred1909/" "$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
if [[ $rc -ne 2 ]]; then
  echo "FAIL: expected exit 2 when the scan root is missing, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! grep -q 'the scan did not run' <<<"$OUT"; then
  echo "FAIL: exit 2 but no explanation that the scan did not run" >&2
  echo "$OUT" >&2
  exit 1
fi
if grep -q 'verify-no-hardcoded-lodging: OK' <<<"$OUT"; then
  echo "FAIL: a failed scan still printed OK" >&2
  echo "$OUT" >&2
  exit 1
fi
echo "PASS: a failed scan exits 2 and says so"

echo
echo "=== TEST 7: a needle on the CLOSING line of a multi-line JSX comment MUST fail ==="
# kindred#2181: this is the exact shape that carried a real unit name past
# review on `main` until #2178 scrubbed it at the source -- a two-line JSX
# {/* ... */} comment whose needle sits on the second line, alongside the
# closing */}. The dropper's line-level check used to require the WHOLE line
# to be blank once comment content was stripped, and a JSX comment's own
# `{`/`}` scaffolding survived that strip as leftover "code", so this needle
# never got dropped even though it sits in ordinary documentation prose.
#
# ⚠️ INVERTED IN kindred#2512, and the earlier rationale for the inversion was
# wrong -- corrected in that PR's review after instrumenting the guard. Since
# comments fail everywhere, a NON-test .tsx like this probe never reaches
# drop_comment_hits.py at all: the hit is reported straight out of the
# not-a-test bucket. So this test no longer covers the #2181 fused-brace
# parsing in any way, and it passes with that logic deleted -- measured, not
# assumed.
#
# What it does still prove is worth keeping: a needle sitting inside a
# multi-line JSX comment in an ordinary frontend component is REPORTED, which
# is the exact file shape and comment shape that carried a real unit name on
# `main` until #2178. TEST 21 is the one that covers the fused-brace
# classification, by planting the same shape in a TEST file so the hit has to
# go through the dropper to be seen.
TSX_PROBE="$REPO_ROOT/frontend/src/leak_probe_kindred2181.tsx"
cleanup4() { rm -f "$TSX_PROBE"; }
trap 'cleanup4; cleanup3; cleanup' EXIT INT TERM
cat > "$TSX_PROBE" <<'PROBE'
export function Probe() {
  return (
    <div>
      {/* The area, because the row it came from is now behind a
          backdrop and "which Tioga is this" is the first question. */}
      <span>hi</span>
    </div>
  );
}
PROBE
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$TSX_PROBE"
if [[ $rc -eq 1 ]] && grep -q "leak_probe_kindred2181.tsx" <<<"$OUT"; then
  echo "PASS: a needle on a JSX comment's closing */} line is reported"
else
  echo "FAIL: expected exit 1 naming the probe for a needle inside a multi-line JSX comment, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 8: scripts/ must be scanned by DEFAULT (no LODGING_SCAN_ROOTS override) ==="
# kindred#2223: SCAN_ROOTS never included scripts/, so a real leak
# (scripts/dev/import_master_housing.py) sat on `main`, tracked and public,
# with this guard reporting clean on every PR. That file has since been
# deleted — the widening it motivated has not, and this test is why: the next
# script to land under scripts/ gets scanned without anyone remembering to ask.
# This asserts the widening: a
# needle planted under scripts/ must be caught with NO env override at all --
# unlike TEST 6, which deliberately overrides LODGING_SCAN_ROOTS to prove a
# *missing* root fails loudly. This test proves scripts/ is a *default* root.
SCRIPTS_PROBE="$REPO_ROOT/scripts/dev/leak_probe_kindred2223.py"
cleanup5() { rm -f "$SCRIPTS_PROBE"; }
trap 'cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
echo 'UNITS = ["Tuolumne 1"]' > "$SCRIPTS_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$SCRIPTS_PROBE"
if [[ $rc -ne 1 ]]; then
  echo "FAIL: expected exit 1 for a needle under scripts/ with no override, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! grep -q "scripts/dev/leak_probe_kindred2223.py:1:" <<<"$OUT"; then
  echo "FAIL: output missing scripts/ probe file:line" >&2
  echo "$OUT" >&2
  exit 1
fi
echo "PASS: a needle under scripts/ is caught with no env override"

echo
echo "=== TEST 9: a .sh file must be scanned (kindred#2223 CodeRabbit finding) ==="
# The --include list never carried '*.sh', so a leak in a NEW shell script
# under any scan root -- most plausibly scripts/, now that it is scanned --
# would sail through invisibly. The guard's own two .sh files are exempted
# BY PATH already (see GUARD_OWN_FILES above), so widening --include to *.sh
# cannot re-trip on them.
SH_PROBE="$REPO_ROOT/scripts/dev/leak_probe_kindred2223_sh.sh"
cleanup6() { rm -f "$SH_PROBE"; }
trap 'cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
echo '# echo "Ridge Yurt 1"' > "$SH_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$SH_PROBE"
if [[ $rc -ne 1 ]]; then
  echo "FAIL: expected exit 1 for a needle in a .sh file, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! grep -q "scripts/dev/leak_probe_kindred2223_sh.sh:1:" <<<"$OUT"; then
  echo "FAIL: output missing .sh probe file:line" >&2
  echo "$OUT" >&2
  exit 1
fi
echo "PASS: a needle in a .sh file is caught"

echo
echo "=== TEST 10: a needle in a COMMENT inside a frontend/src/** test file should exit 1 ==="
# kindred#2367: the blanket test-file exemption (TEST 4's grep -v pattern)
# used to drop every hit in a test file, comment prose and fixture code alike
# -- so a real unit name in a test's explanatory comment sailed through the
# same way a fixture literal legitimately does. Catching needle terms in
# comments is strictly better than catching them only in production code;
# this asserts the widening for frontend/src/**, the surface it was scoped to
# (see the guard's own comment on why it stops there).
FE_TEST_PROBE="$REPO_ROOT/frontend/src/leak_probe_kindred2367.test.ts"
cleanup7() { rm -f "$FE_TEST_PROBE"; }
trap 'cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
cat > "$FE_TEST_PROBE" <<'PROBE'
// Regression comment naming Kitty to explain a fixture below.
export {}
PROBE
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$FE_TEST_PROBE"
if [[ $rc -ne 1 ]]; then
  echo "FAIL: expected exit 1 for a needle in a frontend/src/** test comment, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! grep -q "frontend/src/leak_probe_kindred2367.test.ts:1:" <<<"$OUT"; then
  echo "FAIL: output missing frontend test-comment probe file:line" >&2
  echo "$OUT" >&2
  exit 1
fi
echo "PASS: a needle in a frontend/src/** test file's comment is caught"

echo
echo "=== TEST 11: a needle in FIXTURE CODE inside a frontend/src/** test file must still exit 0 ==="
# The widening in TEST 10 targets comments only. A real unit name as a
# fixture literal is the exact, deliberate case the test-file exemption
# exists for (lodging_alias_resolver_test.go, LodgingUnitForm.test.tsx, and
# others hardcode real unit names on purpose) -- this proves TEST 10 did not
# also start failing that.
FE_TEST_CODE_PROBE="$REPO_ROOT/frontend/src/leak_probe_kindred2367_code.test.ts"
cleanup8() { rm -f "$FE_TEST_CODE_PROBE"; }
trap 'cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
echo 'export const UNIT = "Kitty"' > "$FE_TEST_CODE_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$FE_TEST_CODE_PROBE"
if [[ $rc -eq 0 ]]; then
  echo "PASS: a needle as fixture code in a frontend/src/** test file is still exempt"
else
  echo "FAIL: expected exit 0 for a needle as fixture code, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 12: a needle in a COMMENT inside a non-frontend test file MUST fail too ==="
# ⚠️ INVERTED IN kindred#2512. This asserted exit 0 until then, because #2367
# scoped its comment-scanning widening to frontend/src/** and said so:
# "leaves the pocketbase/ side for a future pass, rather than guessing at
# files another issue may be mid-edit on". This IS that future pass, so the
# scoping this test pinned is no longer the spec.
#
# It was not a hypothetical gap: eleven real comment hits were sitting in
# pocketbase/ Go test files, naming buildings and areas, with the guard green
# on every PR. They are scrubbed in the same change as this inversion.
#
# Fixture CODE in a test file remains exempt -- TEST 11 pins that for the
# frontend and the assertion below deliberately does not extend to it.
GO_TEST_PROBE="$REPO_ROOT/pocketbase/leak_probe_kindred2367_test.go"
cleanup9() { rm -f "$GO_TEST_PROBE"; }
trap 'cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
printf 'package pocketbase\n\n// Regression comment naming Kitty to explain a fixture below.\n' > "$GO_TEST_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$GO_TEST_PROBE"
if [[ $rc -eq 1 ]] && grep -q "leak_probe_kindred2367_test.go" <<<"$OUT"; then
  echo "PASS: a needle in a non-frontend test file's comment is caught"
else
  echo "FAIL: expected exit 1 naming the probe for a non-frontend test comment, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 13: a needle in a COMMENT under frontend/src/test/ (shared test helpers, not *.test.ts) must exit 1 too ==="
# A file directly under frontend/src/test/ -- the repo's real shared
# test-helper directory (mockData.ts, mocks/, testUtils.tsx, test-helpers.ts)
# -- has no '_test.' or '.test.' in its filename, so the guard's split can only
# recognise it as a test file through the 'tests?/' path-segment alternative
# ('/test/' is 'tests?' with the optional s absent). kindred#2367 added that
# alternative after a leak here fell through to the blanket code-hit exemption
# instead of the comment scan.
#
# The variable names this comment used to cite (FRONTEND_TEST_PATTERN,
# FRONTEND_TEST_RAW) went away with the frontend-only scoping in kindred#2512;
# the property they existed for is now carried by TEST_FILE_PATTERN's
# '^(.*/)?tests?/' alternative, and losing its '^' anchor is what TESTs 14-16
# exist to catch.
FE_TEST_DIR_PROBE="$REPO_ROOT/frontend/src/test/leak_probe_kindred2367_dir.ts"
cleanup10() { rm -f "$FE_TEST_DIR_PROBE"; }
trap 'cleanup10; cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
cat > "$FE_TEST_DIR_PROBE" <<'PROBE'
// Regression comment naming Kitty to explain a fixture below.
export {}
PROBE
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$FE_TEST_DIR_PROBE"
if [[ $rc -ne 1 ]]; then
  echo "FAIL: expected exit 1 for a needle in a frontend/src/test/ comment, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! grep -q "frontend/src/test/leak_probe_kindred2367_dir.ts:1:" <<<"$OUT"; then
  echo "FAIL: output missing frontend/src/test/ comment probe file:line" >&2
  echo "$OUT" >&2
  exit 1
fi
echo "PASS: a needle in a frontend/src/test/ file's comment is caught"

echo
echo "=== TEST 14: a needle in CODE in a NON-test file whose text contains 'tests/' must still fail ==="
# kindred#2512 review. The test/not-test split is matched against grep's whole
# `path:lineno:text` line, so before this was fixed a line's CONTENT could route
# its own file into the test bucket -- where code hits are exempt -- and the
# leak went unreported. The split now looks at the PATH FIELD ONLY.
CONTENT_TESTS_PROBE="$REPO_ROOT/api/leak_probe_kindred2512_content.py"
cleanup11() { rm -f "$CONTENT_TESTS_PROBE"; }
trap 'cleanup11; cleanup10; cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
echo 'FIXTURE = "tests/Tuolumne 1.json"' > "$CONTENT_TESTS_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$CONTENT_TESTS_PROBE"
if [[ $rc -eq 1 ]] && grep -q "api/leak_probe_kindred2512_content.py:1:" <<<"$OUT"; then
  echo "PASS: a 'tests/' substring in the LINE does not exempt a non-test file"
else
  echo "FAIL: expected exit 1 naming the probe; a line's text routed its file into the test bucket, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 15: 'latest/' in a line's text must not exempt a non-test file ==="
# The nastier half of TEST 14: 'latest/' CONTAINS 'test/', so the unanchored
# pattern fired on an ordinary version-path string with no test file in sight.
LATEST_PROBE="$REPO_ROOT/pocketbase/leak_probe_kindred2512_latest.go"
cleanup12() { rm -f "$LATEST_PROBE"; }
trap 'cleanup12; cleanup11; cleanup10; cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
printf 'package pocketbase\n\nvar Path = "latest/Manzanita 3"\n' > "$LATEST_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$LATEST_PROBE"
if [[ $rc -eq 1 ]] && grep -q "pocketbase/leak_probe_kindred2512_latest.go:3:" <<<"$OUT"; then
  echo "PASS: 'latest/' in a line's text does not exempt a non-test file"
else
  echo "FAIL: expected exit 1 naming the probe for a 'latest/' string, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 16: '_test.' inside a path-like STRING must not exempt a non-test file ==="
# Covers the other alternative of the split pattern. The needle itself sits
# inside the path-like literal here, which is how a fixture-path constant in
# production code would actually look.
STRPATH_PROBE="$REPO_ROOT/api/leak_probe_kindred2512_strpath.py"
cleanup13() { rm -f "$STRPATH_PROBE"; }
trap 'cleanup13; cleanup12; cleanup11; cleanup10; cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
echo 'FIXTURE = "golden/Tuolumne_1_test.json"' > "$STRPATH_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$STRPATH_PROBE"
if [[ $rc -eq 1 ]] && grep -q "api/leak_probe_kindred2512_strpath.py:1:" <<<"$OUT"; then
  echo "PASS: '_test.' inside a string literal does not exempt a non-test file"
else
  echo "FAIL: expected exit 1 naming the probe for a '_test.' string literal, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 17: the guard must never exit 1 with an empty report ==="
# kindred#2512 review. Under `set -euo pipefail` the test-bucket pipeline had
# no `|| true`: when its cityGeo/schoolGeo filter removed EVERY line of a
# non-empty test bucket, grep exited 1, pipefail propagated it and `set -e`
# killed the script mid-run -- exit 1 with nothing printed. A red guard with no
# message is worse than a wrong green, because there is nothing to act on.
# The scan root is narrowed so the planted comment is the only hit in the
# bucket; that is what makes the filter empty it.
SILENT_DIR="$REPO_ROOT/pocketbase/leak_probe_kindred2512_silent"
SILENT_PROBE="$SILENT_DIR/probe_test.go"
cleanup14() { rm -rf "$SILENT_DIR"; }
trap 'cleanup14; cleanup13; cleanup12; cleanup11; cleanup10; cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
mkdir -p "$SILENT_DIR"
printf 'package probe\n\n// See frontend/src/data/cityGeo.ts for why Tuolumne 1 matches there.\n' > "$SILENT_PROBE"
set +e
OUT=$(LODGING_SCAN_ROOTS="pocketbase/leak_probe_kindred2512_silent/" "$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -rf "$SILENT_DIR"
if [[ $rc -eq 1 && -z "${OUT//[[:space:]]/}" ]]; then
  echo "FAIL: the guard exited 1 and printed NOTHING -- a silent failure" >&2
  exit 1
fi
if [[ $rc -ne 0 ]]; then
  echo "FAIL: the only hit was filtered out, so the guard should report OK; got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! grep -q 'verify-no-hardcoded-lodging: OK' <<<"$OUT"; then
  echo "FAIL: expected the OK line, got: $OUT" >&2
  exit 1
fi
echo "PASS: a filter that empties the test bucket does not kill the guard"

echo
echo "=== TEST 18: a needle in a '#' COMMENT inside a test .sh file must fail ==="
# kindred#2512 review. The guard greps '*.sh', but drop_comment_hits.py knew
# only .py and the C-style suffixes and returned "no comment lines" for
# everything else -- so under --only-comments a shell comment was classified as
# code and silently exempted. The PR's own rule table said a test file's
# comment hits fail; for shell that was simply untrue.
SH_TEST_PROBE="$REPO_ROOT/scripts/dev/leak_probe_kindred2512_test.sh"
cleanup15() { rm -f "$SH_TEST_PROBE"; }
trap 'cleanup15; cleanup14; cleanup13; cleanup12; cleanup11; cleanup10; cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
printf '#!/usr/bin/env bash\n# Comment naming Tuolumne 1 to explain a fixture below.\n' > "$SH_TEST_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$SH_TEST_PROBE"
if [[ $rc -eq 1 ]] && grep -q "scripts/dev/leak_probe_kindred2512_test.sh:2:" <<<"$OUT"; then
  echo "PASS: a needle in a shell comment inside a test .sh file is caught"
else
  echo "FAIL: expected exit 1 naming the .sh test-comment probe, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 19: a needle in fixture CODE inside a test .sh file must still exit 0 ==="
# The mirror of TEST 18, and the reason TEST 18's fix had to teach the dropper
# shell comments rather than just exempt .sh wholesale: fixture code in a test
# file stays exempt in every language, shell included.
SH_TEST_CODE_PROBE="$REPO_ROOT/scripts/dev/leak_probe_kindred2512_code_test.sh"
cleanup16() { rm -f "$SH_TEST_CODE_PROBE"; }
trap 'cleanup16; cleanup15; cleanup14; cleanup13; cleanup12; cleanup11; cleanup10; cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
printf '#!/usr/bin/env bash\nUNITS="Manzanita 3"\n' > "$SH_TEST_CODE_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$SH_TEST_CODE_PROBE"
if [[ $rc -eq 0 ]]; then
  echo "PASS: a needle as fixture code in a test .sh file is still exempt"
else
  echo "FAIL: expected exit 0 for a needle as .sh fixture code, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 20: a needle in a comment inside an UNPARSEABLE .py test file must fail ==="
# kindred#2512 review. drop_comment_hits.py's docstring promises fail-OPEN --
# "a file that will not parse or read is treated as ALL CODE, so its hits
# survive" -- but under --only-comments "all code" means "all dropped", which
# is fail-CLOSED. A tokenize failure therefore made a real comment leak
# invisible. Unknown now means "keep the hit" in BOTH directions.
BROKEN_PY_PROBE="$REPO_ROOT/api/leak_probe_kindred2512_broken_test.py"
cleanup17() { rm -f "$BROKEN_PY_PROBE"; }
trap 'cleanup17; cleanup16; cleanup15; cleanup14; cleanup13; cleanup12; cleanup11; cleanup10; cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
printf '# Comment naming Manzanita to explain a fixture below.\nUNITS = (\n' > "$BROKEN_PY_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$BROKEN_PY_PROBE"
if [[ $rc -eq 1 ]] && grep -q "api/leak_probe_kindred2512_broken_test.py:1:" <<<"$OUT"; then
  echo "PASS: an unparseable test file keeps its hits instead of swallowing them"
else
  echo "FAIL: expected exit 1 naming the unparseable .py probe, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 21: a needle on the closing line of a JSX comment in a TEST .tsx file must fail ==="
# kindred#2512 review. TEST 7 plants the same shape in a NON-test file, which
# since #2512 never reaches drop_comment_hits.py at all -- so TEST 7 passes
# with the #2181 fused-brace logic deleted and cannot be the regression cover
# for it. This probe can: a test file's hits DO go through the dropper, and
# `*/}` on the closing line is exactly the shape the fusion exists to classify
# as comment rather than leftover code. Verified by mutation -- with the two
# `jsx and ...` branches disabled this probe reports exit 0 while TEST 7 still
# reports exit 1.
TSX_TEST_PROBE="$REPO_ROOT/frontend/src/leak_probe_kindred2512_jsx.test.tsx"
cleanup18() { rm -f "$TSX_TEST_PROBE"; }
trap 'cleanup18; cleanup17; cleanup16; cleanup15; cleanup14; cleanup13; cleanup12; cleanup11; cleanup10; cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
cat > "$TSX_TEST_PROBE" <<'PROBE'
export function Probe() {
  return (
    <div>
      {/* The area, because the row it came from is now behind a
          backdrop and "which Tioga is this" is the first question. */}
      <span>hi</span>
    </div>
  );
}
PROBE
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$TSX_TEST_PROBE"
if [[ $rc -eq 1 ]] && grep -q "frontend/src/leak_probe_kindred2512_jsx.test.tsx:5:" <<<"$OUT"; then
  echo "PASS: the JSX fused-brace classification is covered end-to-end"
else
  echo "FAIL: expected exit 1 naming line 5 of the JSX test probe, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 22: a LOWERCASE needle in a comment must fail ==="
# kindred#2512 review. The raw scan was case-sensitive, so the lowercase unit
# CODES the codebase actually uses in prose ("gt-<unit>", "<unit>-new-trailer")
# sailed past a needle list written in title case. Seven such comment hits were
# sitting in tracked source when this was found.
LOWER_PROBE="$REPO_ROOT/api/leak_probe_kindred2512_lower.py"
cleanup19() { rm -f "$LOWER_PROBE"; }
trap 'cleanup19; cleanup18; cleanup17; cleanup16; cleanup15; cleanup14; cleanup13; cleanup12; cleanup11; cleanup10; cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
echo '# comment naming manzanita in lowercase, deliberately.' > "$LOWER_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$LOWER_PROBE"
if [[ $rc -eq 1 ]] && grep -q "api/leak_probe_kindred2512_lower.py:1:" <<<"$OUT"; then
  echo "PASS: a lowercase needle in a comment is caught"
else
  echo "FAIL: expected exit 1 naming the lowercase probe, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "All tests passed."
