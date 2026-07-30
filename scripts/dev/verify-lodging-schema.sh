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
# Why serve-and-kill: `pocketbase migrate up` silently skips JS migrations.
# jsvm captures MigrationsDir at plugin-registration time (before flag parsing),
# so --migrationsDir is a no-op; jsvm always resolves
# filepath.Join(app.DataDir(), "../pb_migrations"). We symlink that path to the
# repo's migrations dir. Same technique as scripts/dev/verify-consolidation.sh.
set -euo pipefail

# Check tools up front so a missing one exits 2 (cannot run) rather than 127
# midway through, which would read as an assertion failure. Same contract as
# scripts/dev/migration-schema-diff.sh. git is in the list and the list runs
# BEFORE the first git call — checking after invoking it would never fire.
for cmd in git sqlite3 curl python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: required command '$cmd' not found" >&2; exit 2; }
done

REPO_ROOT=$(git rev-parse --show-toplevel)
PB_BIN="$REPO_ROOT/pocketbase/pocketbase"
MIG_DIR="$REPO_ROOT/pocketbase/pb_migrations"

[[ -x "$PB_BIN" ]] || { echo "error: $PB_BIN missing; run: cd pocketbase && go build -o pocketbase ." >&2; exit 2; }

SCRATCH=$(mktemp -d)
PB_PID=""
# Trap INT and TERM as well as EXIT, and kill the background PocketBase from
# inside the handler. A signal arriving during the up-to-40s health poll would
# otherwise run only the EXIT handler, deleting $SCRATCH but orphaning a
# `pocketbase serve` bound to the ephemeral port.
cleanup() {
  if [[ -n "$PB_PID" ]]; then
    kill "$PB_PID" 2>/dev/null || true
    wait "$PB_PID" 2>/dev/null || true
  fi
  rm -rf "$SCRATCH"
}
trap cleanup EXIT INT TERM

DB_DIR="$SCRATCH/data/pb_data"
mkdir -p "$DB_DIR"
HOOKS_DIR=$(mktemp -d "$SCRATCH/empty-hooks-XXXX")
# jsvm default resolution: <dataDir>/../pb_migrations
ln -sfn "$MIG_DIR" "$SCRATCH/data/pb_migrations"

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
LOG="$SCRATCH/boot.log"

"$PB_BIN" serve --http="127.0.0.1:$PORT" --dir "$DB_DIR" \
  --hooksDir "$HOOKS_DIR" --automigrate=true > "$LOG" 2>&1 &
PB_PID=$!

ok=0
for _ in $(seq 1 200); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 0.2
done
# Stop PocketBase before querying, so sqlite3 reads a settled database. The trap
# is the safety net for signal paths; this kill makes it a no-op on normal paths.
kill "$PB_PID" 2>/dev/null || true
wait "$PB_PID" 2>/dev/null || true
PB_PID=""

if [[ "$ok" -ne 1 ]]; then
  echo "error: pocketbase serve never came up; log:" >&2; cat "$LOG" >&2; exit 2
fi

DB="$DB_DIR/data.db"
js_migs=$(sqlite3 "$DB" "SELECT COUNT(*) FROM _migrations WHERE file LIKE '%.js'")
if [[ "$js_migs" -lt 1 ]]; then
  echo "error: 0 .js migrations applied — jsvm loading broke" >&2; cat "$LOG" >&2; exit 2
fi

fail=0
note() { echo "FAIL: $*" >&2; fail=1; }

for c in lodging_areas lodging_units lodging_unit_aliases lodging_merges \
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

st=$(field_prop lodging_availability state values || true)
[[ "$st" == '["reserved_staff","reserved_other","released_to_family"]' ]] || note "lodging_availability.state values are $st"

# Unbounded numbers must be null, not 0 (0 would reject positive values).
for spec in "lodging_units:sleeps" "lodging_merges:capacity_override"; do
  col=${spec%%:*}; fld=${spec##*:}
  mx=$(field_prop "$col" "$fld" max || true)
  [[ -z "$mx" || "$mx" == "null" ]] || note "$col.$fld max is '$mx' (expected null for unbounded)"
done

# Merges bind 2+ units, so member_units must be multi-select.
ms=$(field_prop lodging_merges member_units maxSelect || true)
[[ -n "$ms" && "$ms" != "1" ]] || note "lodging_merges.member_units maxSelect is '$ms' (expected >1 or null)"
ms=$(field_prop lodging_unit_aliases member_units maxSelect || true)
[[ -n "$ms" && "$ms" != "1" ]] || note "lodging_unit_aliases.member_units maxSelect is '$ms' (expected >1 or null)"

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
for c in lodging_merges lodging_availability lodging_assignments; do
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
for c in lodging_merges lodging_availability lodging_assignments lodging_assignment_history; do
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

if [[ "$fail" -ne 0 ]]; then echo "verify-lodging-schema: FAILED" >&2; exit 1; fi
echo "verify-lodging-schema: OK ($js_migs js migrations applied)"
