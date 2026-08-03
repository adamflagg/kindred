#!/usr/bin/env bash
# Applies pocketbase/pb_migrations to a throwaway DB and asserts the lodging
# schema.
#
# Exit codes: 0 = all assertions passed. 1 = one or more assertions FAILED.
# 2 = could not run the check at all (missing tool/binary, PocketBase never
# booted). Assertions do NOT short-circuit: note() records a failure and
# execution continues, so a run reports EVERY violation at once rather than
# stopping at the first — that is what makes the FAIL count usable as progress.
#
# Why serve-and-kill, the jsvm symlink trick, and the "0 .js migrations
# applied" smoke check all live in scripts/dev/lib/pb-harness.sh, shared with
# scripts/dev/verify-consolidation.sh and scripts/dev/verify-lodging-seed.sh.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/pb-harness.sh
source "$HERE/lib/pb-harness.sh"

# Check tools up front so a missing one exits 2 (cannot run) rather than 127
# midway through, which would read as an assertion failure. git is in the
# list and the list runs BEFORE the first git call — checking after invoking
# it would never fire.
pb_harness_require_tools

REPO_ROOT=$(git rev-parse --show-toplevel)
PB_BIN="$REPO_ROOT/pocketbase/pocketbase"
MIG_DIR="$REPO_ROOT/pocketbase/pb_migrations"

[[ -x "$PB_BIN" ]] || { echo "error: $PB_BIN missing; run: cd pocketbase && go build -o pocketbase ." >&2; exit 2; }

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

for c in lodging_areas lodging_units lodging_unit_aliases \
         lodging_availability lodging_assignments lodging_assignment_history; do
  n=$(sqlite3 "$DB" "SELECT COUNT(*) FROM _collections WHERE name = '$c'")
  [[ "$n" -eq 1 ]] || note "collection $c missing"
done

# field_prop <collection> <field> <json-path> — prints the property value, or
# empty string if the collection or field is absent. Callers compare the result.
field_prop() {
  sqlite3 "$DB" "SELECT json_extract(value, '\$.$3') FROM _collections, json_each(_collections.fields) WHERE _collections.name = '$1' AND json_extract(value, '\$.name') = '$2'"
}

# Guard against the options:{} trap — a silently-ignored max shows up as 5000.
for f in name code notes; do
  v=$(field_prop lodging_units "$f" max || true)
  [[ -n "$v" && "$v" != "5000" ]] || note "lodging_units.$f max is '$v' (expected an explicit non-default limit; 5000 means options:{} was ignored)"
done

bt=$(field_prop lodging_units bathroom values || true)
[[ "$bt" == '["none","private","shared"]' ]] || note "lodging_units.bathroom values are $bt (expected [\"none\",\"private\",\"shared\"])"

ad=$(field_prop lodging_units allocation_default values || true)
[[ "$ad" == '["family_pool","staff_default"]' ]] || note "lodging_units.allocation_default values are $ad"

# Amenity columns added by 1500000131 for the inventory seed. Asserted by TYPE,
# because a bool written where a select belongs is the difference between
# "not assessed" and a confident "no" (see has_ramp below).
for f in has_heat is_weatherized has_plumbing has_space_heater \
         has_pack_play_space has_living_room has_kitchen has_lights; do
  t=$(field_prop lodging_units "$f" type || true)
  [[ "$t" == "bool" ]] || note "lodging_units.$f type is '$t' (expected bool)"
done

# has_ramp is deliberately NOT a bool. The source column is mostly blank, and a
# bool maps every unassessed cabin to "no ramp" — asserting a fact about
# step-free access that nobody checked. Empty select = not assessed, the same
# discipline as `sleeps: null` never rendering 0.
rt=$(field_prop lodging_units has_ramp type || true)
[[ "$rt" == "select" ]] || note "lodging_units.has_ramp type is '$rt' (expected select, so blank can mean 'not assessed')"
rv=$(field_prop lodging_units has_ramp values || true)
[[ "$rv" == '["yes","no","partial"]' ]] || note "lodging_units.has_ramp values are $rv (expected [\"yes\",\"no\",\"partial\"])"
rr=$(field_prop lodging_units has_ramp required || true)
[[ "$rr" != "1" && "$rr" != "true" ]] || note "lodging_units.has_ramp is required (must be optional: blank means not assessed)"

