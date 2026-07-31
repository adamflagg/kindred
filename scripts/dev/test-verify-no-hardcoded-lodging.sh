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
echo "All tests passed."
