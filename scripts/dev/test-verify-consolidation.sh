#!/usr/bin/env bash
# Test for verify-consolidation.sh
# Verifies the documented exit contract:
#   0 — proposed and current migration sets produce identical schemas
#   1 — schemas differ
#   2 — harness error (missing dir, smoke check failed, serve never came up, ...)
#
# Critically: exercises the END-TO-END harness against real migration sets,
# not hand-crafted SQLite fixtures. The original v1 harness silently skipped
# JS migrations and reported "schemas match" for empty schemas; this test
# would have failed red on that bug (tests 2 and 3 specifically).

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
VERIFY_SCRIPT="$HERE/verify-consolidation.sh"
MIGRATIONS_DIR="$REPO_ROOT/pocketbase/pb_migrations"

if [[ ! -x "$VERIFY_SCRIPT" ]]; then
  echo "FAIL: $VERIFY_SCRIPT not executable or missing" >&2
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "FAIL: $MIGRATIONS_DIR not found (expected real migration set for E2E test)" >&2
  exit 1
fi

SCRATCH=$(mktemp -d -t pb-verify-test-XXXX)
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

echo "=== TEST 1: identical real migration sets should exit 0 ==="
if "$VERIFY_SCRIPT" "$MIGRATIONS_DIR" "$MIGRATIONS_DIR" >/dev/null 2>"$SCRATCH/t1.err"; then
  echo "PASS: identical real sets returned 0"
else
  rc=$?
  echo "FAIL: identical real sets returned $rc; stderr:" >&2
  cat "$SCRATCH/t1.err" >&2
  exit 1
fi

echo
echo "=== TEST 2: drift in a real migration should exit 1 ==="
mkdir -p "$SCRATCH/modified"
cp "$MIGRATIONS_DIR"/*.js "$SCRATCH/modified/"
# Produce reliable structural drift by omitting the LAST migration
# (lexicographically highest .js file). Picked dynamically so this test
# survives consolidation rounds that absorb the previous tail file.
# Caveat: this assumes the tail migration produces some structural diff
# when removed. If a future tail migration is purely a no-op-on-fresh-DB
# (e.g. fully overwritten by a later mutation), this test could go green
# spuriously — the harness's smoke check still guarantees something was
# applied, but the drift signal would be weak.
LAST_MIGRATION=$(find "$SCRATCH/modified" -maxdepth 1 -name '*.js' -printf '%f\n' | sort | tail -1)
if [[ -z "$LAST_MIGRATION" ]]; then
  echo "FAIL: no .js files in $SCRATCH/modified after copy from $MIGRATIONS_DIR" >&2
  exit 1
fi
rm "$SCRATCH/modified/$LAST_MIGRATION"
set +e
"$VERIFY_SCRIPT" "$SCRATCH/modified" "$MIGRATIONS_DIR" >/dev/null 2>"$SCRATCH/t2.err"
rc=$?
set -e
if [[ $rc -eq 1 ]]; then
  echo "PASS: drift detected (exit 1)"
else
  echo "FAIL: drift expected exit 1, got $rc; stderr:" >&2
  cat "$SCRATCH/t2.err" >&2
  exit 1
fi

echo
echo "=== TEST 3: empty migrations dir should fail smoke check (exit 2) ==="
mkdir -p "$SCRATCH/empty"
set +e
"$VERIFY_SCRIPT" "$SCRATCH/empty" "$MIGRATIONS_DIR" >/dev/null 2>"$SCRATCH/t3.err"
rc=$?
set -e
if [[ $rc -eq 2 ]] && grep -q "smoke check failed" "$SCRATCH/t3.err"; then
  echo "PASS: empty migrations dir → exit 2 with smoke check error"
else
  echo "FAIL: empty migrations dir expected exit 2 + 'smoke check failed' in stderr, got rc=$rc" >&2
  echo "stderr:" >&2
  cat "$SCRATCH/t3.err" >&2
  exit 1
fi

echo
echo "=== TEST 4: nonexistent input dir should exit 2 (harness error) ==="
set +e
"$VERIFY_SCRIPT" "$SCRATCH/nonexistent" "$MIGRATIONS_DIR" >/dev/null 2>"$SCRATCH/t4.err"
rc=$?
set -e
if [[ $rc -eq 2 ]]; then
  echo "PASS: nonexistent input → exit 2"
else
  echo "FAIL: nonexistent input expected exit 2, got $rc" >&2
  exit 1
fi

echo
echo "=== TEST 5: relative-path invocation should still work (regression for canonicalization fix) ==="
# This catches the symlink-with-relative-path footgun. Before canonicalization,
# the harness silently failed when called with relative paths from any cwd.
set +e
( cd "$REPO_ROOT" && "$VERIFY_SCRIPT" pocketbase/pb_migrations pocketbase/pb_migrations >/dev/null 2>"$SCRATCH/t5.err" )
rc=$?
set -e
if [[ $rc -eq 0 ]]; then
  echo "PASS: relative paths handled correctly"
else
  echo "FAIL: relative-path invocation expected exit 0, got $rc; stderr:" >&2
  cat "$SCRATCH/t5.err" >&2
  exit 1
fi

echo
echo "All tests passed."
