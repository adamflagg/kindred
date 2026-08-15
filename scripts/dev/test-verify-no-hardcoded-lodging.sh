#!/usr/bin/env bash
# Test for verify-no-hardcoded-lodging.sh
#
# Verifies the guard actually catches a leak (exit 1, naming file:line) and
# is quiet on a clean tree (exit 0).
#
# Probe filenames are chosen deliberately: they must NOT match `_test.`,
# `.test.`, or `/tests?/`, because the guard itself excludes any hit whose
# path matches those patterns (grep -v '_test\.\|\.test\.\|/tests\?/') --
# meant to skip the guard's own test fixtures, not to be a loophole. A probe
# planted with one of those names would report a false green regardless of
# what it contains. This happened once already during review of kindred#1867,
# which is exactly why this test exists (kindred#1869).

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
# TEST 4, which requires the opposite result.
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
echo "=== TEST 4: needles in comments and docstrings should NOT fail the guard ==="
# kindred#1891: the guard failed on api/services/lodging_rules.py, whose
# docstring names two units to explain why merging changes bathroom privacy.
# That is prose about a rule, not the registry living in code -- and because
# HANDOFF tells the next agent to run this gate, it opened Phase C on a red
# that was not theirs.
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
if [[ $rc -eq 0 ]]; then
  echo "PASS: prose in comments and docstrings does not trip the guard"
else
  echo "FAIL: expected exit 0 for comment/docstring-only mentions, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 5: a unit list in a MIGRATION should exit 1 ==="
# The registry used to live in pb_migrations/, so the guard used to skip that
# directory entirely. Now that the data lives in the private
# config/lodging_registry.json, the exclusion would be a hole in exactly the
# place a future seed would land -- this asserts it is gone. Prose in a
# migration is still fine; TEST 4 covers that, and this probe is a literal.
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
echo "=== TEST 7: a needle on the CLOSING line of a multi-line JSX comment should NOT fail ==="
# kindred#2181: this is the exact shape that carried a real unit name past
# review on `main` until #2178 scrubbed it at the source -- a two-line JSX
# {/* ... */} comment whose needle sits on the second line, alongside the
# closing */}. The dropper's line-level check used to require the WHOLE line
# to be blank once comment content was stripped, and a JSX comment's own
# `{`/`}` scaffolding survived that strip as leftover "code", so this needle
# never got dropped even though it sits in ordinary documentation prose.
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
if [[ $rc -eq 0 ]]; then
  echo "PASS: a needle on a JSX comment's closing */} line does not trip the guard"
else
  echo "FAIL: expected exit 0 for a needle inside a multi-line JSX comment, got $rc" >&2
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
echo "=== TEST 12: a needle in a COMMENT inside a non-frontend test file must still exit 0 ==="
# The comment-scanning widening is deliberately scoped to frontend/src/**
# (measured blast radius: kindred#2367 PR body). A Go test file's comment
# stays exempted -- narrowing this far, not repo-wide, is the point.
GO_TEST_PROBE="$REPO_ROOT/pocketbase/leak_probe_kindred2367_test.go"
cleanup9() { rm -f "$GO_TEST_PROBE"; }
trap 'cleanup9; cleanup8; cleanup7; cleanup6; cleanup5; cleanup4; cleanup3; cleanup' EXIT INT TERM
printf 'package pocketbase\n\n// Regression comment naming Kitty to explain a fixture below.\n' > "$GO_TEST_PROBE"
set +e
OUT=$("$GUARD_SCRIPT" 2>&1)
rc=$?
set -e
rm -f "$GO_TEST_PROBE"
if [[ $rc -eq 0 ]]; then
  echo "PASS: a needle in a non-frontend test file's comment is still exempt"
else
  echo "FAIL: expected exit 0 for a needle in a non-frontend test comment, got $rc" >&2
  echo "$OUT" >&2
  exit 1
fi

echo
echo "=== TEST 13: a needle in a COMMENT under frontend/src/test/ (shared test helpers, not *.test.ts) must exit 1 too ==="
# FRONTEND_TEST_PATTERN is '^frontend/src/.*(_test\.|\.test\.|/tests?/)'. A
# file directly under frontend/src/test/ -- the repo's real shared test-helper
# directory (mockData.ts, mocks/, testUtils.tsx, test-helpers.ts) -- has no
# '_test.' or '.test.' in its filename, so it can only match via '/tests?/'.
# It does match that alternative ('/test/' is 'tests?' with the optional s
# absent), which routes it into OTHER_RAW's blanket exemption instead of
# FRONTEND_TEST_RAW's comment-only scan -- so a comment leak here sails
# through exactly the same way test-file comments used to everywhere, the gap
# kindred#2367 exists to close for frontend/src/**.
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
echo "All tests passed."
