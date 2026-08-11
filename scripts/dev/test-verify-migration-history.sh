#!/usr/bin/env bash
# Test for verify-migration-history.sh
#
# Verifies the documented exit contract:
#   0 — the dev DB's _migrations history is consistent with pb_migrations/ on disk
#   1 — a diagnosed problem (renumbered migration, or a CREATE that will collide)
#   2 — harness error (unreadable DB, missing migrations dir, sqlite3 absent, ...)
#
# kindred#2245. The hazard: PocketBase's isMigrationApplied keys on the EXACT
# filename (core/migrations_runner.go:265-272), so renumbering a migration that
# a dev DB already applied makes PB treat it as brand new. An ALTER silently
# re-runs; a CREATE fails the boot with "Collection name must be unique".
#
# Two cases must BOTH be caught, and the second is the load-bearing one:
#
#   (i)  the stale _migrations row still exists  — TEST 3
#   (ii) history-sync already ate it             — TEST 4
#
# Case (ii) is what actually happened: RemoveMissingAppliedMigrations
# (DELETE FROM _migrations WHERE file NOT IN (on-disk names)) runs from the
# OnServe hook on every SUCCESSFUL boot, so any boot during the window when
# `main` did not yet carry the renumbered file destroys the evidence. A
# detector that only implements TEST 3 would have reported clean on the very
# machine that could not boot.

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
VERIFY_SCRIPT="$HERE/verify-migration-history.sh"
REAL_MIGRATIONS="$REPO_ROOT/pocketbase/pb_migrations"

if [[ ! -x "$VERIFY_SCRIPT" ]]; then
  echo "FAIL: $VERIFY_SCRIPT not executable or missing" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "FAIL: sqlite3 not on PATH (needed to build fixtures)" >&2
  exit 1
fi

SCRATCH=$(mktemp -d -t pb-mighist-test-XXXX)
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

# Build a scratch DB carrying only the two tables the detector reads.
# $1 = db path. Reads newline-separated "file" rows on stdin for _migrations.
make_db() {
  local db="$1"
  sqlite3 "$db" \
    "CREATE TABLE _migrations (file TEXT PRIMARY KEY, applied INTEGER);
     CREATE TABLE _collections (id TEXT PRIMARY KEY, name TEXT);"
}

add_migration_row() { sqlite3 "$1" "INSERT INTO _migrations (file, applied) VALUES ('$2', 1);"; }
add_collection_row() { sqlite3 "$1" "INSERT INTO _collections (id, name) VALUES ('pbc_$RANDOM$RANDOM', '$2');"; }

# A migrations dir holding just the named real migration files.
make_migrations_dir() {
  local dir="$1"; shift
  mkdir -p "$dir"
  local f
  for f in "$@"; do
    cp "$REAL_MIGRATIONS/$f" "$dir/$f"
  done
}

fail() { echo "FAIL: $1" >&2; [[ -n "${2:-}" ]] && echo "$2" >&2; exit 1; }

echo "=== TEST 1: the repo's own dev DB and migration set must be consistent ==="
# Not a fixture — the real thing. If this goes red, either the detector has a
# false positive or the machine genuinely needs the recovery in
# docs/reference/pocketbase-migrations.md.
REPO_DB="$REPO_ROOT/pocketbase/pb_data/data.db"
if [[ -f "$REPO_DB" ]]; then
  set +e
  OUT=$("$VERIFY_SCRIPT" --db "$REPO_DB" --migrations-dir "$REAL_MIGRATIONS" 2>&1)
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    fail "expected exit 0 against the repo's own DB, got $rc" "$OUT"
  fi
  echo "PASS: the repo's dev DB is consistent with pb_migrations/"
else
  echo "SKIP: no pocketbase/pb_data/data.db in this checkout"
fi

echo
echo "=== TEST 2: an ABSENT database is exit 0, not a harness error ==="
# A fresh clone has no pb_data/. That is not a fault, and returning 2 here
# would make start_dev.sh refuse to boot on a first run.
set +e
OUT=$("$VERIFY_SCRIPT" --db "$SCRATCH/definitely-not-here.db" --migrations-dir "$REAL_MIGRATIONS" 2>&1)
rc=$?
set -e
[[ $rc -eq 0 ]] || fail "expected exit 0 for an absent DB, got $rc" "$OUT"
echo "PASS: absent DB returns 0"

echo
echo "=== TEST 3: stale-row renumber fingerprint (the evidence survived) ==="
# _migrations remembers 1500000144_lodging_friend_groups.js; only
# 1500000146_lodging_friend_groups.js is on disk. Same slug, different number.
DB3="$SCRATCH/t3.db"; DIR3="$SCRATCH/t3-migrations"
make_db "$DB3"
make_migrations_dir "$DIR3" 1500000146_lodging_friend_groups.js
add_migration_row "$DB3" "1500000144_lodging_friend_groups.js"
set +e
OUT=$("$VERIFY_SCRIPT" --db "$DB3" --migrations-dir "$DIR3" 2>&1)
rc=$?
set -e
[[ $rc -eq 1 ]] || fail "expected exit 1 for a renumbered migration, got $rc" "$OUT"
grep -q "1500000144_lodging_friend_groups.js" <<<"$OUT" || fail "output must name the OLD filename" "$OUT"
grep -q "1500000146_lodging_friend_groups.js" <<<"$OUT" || fail "output must name the NEW filename" "$OUT"
echo "PASS: renumber detected and both filenames reported"