# max_beds is the sheet's total sleeping spots. It is NOT sleeps, which is a
# staff judgement for the session type and disagrees with it on most units —
# HANDOFF §6, spaces not beds. Both columns exist precisely so neither
# overwrites the other.
mb=$(field_prop lodging_units max_beds type || true)
[[ "$mb" == "number" ]] || note "lodging_units.max_beds type is '$mb' (expected number)"
mbi=$(field_prop lodging_units max_beds onlyInt || true)
[[ "$mbi" == "1" || "$mbi" == "true" ]] || note "lodging_units.max_beds onlyInt is '$mbi' (expected true)"
mbx=$(field_prop lodging_units max_beds max || true)
[[ -z "$mbx" || "$mbx" == "null" ]] || note "lodging_units.max_beds max is '$mbx' (expected null for unbounded)"

st=$(field_prop lodging_availability state values || true)
[[ "$st" == '["reserved_staff","reserved_other","released_to_family"]' ]] || note "lodging_availability.state values are $st"

# Unbounded numbers must be null, not 0 (0 would reject positive values).
mx=$(field_prop lodging_units sleeps max || true)
[[ -z "$mx" || "$mx" == "null" ]] || note "lodging_units.sleeps max is '$mx' (expected null for unbounded)"

# Aliases bind 2+ units, so member_units must be multi-select.
ms=$(field_prop lodging_unit_aliases member_units maxSelect || true)
[[ -n "$ms" && "$ms" != "1" ]] || note "lodging_unit_aliases.member_units maxSelect is '$ms' (expected >1 or null)"

# 1500000134 collapsed unit/merge/merge_draft into this one multi-valued
# relation: a placement can name a SET of rooms instead of joining a merge
# table. maxSelect 20 carries over the merge tables' own member cap
# (hooks.go:109-123); cascadeDelete is false so deleting a unit does not
# silently shrink a placement out from under staff; required is false
# because an empty set is a real state -- an orphan on the truth table, the
# "took this party off the board" tombstone on the draft.
for c in lodging_assignments lodging_assignments_draft; do
  ms=$(field_prop "$c" units maxSelect || true)
  [[ "$ms" == "999" ]] || note "$c.units maxSelect is '$ms' (expected 20)"
  casc=$(field_prop "$c" units cascadeDelete || true)
  [[ "$casc" == "0" || "$casc" == "false" ]] \
    || note "$c.units cascadeDelete is '$casc' (expected false)"
  req=$(field_prop "$c" units required || true)
  [[ "$req" == "0" || "$req" == "false" || -z "$req" ]] \
    || note "$c.units required is '$req' (expected false)"
done

# Dual-grain uniqueness: the live-row partial indexes must gate on `> 0`, never
# on `!= ''`. PocketBase numbers are `NUMERIC DEFAULT 0 NOT NULL` and SQLite
# evaluates `0 != ''` as TRUE, so `!= ''` would capture every person-grain row
# (household_cm_id = 0), collide them, and permit only ONE adult assignment per
# session. This assertion exists because that bug was caught in review.
for idx in idx_lodging_assign_hh_live idx_lodging_assign_person_live; do
  sql=$(sqlite3 "$DB" "SELECT COALESCE(sql,'') FROM sqlite_master WHERE type='index' AND name='$idx'" || true)
  if [[ -z "$sql" ]]; then
    note "index $idx missing"
  elif [[ "$sql" == *"!= ''"* ]]; then
    note "index $idx uses \"!= ''\" — must be \"> 0\" (0 != '' is TRUE in SQLite; see plan Task 5)"
  elif [[ "$sql" != *"> 0"* ]]; then
    note "index $idx predicate lacks \"> 0\": $sql"
  fi
