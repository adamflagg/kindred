#!/usr/bin/env bash
# Proves 1500000162's write-in SPLIT against a REAL PocketBase boot.
#
# kindred#2382: `lodging_availability.family_available` answered two unrelated
# questions through one boolean. `true` is a staff<->family ROLE override for
# the weekend and stays; `false` was an OCCUPANCY -- somebody is in the room --
# and moves to `lodging_write_ins`, which 1500000161 created empty.
#
# A green `go test ./...` never proves the PocketBase binary boots, and a
# fresh-DB schema check can never prove a backfill PRESERVES anything -- there
# is nothing in a fresh DB to preserve. So this boots twice: once WITHOUT
# 1500000162 to get a pre-split pair of tables, seeds synthetic rows into the
# source, then boots again WITH the migration and asserts what happened to each
# row. A third boot runs a copy of the migration under a later filename, which
# is the only honest way to test re-runnability when `_migrations` keys on the
# filename.
#
# Every seeded value is FICTIONAL. Production occupant names are real family
# and staff names and must never be dumped into a fixture (CLAUDE.md section 4).
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
MIGRATION="1500000162_lodging_write_ins_backfill.js"
CREATE_MIGRATION="1500000161_lodging_write_ins.js"

for f in "$MIGRATION" "$CREATE_MIGRATION"; do
  [[ -f "$MIG_DIR/$f" ]] || { echo "error: $f not found in $MIG_DIR" >&2; exit 2; }
done

# The registry loader (pocketbase/main.go) runs as a serve hook and ABORTS THE
# BOOT with "lodging registry file present but no season is resolvable" when it
# finds ./config/lodging_registry.json and no season. Every dev checkout that
# ran setup-local-config.sh has that symlink, so running this from the repo
# root -- the normal thing -- would make the boot fail and this script exit 2
# without testing anything. Nothing here reads the registry; the year only has
# to exist. Defaulted rather than forced, so a caller's own season still wins.
export CAMPMINDER_SEASON_ID="${CAMPMINDER_SEASON_ID:-2026}"

echo ">> building pocketbase binary..."
pb_harness_build_binary "$REPO_ROOT/pocketbase" "$PB_BIN"

SCRATCH=$(mktemp -d)
# shellcheck disable=SC2016  # deliberate: $SCRATCH expands when the trap fires, not here
pb_harness_install_trap 'rm -rf "$SCRATCH"'

# The migration set as it stood BEFORE this change: everything but 162. 161 is
# kept, because the destination tables have to exist for a "before" state to be
# the state this migration actually meets.
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

# The destination must exist and be EMPTY, or "the rows moved" is not what the
# assertions below would be measuring.
pre=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_write_ins")
[[ "$pre" == "0" ]] \
  || { echo "error: lodging_write_ins already holds $pre row(s) without $MIGRATION" >&2; exit 2; }

# Four synthetic rows, standing in for the shapes production actually holds: an
# occupancy with a name only (all 21 production rows carry one), an occupancy
# with a name AND a prospective note (3 of the 21), a ROLE release naming
# nobody, and a second weekend so the move cannot be keyed on one session.
# `unit` and `session` are plain TEXT relation columns; nothing here joins them,
# so bare ids keep the fixture free of registry coupling.
sqlite3 "$DB" <<'SQL'
INSERT INTO lodging_availability
  (id, created, updated, session, session_cm_id, year, unit, family_available, occupant_name, note)
VALUES
  ('wi000000000001', '2026-08-01 10:00:00.000Z', '2026-08-01 10:00:00.000Z',
   'sess0000000001', 1000001, 2026, 'unit0000000001', 0, 'Emma Johnson', ''),
  ('wi000000000002', '2026-08-02 10:00:00.000Z', '2026-08-03 11:00:00.000Z',
   'sess0000000001', 1000001, 2026, 'unit0000000002', 0, 'Liam Garcia', 'Back Monday'),
  ('wi000000000003', '2026-08-04 10:00:00.000Z', '2026-08-04 10:00:00.000Z',
   'sess0000000001', 1000001, 2026, 'unit0000000003', 1, '', 'Director away'),
  ('wi000000000004', '2026-08-05 10:00:00.000Z', '2026-08-05 10:00:00.000Z',
   'sess0000000002', 1000002, 2026, 'unit0000000001', 0, 'Ava Martinez', '');
SQL

echo ">> booting WITH $MIGRATION..."
pb_harness_boot "$PB_BIN" "$DB_DIR" "$MIG_DIR" "$SCRATCH/boot-after.log"

# ── WHAT MOVED ──────────────────────────────────────────────────────────────

moved() {
  sqlite3 "$DB" "SELECT id || '|' || unit || '|' || session || '|' || session_cm_id || '|' || year
                 || '|' || occupant_name || '|' || note || '|' || created || '|' || updated
                 FROM lodging_write_ins WHERE id = '$1'"
}

# 1 -- an occupancy with a name only. Every column travels, INCLUDING the
# timestamps: a moved row must keep the day staff actually recorded it rather
# than reporting itself as written by the migration.
got=$(moved wi000000000001)
want='wi000000000001|unit0000000001|sess0000000001|1000001|2026|Emma Johnson||2026-08-01 10:00:00.000Z|2026-08-01 10:00:00.000Z'
[[ "$got" == "$want" ]] || note "row 1 moved as '$got' (expected '$want')"

# 2 -- an occupancy with a prospective note beside the name. Two different
# facts about one write-in, and both have to arrive.
got=$(moved wi000000000002)
want='wi000000000002|unit0000000002|sess0000000001|1000001|2026|Liam Garcia|Back Monday|2026-08-02 10:00:00.000Z|2026-08-03 11:00:00.000Z'
[[ "$got" == "$want" ]] || note "row 2 moved as '$got' (expected '$want')"

