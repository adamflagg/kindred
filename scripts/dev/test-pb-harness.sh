#!/usr/bin/env bash
# Test for scripts/dev/lib/pb-harness.sh
#
# Verifies the tool-absence contract from kindred#1869: a required tool
# missing from PATH must normalize to exit 2 (harness error), not leak a 127
# from `set -e`/exec failure or get misread by a caller as an assertion
# failure (exit 1). Follows the sandboxed-PATH pattern established in
# test-migration-schema-diff.sh's "missing sqlite3" test.
#
# Covers pb_harness_require_tools directly, plus verify-lodging-schema.sh and
# verify-lodging-seed.sh, which (as of kindred#1868) delegate their own
# tool-absence contract to the shared lib instead of each repeating the
# check -- so the assertion belongs here, once, rather than being
# re-implemented per caller.

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LIB="$HERE/lib/pb-harness.sh"
SCHEMA_SCRIPT="$HERE/verify-lodging-schema.sh"
SEED_SCRIPT="$HERE/verify-lodging-seed.sh"

[[ -f "$LIB" ]] || { echo "FAIL: $LIB missing" >&2; exit 1; }
for f in "$SCHEMA_SCRIPT" "$SEED_SCRIPT"; do
  [[ -x "$f" ]] || { echo "FAIL: $f not executable or missing" >&2; exit 1; }
done

SCRATCH=$(mktemp -d -t pb-harness-test-XXXX)
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

# Every tool any of the exercised code paths might need before the
# tool-absence check fires, so a *different* missing tool never masks the one
# under test. bash/env matter for the two scripts' `#!/usr/bin/env bash`
# shebang; dirname/basename for their `$(dirname "${BASH_SOURCE[0]}")` setup.
ALL_TOOLS=(bash env git sqlite3 curl python3 grep sed awk mktemp rm cat mkdir \
           dirname basename type command ln seq kill wait sleep go jq diff)

# build_sandbox <dir> <excluded tool> -- symlink every tool in ALL_TOOLS into
# <dir> except <excluded tool>, so PATH=<dir> reproduces "every dependency
# present except this one" rather than "nothing present".
build_sandbox() {
  local dir="$1" exclude="$2" tool src
  mkdir -p "$dir"
  for tool in "${ALL_TOOLS[@]}"; do
    [[ "$tool" == "$exclude" ]] && continue
    src="$(command -v "$tool" 2>/dev/null || true)"
    [[ -n "$src" ]] && ln -sf "$src" "$dir/$tool"
  done
}

SANDBOX_NO_SQLITE3="$SCRATCH/no-sqlite3"
build_sandbox "$SANDBOX_NO_SQLITE3" sqlite3

SANDBOX_NO_CURL="$SCRATCH/no-curl"
build_sandbox "$SANDBOX_NO_CURL" curl

echo "=== TEST 1: pb_harness_require_tools exits 2 (not 127) when sqlite3 is missing ==="
set +e
PATH="$SANDBOX_NO_SQLITE3" bash -c "source '$LIB'; pb_harness_require_tools" >/dev/null 2>"$SCRATCH/t1.err"
rc=$?
set -e
if [[ $rc -eq 2 ]] && grep -q "sqlite3" "$SCRATCH/t1.err"; then
  echo "PASS: missing sqlite3 -> exit 2, names sqlite3"
else
  echo "FAIL: missing sqlite3 expected exit 2 naming sqlite3, got rc=$rc; stderr:" >&2
  cat "$SCRATCH/t1.err" >&2
  exit 1
fi

echo
echo "=== TEST 2: pb_harness_require_tools exits 2 (not 127) when curl is missing ==="
set +e
PATH="$SANDBOX_NO_CURL" bash -c "source '$LIB'; pb_harness_require_tools" >/dev/null 2>"$SCRATCH/t2.err"
rc=$?
set -e
if [[ $rc -eq 2 ]] && grep -q "curl" "$SCRATCH/t2.err"; then
  echo "PASS: missing curl -> exit 2, names curl"
else
  echo "FAIL: missing curl expected exit 2 naming curl, got rc=$rc; stderr:" >&2
  cat "$SCRATCH/t2.err" >&2
  exit 1
fi

echo
echo "=== TEST 3: verify-lodging-schema.sh propagates the lib's tool-absence contract (exit 2, not 127) ==="
set +e
PATH="$SANDBOX_NO_SQLITE3" "$SCHEMA_SCRIPT" >/dev/null 2>"$SCRATCH/t3.err"
rc=$?
set -e
if [[ $rc -eq 2 ]]; then
  echo "PASS: verify-lodging-schema.sh with sqlite3 missing -> exit 2"
else
  echo "FAIL: expected exit 2, got $rc; stderr:" >&2
  cat "$SCRATCH/t3.err" >&2
  exit 1
fi

echo
echo "=== TEST 4: verify-lodging-seed.sh propagates the lib's tool-absence contract (exit 2, not 127) ==="
set +e
PATH="$SANDBOX_NO_SQLITE3" "$SEED_SCRIPT" >/dev/null 2>"$SCRATCH/t4.err"
rc=$?
set -e
if [[ $rc -eq 2 ]]; then
  echo "PASS: verify-lodging-seed.sh with sqlite3 missing -> exit 2"
else
  echo "FAIL: expected exit 2, got $rc; stderr:" >&2
  cat "$SCRATCH/t4.err" >&2
  exit 1
fi

echo
echo "All tests passed."