done

for c in lodging_ingest_issues lodging_field_mappings; do
  n=$(sqlite3 "$DB" "SELECT COUNT(*) FROM _collections WHERE name = '$c'")
  [[ "$n" -eq 1 ]] || note "collection $c missing"
done

# Pinned exactly, and in order: kind is a SELECT, so this list -- not the Go
# constants in lodging_issues.go -- is what PocketBase validates writes against.
# A constant added on the Go side without the matching migration fails at save
# time in production and nowhere else, because the test fixture models kind as a
# plain text field. unknown_party and write_failed arrived in 1500000125.
ik=$(field_prop lodging_ingest_issues kind values || true)
want_ik='["unresolved_alias","ambiguous_alias","ambiguous_session","no_session","field_zero_values","unknown_party","write_failed"]'
[[ "$ik" == "$want_ik" ]] \
  || note "lodging_ingest_issues.kind values are $ik, want $want_ik"

# The dedup index is what keeps a 472-row backfill from writing 472 issue rows.
# Assert its COLUMNS, not just its name: an index that keeps the name but loses a
# key column (dropping `year` would merge every season's queue into one row)
# passes a name-only check while silently breaking dedup. These six must stay in
# step with Issue.dedupKey() in sync/lodging_issues.go.
idx=$(sqlite3 "$DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_lodging_issues_dedup'")
if [[ "$idx" -ne 1 ]]; then
  note "idx_lodging_issues_dedup missing"
else
  dedup_sql=$(sqlite3 "$DB" "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_lodging_issues_dedup'")
  [[ "$dedup_sql" == *UNIQUE* ]] || note "idx_lodging_issues_dedup is not UNIQUE: $dedup_sql"
  for col in year kind raw_value source_field household_cm_id person_cm_id; do
    [[ "$dedup_sql" == *"\`$col\`"* ]] || note "idx_lodging_issues_dedup missing column $col"
  done
fi

fm=$(sqlite3 "$DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_lodging_field_map_cmid'")
[[ "$fm" -eq 1 ]] || note "idx_lodging_field_map_cmid missing"

# Same options:{} trap as above, on the new collections: a silently-ignored max
# shows up as 5000. raw_value is deliberately 500 (wider than alias_string's 300)
# so a truncated request text still fits.
rv=$(field_prop lodging_ingest_issues raw_value max || true)
[[ "$rv" == "500" ]] || note "lodging_ingest_issues.raw_value max is '$rv' (expected 500)"
fn=$(field_prop lodging_field_mappings field_name max || true)
[[ "$fn" == "200" ]] || note "lodging_field_mappings.field_name max is '$fn' (expected 200)"

# Plan 3 links a resolved alias item back to the alias row staff created from it.
ra=$(field_prop lodging_ingest_issues resolved_alias cascadeDelete || true)
[[ "$ra" == "0" || "$ra" == "false" ]] || note "lodging_ingest_issues.resolved_alias cascadeDelete is '$ra' (expected false)"

# kindred#1879: a camp_session vanishing from one CampMinder response must never
# silently take its lodging rows with it. Orphan deletion is year-scoped
# (sessions.go builds "year = N" and passes it to DeleteOrphans), so the exposure
# is the CURRENT sync year only -- but within that year the loss is total and
# silent. session is required on all three, so cascadeDelete = false makes
# PocketBase refuse the parent delete with a 400 instead of cascading.
for c in lodging_availability lodging_assignments lodging_assignments_draft; do
  casc=$(field_prop "$c" session cascadeDelete || true)
  [[ "$casc" == "0" || "$casc" == "false" ]] \
    || note "$c.session cascadeDelete is '$casc' (expected false; see kindred#1879)"
  req=$(field_prop "$c" session required || true)
  [[ "$req" == "1" || "$req" == "true" ]] \
    || note "$c.session required is '$req' -- cascadeDelete=false only blocks the delete while the relation is required"