# 4 -- a second weekend, same unit. The unique index is keyed on
# (session_cm_id, year, unit), so this row must move alongside row 1 rather
# than colliding with it.
got=$(moved wi000000000004)
want='wi000000000004|unit0000000001|sess0000000002|1000002|2026|Ava Martinez||2026-08-05 10:00:00.000Z|2026-08-05 10:00:00.000Z'
[[ "$got" == "$want" ]] || note "row 4 moved as '$got' (expected '$want')"

# ── WHAT STAYED ─────────────────────────────────────────────────────────────

# 3 -- the ROLE release. Not scenario-scoped, names no occupant, and must be
# exactly where it was: this is the half of the column the owner ruled stays.
left=$(sqlite3 "$DB" "SELECT id || '|' || family_available || '|' || note FROM lodging_availability ORDER BY id")
[[ "$left" == 'wi000000000003|1|Director away' ]] \
  || note "lodging_availability holds '$left' (expected only the release, 'wi000000000003|1|Director away')"

# Nothing was lost between the two tables.
total=$(sqlite3 "$DB" "SELECT (SELECT COUNT(*) FROM lodging_availability) + (SELECT COUNT(*) FROM lodging_write_ins)")
[[ "$total" == "4" ]] || note "4 rows went in and $total came out"

# The DRAFT twin is untouched: still dark in this PR, and it has a `scenario`
# column `lodging_availability` has nowhere to put.
draft=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_write_ins_draft")
[[ "$draft" == "0" ]] || note "lodging_write_ins_draft holds $draft row(s); this migration must not write it"

# ── RE-RUNNABILITY, AGAINST THE STATE THAT ACTUALLY NEEDS IT ────────────────
#
# `_migrations` keys on FILENAME, so PocketBase will not re-run 162 on a second
# boot -- which is also the lever that lets this test it honestly. A byte-for-
# byte COPY under a later filename runs the shipped statements a second time.
# Copying the file rather than re-typing the SQL here is the point: a
# duplicated query in this script would still pass if the migration's own
# guards were deleted.
#
# A plain second run is a WEAK test and was measured to be one: after run 1 the
# source rows are gone, so the INSERT selects nothing whether or not it is
# guarded, and deleting the `NOT EXISTS` clause still passes. The state the
# guard is actually for is a HALF-APPLIED run -- the insert landed, the delete
# did not -- so that is the state this stage builds.
RERUN_DIR="$SCRATCH/pb_migrations_rerun"
mkdir -p "$RERUN_DIR"
cp "$MIG_DIR"/*.js "$RERUN_DIR/"
cp "$MIG_DIR/$MIGRATION" "$RERUN_DIR/1599999999_writein_table_backfill_rerun_probe.js"

# Row 5: an occupancy written the way the application writes one AFTER the
# split, with no source row behind it at all. The re-run must leave it exactly
# alone -- a guard keyed on the wrong side would delete or duplicate it.
#
# Row 6: the half-applied residue. Same (session_cm_id, year, unit) as row 1,
# which already moved, under a DIFFERENT id -- the shape an interrupted run or
# a re-created row leaves behind, and the one the unique index would reject.
# Guarded, the INSERT skips it and the DELETE clears it, so the table converges.
# Unguarded, the INSERT collides and the migration fails the boot.
sqlite3 "$DB" <<'SQL'
INSERT INTO lodging_write_ins
  (id, created, updated, session, session_cm_id, year, unit, occupant_name, note)
VALUES ('wi000000000005', '2026-08-06 10:00:00.000Z', '2026-08-06 10:00:00.000Z',
        'sess0000000001', 1000001, 2026, 'unit0000000009', 'Noah Rivera', '');

INSERT INTO lodging_availability
  (id, created, updated, session, session_cm_id, year, unit, family_available, occupant_name, note)
VALUES ('wi000000000006', '2026-08-07 10:00:00.000Z', '2026-08-07 10:00:00.000Z',
        'sess0000000001', 1000001, 2026, 'unit0000000001', 0, 'Emma Johnson', '');
SQL

write_ins_snapshot() {
  sqlite3 "$DB" "SELECT id || '=' || unit || '|' || occupant_name || '|' || note
                 FROM lodging_write_ins ORDER BY id"
}
before_write_ins=$(write_ins_snapshot)

echo ">> booting again with a re-run probe copy of $MIGRATION..."
pb_harness_boot "$PB_BIN" "$DB_DIR" "$RERUN_DIR" "$SCRATCH/boot-rerun.log"

# Nothing in the destination moved: not the four already there, and not the
# post-split row that never had a source.
after_write_ins=$(write_ins_snapshot)
[[ "$before_write_ins" == "$after_write_ins" ]]   || note "the re-run changed lodging_write_ins; it must be a no-op there.
before:
$before_write_ins
after:
$after_write_ins"

# And the residue is gone, because a copy of it provably exists. The release is
# still the only thing left in the source table.
left=$(sqlite3 "$DB" "SELECT id || '|' || family_available FROM lodging_availability ORDER BY id")
[[ "$left" == 'wi000000000003|1' ]]   || note "after the re-run lodging_availability holds '$left' (expected only the release)"

if [[ "$fail" -ne 0 ]]; then
  echo "verify-writein-table-backfill: FAILED" >&2
  exit 1
fi
echo "verify-writein-table-backfill: OK ($PB_HARNESS_JS_MIGRATION_COUNT js migrations applied)"
