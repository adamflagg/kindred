#!/usr/bin/env bash
# Proves 1500000148's write-in backfill against a REAL PocketBase boot.
#
# kindred#2078: a hold IS a write-in, so every existing `lodging_availability`
# note is an occupant name and moves into `occupant_name`, with the note
# cleared behind it so the same string does not print twice on one card.
#
# A green `go test ./...` never proves the PocketBase binary boots, and a
# fresh-DB schema check can never prove a backfill PRESERVES anything -- there
# is nothing in a fresh DB to preserve. So this boots twice: once WITHOUT
# 1500000148 to get a pre-migration table, seeds synthetic rows into it, then
# boots again WITH the migration and asserts what happened to each row.
#
# Every seeded value is FICTIONAL. Production notes are real family and staff
# names and must never be dumped into a fixture (CLAUDE.md section 4).
#
# Exit codes: 0 = all assertions passed. 1 = one or more FAILED. 2 = could not
# run the check at all. Assertions do not short-circuit.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/pb-harness.sh
source "$HERE/lib/pb-harness.sh"

pb_harness_require_tools

REPO_ROOT=$(git rev-parse --show-toplevel)
PB_BIN="$REPO_ROOT/pocketbase/pocketbase"
MIG_DIR="$REPO_ROOT/pocketbase/pb_migrations"
MIGRATION="1500000148_lodging_availability_occupant_name.js"

[[ -f "$MIG_DIR/$MIGRATION" ]] || { echo "error: $MIGRATION not found in $MIG_DIR" >&2; exit 2; }

# The registry loader (pocketbase/main.go) runs as a serve hook and ABORTS THE
# BOOT with "lodging registry file present but no season is resolvable" when it
# finds ./config/lodging_registry.json and no season. Every dev checkout that
# ran setup-local-config.sh has that symlink, so running this from the repo
# root -- the normal thing -- made the boot fail and the script exit 2 without
# testing anything. Nothing here reads the registry; the year only has to
# exist. Same fix, same reason, as verify-lodging-seed.sh, and defaulted rather
# than forced so a caller's own season still wins.
export CAMPMINDER_SEASON_ID="${CAMPMINDER_SEASON_ID:-2026}"

echo ">> building pocketbase binary..."
pb_harness_build_binary "$REPO_ROOT/pocketbase" "$PB_BIN"

SCRATCH=$(mktemp -d)
# shellcheck disable=SC2016  # deliberate: $SCRATCH expands when the trap fires, not here
pb_harness_install_trap 'rm -rf "$SCRATCH"'

