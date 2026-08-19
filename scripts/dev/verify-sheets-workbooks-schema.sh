#!/usr/bin/env bash
# Applies pocketbase/pb_migrations to a throwaway DB and asserts the
# sheets_workbooks schema carries the session dimension that Family Camp roster
# workbooks need (kindred#2433, migration 1500000165).
#
# Exit codes: 0 = all assertions passed. 1 = one or more assertions FAILED.
# 2 = could not run the check at all (missing tool/binary, PocketBase never
# booted). Assertions do NOT short-circuit: note() records a failure and
# execution continues, so a run reports every violation at once.
#
# Why serve-and-kill, the jsvm symlink trick, and the "0 .js migrations
# applied" smoke check live in scripts/dev/lib/pb-harness.sh.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/pb-harness.sh
source "$HERE/lib/pb-harness.sh"

pb_harness_require_tools

REPO_ROOT=$(git rev-parse --show-toplevel)
PB_BIN="$REPO_ROOT/pocketbase/pocketbase"
MIG_DIR="$REPO_ROOT/pocketbase/pb_migrations"

# The registry loader aborts the boot when ./config/lodging_registry.json is
# present and no season resolves. Same defaulting as verify-lodging-schema.sh.
export CAMPMINDER_SEASON_ID="${CAMPMINDER_SEASON_ID:-2026}"

echo ">> building pocketbase binary..."
pb_harness_build_binary "$REPO_ROOT/pocketbase" "$PB_BIN"

SCRATCH=$(mktemp -d)
# shellcheck disable=SC2016  # deliberate: $SCRATCH expands when the trap fires, not here
pb_harness_install_trap 'rm -rf "$SCRATCH"'

DB_DIR="$SCRATCH/data/pb_data"
LOG="$SCRATCH/boot.log"
pb_harness_boot "$PB_BIN" "$DB_DIR" "$MIG_DIR" "$LOG"

DB="$DB_DIR/data.db"
js_migs="$PB_HARNESS_JS_MIGRATION_COUNT"

fail=0
note() { echo "FAIL: $*" >&2; fail=1; }

# field_prop <collection> <field> <json-path> — prints the property value, or an
# empty string when the collection or field is absent.
field_prop() {
  sqlite3 "$DB" "SELECT json_extract(value, '\$.$3') FROM _collections, json_each(_collections.fields) WHERE _collections.name = '$1' AND json_extract(value, '\$.name') = '$2'"
}

n=$(sqlite3 "$DB" "SELECT COUNT(*) FROM _collections WHERE name = 'sheets_workbooks'")
[[ "$n" -eq 1 ]] || note "collection sheets_workbooks missing"

# --- session_cm_id -----------------------------------------------------------
# A roster workbook is per SESSION, so (workbook_type, year) no longer
# identifies one. The column is a CampMinder id, matching the repo-wide rule
# that cross-table relationships key on CampMinder ids and never PocketBase ids.
t=$(field_prop sheets_workbooks session_cm_id type || true)
[[ "$t" == "number" ]] || note "sheets_workbooks.session_cm_id type is '$t' (expected number)"

oi=$(field_prop sheets_workbooks session_cm_id onlyInt || true)
[[ "$oi" == "1" || "$oi" == "true" ]] || note "sheets_workbooks.session_cm_id is not onlyInt (got '$oi')"

# Optional on purpose: the globals and per-year workbooks have no session, and
# PocketBase stores an unset number as 0, which is what keeps their rows unique
# under the re-keyed index below.
req=$(field_prop sheets_workbooks session_cm_id required || true)
[[ "$req" != "1" && "$req" != "true" ]] \
  || note "sheets_workbooks.session_cm_id is required; globals and year workbooks legitimately have none"

# max must be null, not 0. For a NUMBER field PocketBase enforces max:0 as a
# literal ceiling of zero, which would reject every real CampMinder id.
mx=$(field_prop sheets_workbooks session_cm_id max || true)
[[ -z "$mx" ]] || note "sheets_workbooks.session_cm_id max is '$mx' (expected null: max:0 rejects every positive id)"

# --- workbook_type vocabulary ------------------------------------------------
# workbook_type is a SELECT, so PocketBase rejects any value not listed here —
# the Go constants are not the constraint, this list is. Deliberately a closed
# vocabulary rather than one type per session: an unbounded set would break the
# grouping in the admin Sheets tab and turn GetWorkbookByType's filter into id
# string-matching.
wv=$(field_prop sheets_workbooks workbook_type values || true)
[[ "$wv" == '["globals","year","fc_roster"]' ]] \
  || note "sheets_workbooks.workbook_type values are $wv (expected [\"globals\",\"year\",\"fc_roster\"])"

# --- the unique index --------------------------------------------------------
# The original UNIQUE (workbook_type, year) admits ONE workbook per year, so the
# second Family Camp roster of a season would be rejected by the database. The
# session dimension has to be part of the key, not merely a stored column.
key_sql=$(sqlite3 "$DB" "SELECT COALESCE(sql,'') FROM sqlite_master WHERE type='index' AND name='idx_sheets_workbooks_type_year'")
if [[ -z "$key_sql" ]]; then
  note "idx_sheets_workbooks_type_year missing"
else
  [[ "$key_sql" == *UNIQUE* ]] || note "idx_sheets_workbooks_type_year is not UNIQUE: $key_sql"
  # pragma_index_info rather than substring matching: PocketBase pretty-prints a
  # multi-column list across lines.
  cols=$(sqlite3 "$DB" "SELECT group_concat(name, ',') FROM pragma_index_info('idx_sheets_workbooks_type_year')")
  [[ "$cols" == "workbook_type,year,session_cm_id" ]] \
    || note "idx_sheets_workbooks_type_year covers ($cols), want (workbook_type,year,session_cm_id)"
fi

# The spreadsheet-id lookup index is untouched by this change and must survive.
sp=$(sqlite3 "$DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_sheets_workbooks_spreadsheet'")
[[ "$sp" -eq 1 ]] || note "idx_sheets_workbooks_spreadsheet missing"

if [[ "$fail" -ne 0 ]]; then echo "verify-sheets-workbooks-schema: FAILED" >&2; exit 1; fi
echo "verify-sheets-workbooks-schema: OK ($js_migs js migrations applied)"