echo
echo "=== TEST 4: collision predictor — history-sync already ate the row ==="
# THE LOAD-BEARING CASE. _migrations carries NO trace of the old name, so the
# fingerprint in TEST 3 has nothing to match on. The only remaining signal is
# that an UNAPPLIED migration creates a collection that already exists.
DB4="$SCRATCH/t4.db"; DIR4="$SCRATCH/t4-migrations"
make_db "$DB4"
make_migrations_dir "$DIR4" 1500000146_lodging_friend_groups.js
add_collection_row "$DB4" "lodging_friend_groups"
add_collection_row "$DB4" "lodging_friend_group_members"
set +e
OUT=$("$VERIFY_SCRIPT" --db "$DB4" --migrations-dir "$DIR4" 2>&1)
rc=$?
set -e
[[ $rc -eq 1 ]] || fail "expected exit 1 when an unapplied CREATE would collide, got $rc" "$OUT"
grep -q "lodging_friend_groups" <<<"$OUT" || fail "output must name the colliding collection" "$OUT"
grep -q "1500000146_lodging_friend_groups.js" <<<"$OUT" || fail "output must name the migration file" "$OUT"
echo "PASS: collision predicted with no _migrations evidence at all"

echo
echo "=== TEST 5: SINGLE-quoted name: must be extracted ==="
# 1500000139_lodging_slot_merges.js writes name: 'lodging_slot_merges'. A
# double-quote-only regex misses it and reports clean. This repo has already
# shipped one scanner that passed because it only looked for sampled needles
# (verify-no-hardcoded-lodging.sh); do not add a second.
DB5="$SCRATCH/t5.db"; DIR5="$SCRATCH/t5-migrations"
make_db "$DB5"
make_migrations_dir "$DIR5" 1500000139_lodging_slot_merges.js
add_collection_row "$DB5" "lodging_slot_merges"
set +e
OUT=$("$VERIFY_SCRIPT" --db "$DB5" --migrations-dir "$DIR5" 2>&1)
rc=$?
set -e
[[ $rc -eq 1 ]] || fail "expected exit 1 — a single-quoted name: was not extracted, got $rc" "$OUT"
grep -q "lodging_slot_merges" <<<"$OUT" || fail "output must name the single-quoted collection" "$OUT"
echo "PASS: single-quoted name: extracted"

echo
echo "=== TEST 6: .go rows with no file on disk are NEVER reported ==="
# PB's own system migrations are compiled in, not on disk. Treating them as
# stale would fire on every single boot, and deleting them breaks the next one
# (pocketbase/main.go documents this).
DB6="$SCRATCH/t6.db"; DIR6="$SCRATCH/t6-migrations"
make_db "$DB6"
mkdir -p "$DIR6"
add_migration_row "$DB6" "1640988000_init.go"
add_migration_row "$DB6" "1717233556_v0.23_migrate.go"
add_migration_row "$DB6" "1778828400_normalize_indexes.go"
set +e
OUT=$("$VERIFY_SCRIPT" --db "$DB6" --migrations-dir "$DIR6" 2>&1)
rc=$?
set -e
[[ $rc -eq 0 ]] || fail "expected exit 0 — .go system migrations must be ignored, got $rc" "$OUT"
echo "PASS: .go rows ignored"

echo
echo "=== TEST 7: the gitignored *_updated_users.js outlier is excluded ==="
# pocketbase/CLAUDE.md documents this file as intentionally untracked, so it
# is applied but absent from a fresh checkout's pb_migrations/.
DB7="$SCRATCH/t7.db"; DIR7="$SCRATCH/t7-migrations"
make_db "$DB7"
mkdir -p "$DIR7"
add_migration_row "$DB7" "1769791931_updated_users.js"
set +e
OUT=$("$VERIFY_SCRIPT" --db "$DB7" --migrations-dir "$DIR7" 2>&1)
rc=$?
set -e
[[ $rc -eq 0 ]] || fail "expected exit 0 — *_updated_users.js is a documented outlier, got $rc" "$OUT"
echo "PASS: updated_users outlier excluded"

echo
echo "=== TEST 8: an unapplied migration that collides with NOTHING is clean ==="
# The ordinary case: a genuinely new migration waiting to be applied. It must
# not be confused with a renumber, or every pull would fail the boot.
DB8="$SCRATCH/t8.db"; DIR8="$SCRATCH/t8-migrations"
make_db "$DB8"
make_migrations_dir "$DIR8" 1500000146_lodging_friend_groups.js
set +e
OUT=$("$VERIFY_SCRIPT" --db "$DB8" --migrations-dir "$DIR8" 2>&1)
rc=$?
set -e
[[ $rc -eq 0 ]] || fail "expected exit 0 for a normal pending migration, got $rc" "$OUT"
echo "PASS: a normal pending migration is not flagged"

echo
echo "=== TEST 9: a missing migrations directory is a harness error (2) ==="
DB9="$SCRATCH/t9.db"
make_db "$DB9"
set +e
OUT=$("$VERIFY_SCRIPT" --db "$DB9" --migrations-dir "$SCRATCH/no-such-dir" 2>&1)
rc=$?
set -e
[[ $rc -eq 2 ]] || fail "expected exit 2 for a missing migrations dir, got $rc" "$OUT"
echo "PASS: missing migrations dir returns 2"

echo
echo "=== TEST 10: the failure message must cite the recovery documentation ==="
# The PocketBase error a user actually sees ("Collection name must be unique")
# contains no term they could search the docs for. If this script does not
# hand them the page, nothing will.
set +e
OUT=$("$VERIFY_SCRIPT" --db "$DB4" --migrations-dir "$DIR4" 2>&1)
set -e
grep -q "docs/reference/pocketbase-migrations.md" <<<"$OUT" \
  || fail "failure output must cite docs/reference/pocketbase-migrations.md" "$OUT"
echo "PASS: recovery doc cited"

echo
echo "All tests passed."