# The migration set as it stood BEFORE this change: everything but 148.
BEFORE_DIR="$SCRATCH/pb_migrations_before"
mkdir -p "$BEFORE_DIR"
cp "$MIG_DIR"/*.js "$BEFORE_DIR/"
rm -f "$BEFORE_DIR/$MIGRATION"

DB_DIR="$SCRATCH/data/pb_data"
DB="$DB_DIR/data.db"

echo ">> booting WITHOUT $MIGRATION..."
pb_harness_boot "$PB_BIN" "$DB_DIR" "$BEFORE_DIR" "$SCRATCH/boot-before.log"

fail=0
note() { echo "FAIL: $*" >&2; fail=1; }

# The column must not exist yet, or the "before" state is not a before state
# and every assertion below is vacuous.
pre=$(sqlite3 "$DB" "SELECT COUNT(*) FROM pragma_table_info('lodging_availability') WHERE name = 'occupant_name'")
[[ "$pre" == "0" ]] \
  || { echo "error: occupant_name already present without $MIGRATION; the before-boot is not a before state" >&2; exit 2; }

# Three synthetic rows, standing in for the shapes production actually holds:
# a plain name, a multi-word name, and a released cabin with no note at all.
# `unit` and `session` are plain TEXT relation columns; nothing here joins them,
# so bare ids keep the fixture free of registry coupling.
sqlite3 "$DB" <<'SQL'
INSERT INTO lodging_availability (id, session, session_cm_id, year, unit, family_available, note)
VALUES
  ('wi000000000001', 'sess0000000001', 1000001, 2026, 'unit0000000001', 0, 'Emma Johnson'),
  ('wi000000000002', 'sess0000000001', 1000001, 2026, 'unit0000000002', 0, 'burst pipe'),
  ('wi000000000003', 'sess0000000001', 1000001, 2026, 'unit0000000003', 1, '');
SQL

echo ">> booting WITH $MIGRATION..."
pb_harness_boot "$PB_BIN" "$DB_DIR" "$MIG_DIR" "$SCRATCH/boot-after.log"

post=$(sqlite3 "$DB" "SELECT COUNT(*) FROM pragma_table_info('lodging_availability') WHERE name = 'occupant_name'")
[[ "$post" == "1" ]] || note "occupant_name column absent after $MIGRATION"

row() { sqlite3 "$DB" "SELECT occupant_name || '|' || note FROM lodging_availability WHERE id = '$1'"; }

# 1 -- the name moved, and the note went with it rather than being printed
# twice on the same card.
got=$(row wi000000000001)
[[ "$got" == "Emma Johnson|" ]] || note "row 1 is '$got' (expected 'Emma Johnson|')"

# 2 -- the accepted cost, shown honestly: there is no second control for "out
# of service", so a pipe is written in as an occupant and stays one.
got=$(row wi000000000002)
[[ "$got" == "burst pipe|" ]] || note "row 2 is '$got' (expected 'burst pipe|')"

# 3 -- a released cabin names no occupant and had no note. Untouched.
got=$(row wi000000000003)
[[ "$got" == "|" ]] || note "row 3 is '$got' (expected '|')"

# Nothing was deleted. The backfill only ever UPDATEs.
n=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_availability")
[[ "$n" == "3" ]] || note "row count is $n after the backfill (expected 3)"

# ── RE-RUNNABILITY ──────────────────────────────────────────────────────────
#
# `_migrations` keys on FILENAME, so PocketBase will not re-run 148 on a second
# boot -- which is also the lever that lets this test it honestly. A byte-for-
# byte COPY under a later filename runs the shipped statements a second time
# against a table run 1 has already touched. Copying the file rather than
# re-typing the SQL here is the point: a duplicated query in this script would
# still pass if the migration's own guards were deleted.
RERUN_DIR="$SCRATCH/pb_migrations_rerun"
mkdir -p "$RERUN_DIR"
cp "$MIG_DIR"/*.js "$RERUN_DIR/"
cp "$MIG_DIR/$MIGRATION" "$RERUN_DIR/1500000149_writein_backfill_rerun_probe.js"

# A fourth row, only reachable once the column exists: an occupant already
# written in, with a note that is genuinely a note. Statement 1 must not
# overwrite the name, and statement 2 must not clear a note that is not a copy
# of it -- those are two different facts about one write-in.
sqlite3 "$DB" <<'SQL'
INSERT INTO lodging_availability (id, session, session_cm_id, year, unit, family_available, note, occupant_name)
VALUES ('wi000000000004', 'sess0000000001', 1000001, 2026, 'unit0000000004', 0, 'Back Monday', 'Liam Garcia');
SQL

before_all=$(sqlite3 "$DB" "SELECT id || '=' || occupant_name || '|' || note FROM lodging_availability ORDER BY id")

echo ">> booting again with a re-run probe copy of $MIGRATION..."
pb_harness_boot "$PB_BIN" "$DB_DIR" "$RERUN_DIR" "$SCRATCH/boot-rerun.log"

after_all=$(sqlite3 "$DB" "SELECT id || '=' || occupant_name || '|' || note FROM lodging_availability ORDER BY id")
[[ "$before_all" == "$after_all" ]] \
  || note "re-running the backfill changed rows; it must be a no-op.
before:
$before_all
after:
$after_all"

if [[ "$fail" -ne 0 ]]; then
  echo "verify-availability-writein-backfill: FAILED" >&2
  exit 1
fi
echo "verify-availability-writein-backfill: OK ($PB_HARNESS_JS_MIGRATION_COUNT js migrations applied)"