done

# Each YEAR gets its own camp_sessions row (unique on cm_id + year), so a program
# returning after a gap comes back with a different PB record id. Cross-year
# questions ("same cabin as last year") can only be joined on the CampMinder id,
# which is why the durable key sits beside the relation rather than replacing it.
#
# The required-ness is asymmetric on purpose and has to be checked, not assumed:
# the three placement tables require the durable key so the assignment sync fails
# loudly rather than writing rows that cannot survive a session being recreated,
# while lodging_assignment_history leaves it optional because an audit row is
# meant to outlive its session. A migration flipping either way would otherwise
# pass this verifier in silence.
for c in lodging_availability lodging_assignments lodging_assignment_history \
         lodging_assignments_draft; do
  [[ "$(field_prop "$c" session_cm_id onlyInt || true)" == "1" ]] \
    || note "$c.session_cm_id missing or not onlyInt (see kindred#1879)"

  # PocketBase renders this as a JSON boolean, so json_extract yields 1/0 -- but
  # a false is sometimes omitted from the serialized field entirely, which comes
  # back empty. Treat empty as false rather than as a mismatch.
  req_cm=$(field_prop "$c" session_cm_id required || true)
  if [[ "$c" == "lodging_assignment_history" ]]; then
    [[ "$req_cm" == "0" || "$req_cm" == "false" || -z "$req_cm" ]] \
      || note "$c.session_cm_id required is '$req_cm'; the audit trail must outlive its session (see kindred#1879)"
  else
    [[ "$req_cm" == "1" || "$req_cm" == "true" ]] \
      || note "$c.session_cm_id required is '$req_cm', want required (see kindred#1879)"
  fi
done

# ------------------------------------------------------------- the draft grain
#
# 1500000132. The board writes a DRAFT; the ingest keeps sole ownership of the
# synced record of truth. Summer settled this shape long ago -- staff write
# bunk_assignments_draft and have never held a write on bunk_assignments -- and
# these assertions are what stop lodging drifting off it.
#
# scenario is a property of PLANNING, not of record, so it lives only on the
# draft. Both truth grains carried a dead scenario column (all 67 assignment
# rows had scenario = ''); 1500000132 drops it. The alternative -- widening the
# truth table and scoping staff to non-empty scenarios via a `scenario != ""`
# write rule -- is a guard by convention, one string edit from opening the
# synced rows, and it makes every reader responsible for a filter.

n=$(sqlite3 "$DB" "SELECT COUNT(*) FROM _collections WHERE name = 'lodging_assignments_draft'")
[[ "$n" -eq 1 ]] || note "collection lodging_assignments_draft missing"

# Gone from the truth grain.
sc=$(field_prop lodging_assignments scenario name || true)
[[ -z "$sc" ]] \
  || note "lodging_assignments still carries a scenario field; 1500000132 drops it -- scenario belongs to the draft"

# Present on the drafts, and on lodging_availability -- which is scenario-aware
# IN PLACE rather than through a twin, because nothing syncs into it. There is
# no record of truth there to protect, so the argument above does not apply.
for c in lodging_assignments_draft lodging_availability; do
  sc=$(field_prop "$c" scenario name || true)
  [[ "$sc" == "scenario" ]] || note "$c must carry a scenario field"
done

# Deleting a saved scenario sweeps its drafts server-side. bunk_assignments_draft
# was created with cascadeDelete false and flipped precisely because the client
# was carrying an N+1 pre-delete loop to compensate; do not repeat that.
casc=$(field_prop lodging_assignments_draft scenario cascadeDelete || true)
[[ "$casc" == "1" || "$casc" == "true" ]] \
  || note "lodging_assignments_draft.scenario cascadeDelete is '$casc' (expected true so deleting a scenario sweeps its drafts)"

