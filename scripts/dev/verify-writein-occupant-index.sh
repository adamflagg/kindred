#!/usr/bin/env bash
# Proves 1500000176's index narrowing against a REAL PocketBase boot.
# kindred#2583 step 8.
#
# WHY A LIVE BOOT IS THE GATE FOR THIS CHANGE, and not a formality. The mocked
# repositories in tests/unit/api/services/ use MagicMock, which enforces no
# unique index -- so every defect whose mechanism IS the index is invisible to
# them, and step 8 is by definition the change that moves that index. The
# python suite closes the gap with two fakes that MODEL the narrowed key
# (`_indexed_write_in_repo`, `_StatefulWriteInRepo`), but a model is only worth
# what ties it to the deployed schema. This is that tie: it boots the binary
# against pb_migrations/, reads the applied index off the SQLite file, and then
# asks SQLite itself which inserts it refuses.
#
# Booted TWICE, for the same reason verify-writein-table-backfill.sh boots
# twice: a single "after" boot cannot distinguish "the migration narrowed the
# index" from "the index was already like that". The BEFORE tree omits
# 1500000176 and must refuse the very insert the AFTER tree accepts.
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
MIGRATION="1500000176_lodging_write_in_occupant_index.js"

[[ -f "$MIG_DIR/$MIGRATION" ]] || { echo "error: $MIGRATION not found in $MIG_DIR" >&2; exit 2; }

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

fail=0
note() { echo "FAIL: $*" >&2; fail=1; }

# Runs one INSERT and reports "accepted" or "refused". `set -e` is suspended
# around the call precisely because a refusal is a PASS here for half the
# cases -- letting the failing sqlite3 abort the script would skip every
# assertion after it rather than record one.
insert_outcome() {
  local db="$1" sql="$2" out
  if out=$(sqlite3 "$db" "$sql" 2>&1); then
    echo "accepted"
  else
    case "$out" in
      *UNIQUE*|*"constraint failed"*) echo "refused" ;;
      *) echo "error:$out" ;;
    esac
  fi
}

live_row() {
  # id, unit, occupant_name -- session/session_cm_id/year fixed, which is what
  # makes the unit and the occupant the only axes under test.
  printf "INSERT INTO lodging_write_ins (id, created, updated, session, session_cm_id, year, unit, occupant_name, note, party_size) VALUES ('%s', '2026-08-01 10:00:00.000Z', '2026-08-01 10:00:00.000Z', 'sess0000000001', 1000001, 2026, '%s', '%s', '', 0);" "$1" "$2" "$3"
}

draft_row() {
  # id, unit, scenario, occupant_name
  printf "INSERT INTO lodging_write_ins_draft (id, created, updated, session, session_cm_id, year, unit, scenario, occupant_name, note, party_size) VALUES ('%s', '2026-08-01 10:00:00.000Z', '2026-08-01 10:00:00.000Z', 'sess0000000001', 1000001, 2026, '%s', '%s', '%s', '', 0);" "$1" "$2" "$3" "$4"
}

# ── BEFORE: the tree without 1500000176 ─────────────────────────────────────
#
# Establishes that the narrowing is what changed the answer, rather than the
# answer having always been this.

