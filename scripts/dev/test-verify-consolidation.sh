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
# Enumerate via nullglob so an empty $MIGRATIONS_DIR fails with a clear
# "no .js files" message instead of `cp` exiting under set -e on an
# unexpanded literal `*.js`.
shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.js)
shopt -u nullglob
if [[ ${#migrations[@]} -eq 0 ]]; then
  echo "FAIL: no .js files in $MIGRATIONS_DIR" >&2
  exit 1
fi
cp "${migrations[@]}" "$SCRATCH/modified/"
# Produce reliable structural drift by truncating the migration list at the
# newest migration that actually CHANGES THE SCHEMA, dropping it and
# everything after it.
#
# Two constraints force that shape, and each one broke a simpler version:
#
#  1. The tail is not necessarily structural. Bash globs sort alphabetically
#     so `migrations[-1]` is the newest file, but 1500000162 is a pure DATA
#     backfill -- it moves rows between two collections that already exist
#     and alters no schema. Dropping it leaves byte-identical schemas, the
#     verifier correctly exits 0, and this test fails while nothing is wrong.
#     (The previous revision predicted exactly this in a caveat, unhandled.)
#
#  2. A migration cannot be removed from the MIDDLE. Dropping 1500000161 --
#     which creates `lodging_write_ins` -- while leaving 1500000162, which
#     backfills into it, makes the chain error out: the harness reports
#     exit 2 rather than the exit 1 this test asserts.
#
# Removing a SUFFIX is always chain-safe, because a prefix of an ordered
# migration set is exactly what a younger database has already applied. The
# remaining set applies cleanly, and the dropped structural migration
# guarantees the schema differs. This keeps the end-to-end "drift in a REAL
# migration" intent -- these are unmodified repo migrations -- while
# surviving any number of data-only migrations landing on the tail.
structural_re='new Collection\(|deleteCollection|fields\.add|fields\.remove|addIndex|removeIndex|\.indexes'
cut_index=-1
for (( i=${#migrations[@]}-1; i>=0; i-- )); do
  if grep -Eq "$structural_re" "${migrations[i]}"; then
    cut_index=$i
    break
  fi
done
if [[ $cut_index -lt 1 ]]; then
  echo "FAIL: no structural migration found after index 0 in $MIGRATIONS_DIR;" >&2
  echo "      cannot truncate to produce drift while leaving a non-empty set" >&2
  exit 1
fi
for (( i=cut_index; i<${#migrations[@]}; i++ )); do
  rm "$SCRATCH/modified/$(basename "${migrations[i]}")"
done
echo "  (dropped $(( ${#migrations[@]} - cut_index )) migration(s) from $(basename "${migrations[cut_index]}") onward -- newest schema change and its dependents)"
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
