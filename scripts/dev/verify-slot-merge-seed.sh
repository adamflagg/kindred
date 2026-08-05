#!/usr/bin/env bash
# The backfill in 1500000138 must set default_combined on exactly the
# containers carrying a measured `sleeps`. A FRESH database proves nothing —
# the migration runs before the registry loader (SeedRegistry is on OnServe,
# main.go:154), so it updates an empty table. Run this against a SEEDED db.
#
# No unit names here: verify-no-hardcoded-lodging.sh scans this tree.
set -euo pipefail
DB="${1:-pocketbase/pb_data/data.db}"
[ -f "$DB" ] || { echo "error: no database at $DB" >&2; exit 2; }

combined=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_units WHERE default_combined = 1;")
expected=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_units WHERE is_container = 1 AND sleeps > 0;")
leaked=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_units WHERE default_combined = 1 AND (is_container = 0 OR sleeps IS NULL OR sleeps = 0);")

echo "combined=$combined expected=$expected leaked=$leaked"
[ "$combined" = "$expected" ] || { echo "FAIL: backfill count mismatch" >&2; exit 1; }
[ "$expected" -gt 0 ] || { echo "FAIL: no measured containers — is the db seeded?" >&2; exit 1; }
[ "$leaked" = "0" ] || { echo "FAIL: default_combined set on a leaf or unmeasured row" >&2; exit 1; }

cols=$(sqlite3 "$DB" "SELECT COUNT(*) FROM pragma_table_info('lodging_slot_merges') WHERE name IN ('unit','session','session_cm_id','year','scenario','combined');")
[ "$cols" = "6" ] || { echo "FAIL: lodging_slot_merges missing fields (found $cols/6)" >&2; exit 1; }

# Names alone don't catch a cascadeDelete regression — assert the values.
# session must stay FALSE (kindred#1879: a vanishing camp_session must 400 on
# the orphan delete, not silently sweep its lodging_slot_merges rows). unit
# and scenario must stay TRUE (a merge of a deleted building/scenario holds no
# human's placement worth preserving). These three differ on purpose; a future
# "tidy them to match" edit is exactly the regression this guards against.
cascade() {
  sqlite3 "$DB" "SELECT json_extract(f.value,'\$.cascadeDelete') FROM _collections c, json_each(c.fields) f WHERE c.name='lodging_slot_merges' AND json_extract(f.value,'\$.name')='$1';"
}
unit_cascade=$(cascade unit)
session_cascade=$(cascade session)
scenario_cascade=$(cascade scenario)
[ "$unit_cascade" = "1" ] || { echo "FAIL: lodging_slot_merges.unit.cascadeDelete must be true (got $unit_cascade)" >&2; exit 1; }
[ "$session_cascade" = "0" ] || { echo "FAIL: lodging_slot_merges.session.cascadeDelete must be false — kindred#1879 (got $session_cascade)" >&2; exit 1; }
[ "$scenario_cascade" = "1" ] || { echo "FAIL: lodging_slot_merges.scenario.cascadeDelete must be true (got $scenario_cascade)" >&2; exit 1; }

# session_cm_id must be required with min=1, not merely present by name.
scm_required=$(sqlite3 "$DB" "SELECT json_extract(f.value,'\$.required') FROM _collections c, json_each(c.fields) f WHERE c.name='lodging_slot_merges' AND json_extract(f.value,'\$.name')='session_cm_id';")
scm_min=$(sqlite3 "$DB" "SELECT json_extract(f.value,'\$.min') FROM _collections c, json_each(c.fields) f WHERE c.name='lodging_slot_merges' AND json_extract(f.value,'\$.name')='session_cm_id';")
[ "$scm_required" = "1" ] || { echo "FAIL: lodging_slot_merges.session_cm_id must be required (got $scm_required)" >&2; exit 1; }
[ "$scm_min" = "1" ] || { echo "FAIL: lodging_slot_merges.session_cm_id min must be 1 (got $scm_min)" >&2; exit 1; }

# The unique index must cover exactly (unit, session, year, scenario), in
# that order — "some unique index exists" doesn't rule out one over the wrong
# columns.
idxname=$(sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lodging_slot_merges' AND sql LIKE '%UNIQUE%' LIMIT 1;")
[ -n "$idxname" ] || { echo "FAIL: lodging_slot_merges has no unique index" >&2; exit 1; }
idxcols=$(sqlite3 "$DB" "SELECT group_concat(name, ',') FROM (SELECT name FROM pragma_index_info('$idxname') ORDER BY seqno);")
[ "$idxcols" = "unit,session,year,scenario" ] || { echo "FAIL: lodging_slot_merges unique index covers wrong columns (got $idxcols)" >&2; exit 1; }
echo "OK"