BEFORE_DIR="$SCRATCH/pb_migrations_before"
mkdir -p "$BEFORE_DIR"
cp "$MIG_DIR"/*.js "$BEFORE_DIR/"
rm -f "$BEFORE_DIR/$MIGRATION"

BEFORE_DB_DIR="$SCRATCH/before/pb_data"
BEFORE_DB="$BEFORE_DB_DIR/data.db"

echo ">> booting WITHOUT $MIGRATION..."
pb_harness_boot "$PB_BIN" "$BEFORE_DB_DIR" "$BEFORE_DIR" "$SCRATCH/boot-before.log"

cols=$(pb_harness_index_columns "$BEFORE_DB" idx_lodging_write_in_unique)
[[ "$cols" == "session_cm_id,unit,year" ]] \
  || note "before: idx_lodging_write_in_unique keys on '$cols' (expected the un-narrowed set)"

got=$(insert_outcome "$BEFORE_DB" "$(live_row wi000000000001 unit0000000001 'Emma Johnson')")
[[ "$got" == "accepted" ]] || note "before: the first write-in on a unit was $got"
got=$(insert_outcome "$BEFORE_DB" "$(live_row wi000000000002 unit0000000001 'Liam Garcia')")
[[ "$got" == "refused" ]] \
  || note "before: a SECOND occupant on one unit was $got -- the un-narrowed index must refuse it, or this script proves nothing"

# ── AFTER: the tree with 1500000176 ─────────────────────────────────────────

DB_DIR="$SCRATCH/after/pb_data"
DB="$DB_DIR/data.db"

echo ">> booting WITH $MIGRATION..."
pb_harness_boot "$PB_BIN" "$DB_DIR" "$MIG_DIR" "$SCRATCH/boot-after.log"

# 1 -- the applied index, read off the schema rather than off the migration
# text. A column SET, not a sequence: pb_harness_index_columns sorts, and
# column order is a query-planner concern this check is not entitled to pin
# (kindred#2032, and that function's header).
cols=$(pb_harness_index_columns "$DB" idx_lodging_write_in_unique)
[[ "$cols" == "occupant_name,session_cm_id,unit,year" ]] \
  || note "idx_lodging_write_in_unique keys on '$cols', want {session_cm_id, year, unit, occupant_name}"

# 2 -- the draft twin KEEPS `scenario` and gains `occupant_name`. Dropping the
# scenario would let two scenarios' rows for one unit collide, which is the
# error the other direction.
cols=$(pb_harness_index_columns "$DB" idx_lodging_write_in_draft_unique)
[[ "$cols" == "occupant_name,scenario,session_cm_id,unit,year" ]] \
  || note "idx_lodging_write_in_draft_unique keys on '$cols', want {session_cm_id, year, unit, scenario, occupant_name}"

# 3 -- and separately, that both are still UNIQUE. pragma_index_info answers
# only which columns an index spans, so a plain index over the same columns
# satisfies the checks above while permitting the double-count this index
# exists to refuse.
for idx in idx_lodging_write_in_unique:lodging_write_ins idx_lodging_write_in_draft_unique:lodging_write_ins_draft; do
  name=${idx%%:*}
  table=${idx##*:}
  uniq=$(sqlite3 "$DB" "SELECT \"unique\" FROM pragma_index_list('$table') WHERE name = '$name';")
  [[ "$uniq" == "1" ]] \
    || note "$name is not UNIQUE (unique flag '$uniq') -- one family entered twice would double-count silently"
done

# ── WHAT THE NARROWED INDEX ACCEPTS AND REFUSES ─────────────────────────────

# 4 -- TWO DIFFERENT OCCUPANTS IN ONE UNIT. The create path the narrowing
# exists to permit, and the one the before-boot above refused.
got=$(insert_outcome "$DB" "$(live_row wi000000000001 unit0000000001 'Emma Johnson')")
[[ "$got" == "accepted" ]] || note "the first write-in on a unit was $got"
got=$(insert_outcome "$DB" "$(live_row wi000000000002 unit0000000001 'Liam Garcia')")
[[ "$got" == "accepted" ]] \
  || note "a second, DIFFERENT occupant on one unit was $got -- this is the whole feature"

# 5 -- THE SAME OCCUPANT TWICE. The collision the narrowed index must still
# refuse: one family of 3 entered twice consumes 6 spots, and a 15-spot cabin
# reports 9 free instead of 12 with nothing anywhere flagging it.
got=$(insert_outcome "$DB" "$(live_row wi000000000003 unit0000000001 'Emma Johnson')")
[[ "$got" == "refused" ]] \
  || note "the SAME occupant written twice into one unit was $got -- that is the double-count the index buys"

# 6 -- A BLANK occupant_name is still a key, and two of them on one unit
# collide exactly as two identical names do. The staff write path refuses a
# blank (api/schemas/lodging.py); the ingest-shaped writers stay permissive,
# which is the only way such a row arrives.
got=$(insert_outcome "$DB" "$(live_row wi000000000004 unit0000000002 '')")
[[ "$got" == "accepted" ]] || note "a single blank-named row was $got -- the ingest path stays permissive"
got=$(insert_outcome "$DB" "$(live_row wi000000000005 unit0000000002 '')")
[[ "$got" == "refused" ]] || note "a SECOND blank-named row on one unit was $got"
got=$(insert_outcome "$DB" "$(live_row wi000000000006 unit0000000002 'Olivia Chen')")
[[ "$got" == "accepted" ]] || note "a named occupant beside a blank-named row was $got"

# 7 -- ANOTHER WEEKEND, same unit and same occupant. session_cm_id and year
# stay in the key, so the weekends do not collide with each other.
other_weekend=$(printf "INSERT INTO lodging_write_ins (id, created, updated, session, session_cm_id, year, unit, occupant_name, note, party_size) VALUES ('wi000000000007', '2026-08-01 10:00:00.000Z', '2026-08-01 10:00:00.000Z', 'sess0000000002', 1000002, 2026, 'unit0000000001', 'Emma Johnson', '', 0);")
got=$(insert_outcome "$DB" "$other_weekend")
[[ "$got" == "accepted" ]] || note "the same occupant on the same unit for a DIFFERENT weekend was $got"

# ── THE DRAFT TWIN ──────────────────────────────────────────────────────────

# 8 -- two different occupants in one unit, inside one scenario.
got=$(insert_outcome "$DB" "$(draft_row wd000000000001 unit0000000001 scen0000000001 'Emma Johnson')")
[[ "$got" == "accepted" ]] || note "draft: the first write-in in a scenario was $got"
got=$(insert_outcome "$DB" "$(draft_row wd000000000002 unit0000000001 scen0000000001 'Liam Garcia')")
[[ "$got" == "accepted" ]] || note "draft: a second, DIFFERENT occupant in one scenario was $got"

# 9 -- the same occupant twice in one scenario still collides.
got=$(insert_outcome "$DB" "$(draft_row wd000000000003 unit0000000001 scen0000000001 'Emma Johnson')")
[[ "$got" == "refused" ]] || note "draft: the SAME occupant written twice into one scenario was $got"

# 10 -- SCENARIO IS RETAINED. Two scenarios may hold the same unit/occupant
# without colliding, which is what 1500000161 put the column in the key for
# and what dropping it here would have broken.
got=$(insert_outcome "$DB" "$(draft_row wd000000000004 unit0000000001 scen0000000002 'Emma Johnson')")
[[ "$got" == "accepted" ]] \
  || note "draft: a SECOND SCENARIO's row for the same unit and occupant was $got -- scenario must stay in the key"

if [[ "$fail" == "0" ]]; then
  echo "PASS: both write-in unique indexes key on occupant_name, and enforce it."
fi
exit "$fail"