# The live indexes lose `scenario` and keep `> 0`. Both halves matter: an index
# naming a dropped column cannot be created at all, and the predicate is the
# 0 != '' trap documented at idx_lodging_assign_hh_live above.
for idx in idx_lodging_assign_hh_live idx_lodging_assign_person_live; do
  sql=$(sqlite3 "$DB" "SELECT COALESCE(sql,'') FROM sqlite_master WHERE type='index' AND name='$idx'" || true)
  [[ "$sql" != *scenario* ]] || note "index $idx still keys on scenario: $sql"
done

# The draft's uniqueness is the summer shape carried onto the dual grain: one
# row per party per session PER SCENARIO. The `> 0` predicate is required for
# the same reason as on the truth table -- a person-grain draft row still
# stores household_cm_id = 0, and `!= ''` would collide every one of them.
for idx in idx_lodging_draft_hh idx_lodging_draft_person; do
  sql=$(sqlite3 "$DB" "SELECT COALESCE(sql,'') FROM sqlite_master WHERE type='index' AND name='$idx'" || true)
  if [[ -z "$sql" ]]; then
    note "index $idx missing"
  else
    [[ "$sql" == *UNIQUE* ]] || note "index $idx is not UNIQUE: $sql"
    [[ "$sql" != *"!= ''"* ]] || note "index $idx uses \"!= ''\" -- must be \"> 0\" (0 != '' is TRUE in SQLite)"
    [[ "$sql" == *"> 0"* ]] || note "index $idx predicate lacks \"> 0\": $sql"
    [[ "$sql" == *'`scenario`'* ]] || note "index $idx must key on scenario: $sql"
  fi
done

# Write access, read from the APPLIED schema rather than from the migration
# text. The drafts and the planning tables are what staff write; the synced
# record of truth, its append-only audit trail and the ingest's field map stay
# admin-only. A single loop over both lists is what makes an accidental
# widening fail here instead of in production.
rule_of() { sqlite3 "$DB" "SELECT COALESCE($2,'') FROM _collections WHERE name = '$1'"; }

BUNKING_MANAGE_RULE='@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'
ADMIN_ONLY_RULE='@request.auth.is_admin = true'
AUTHED_READ_RULE='@request.auth.id != ""'

for c in lodging_assignments_draft lodging_availability \
         lodging_areas lodging_units lodging_unit_aliases lodging_ingest_issues; do
  for r in createRule updateRule deleteRule; do
    got=$(rule_of "$c" "$r" || true)
    [[ "$got" == "$BUNKING_MANAGE_RULE" ]] \
      || note "$c.$r is '$got', want the canonical bunking.manage rule"
  done
done

for c in lodging_assignments lodging_assignment_history lodging_field_mappings; do
  for r in createRule updateRule deleteRule; do
    got=$(rule_of "$c" "$r" || true)
    [[ "$got" == "$ADMIN_ONLY_RULE" ]] \
      || note "$c.$r is '$got', want admin-only -- the ingest keeps sole ownership of the record of truth"
  done
done

# Reads stay open on every lodging collection, drafts included. A staff member
# without bunking.manage must still SEE a scenario board (read-only), the same
# way summer renders production mode for everyone; gating the drafts' reads
# would blank the board rather than freeze it.
for c in lodging_assignments_draft lodging_assignments \
         lodging_availability lodging_areas lodging_units lodging_unit_aliases \
         lodging_ingest_issues lodging_assignment_history; do
  for r in listRule viewRule; do
    got=$(rule_of "$c" "$r" || true)
    [[ "$got" == "$AUTHED_READ_RULE" ]] || note "$c.$r is '$got', want $AUTHED_READ_RULE"
  done
done

if [[ "$fail" -ne 0 ]]; then echo "verify-lodging-schema: FAILED" >&2; exit 1; fi
echo "verify-lodging-schema: OK ($js_migs js migrations applied)"
